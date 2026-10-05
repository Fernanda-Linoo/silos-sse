/**
 * AGRO-MONITORING PRO — Servidor de automação de silos (Atividade SSE2)
 *
 * Arquitetura híbrida (RNF-01):
 *   - SSE  (GET /api/silos/stream)  → servidor empurra telemetria, alarmes e log
 *   - HTTP (POST/PUT /api/...)       → cliente envia comandos pontuais aos atuadores
 *   - GET comuns (/api/silos, /api/log...) → apenas leitura do estado consolidado,
 *     usados na carga inicial e na ressincronização após queda de conexão (RNF-02)
 */

const express = require('express');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;
const INTERVALO_MS = 2000; // RF-01: leituras a cada 1–2 s

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// ---------------------------------------------------------------------------
// Configuração de limiares (editável pela Tela 3 via PUT /api/config)
// ---------------------------------------------------------------------------
const config = {
  tempExaustor: 30.0,   // RF-04: liga exaustores
  tempCritica: 35.0,    // RF-04: alarme crítico sonoro
  co2Alerta: 1000,      // RF-03: alerta visual
  co2Critico: 1500,     // RF-03: abre comporta automaticamente
  cargaMaxima: 98       // RF-05: bloqueio para carga
};

// Histerese do modo automático (evita liga/desliga a cada leitura)
const HISTERESE = { temp: 3.0, co2: 400 };

// ---------------------------------------------------------------------------
// Estado em memória dos silos
// ---------------------------------------------------------------------------
function criarSilo(id, grao, capacidadeTon, base) {
  return {
    id,
    codigo: `SILO-${String(id).padStart(2, '0')}`,
    grao,
    capacidadeTon,
    // grandezas simuladas
    termopares: { topo: base.temp, meio: base.temp - 2.5, fundo: base.temp - 5 },
    umidade: base.umidade,
    co2: base.co2,
    nivel: base.nivel,
    // comportamento da simulação
    focoCalor: base.foco || 0,       // °C/leitura somados ao topo quando sem exaustão
    producaoCo2: base.prodCo2 || 0,  // ppm/leitura gerados pela massa de grãos
    carregando: !!base.carregando,
    // atuadores
    atuadores: { comporta: 'FECHADA', exaustor1: 'DESLIGADO', exaustor2: 'DESLIGADO' },
    modo: 'AUTOMATICO',
    // estado derivado
    bloqueadoCarga: false,
    comunicacaoOk: true,
    termoparRompido: null,             // 'topo' | 'meio' | 'fundo' | null
    alarmeCriticoAtivo: false,
    co2AlertaAtivo: false,
    ultimaLeitura: new Date().toISOString()
  };
}

const silos = [
  criarSilo(1, 'MILHO', 4200, { temp: 26.2, umidade: 12.5, co2: 620, nivel: 75 }),
  criarSilo(2, 'SOJA', 5000, { temp: 29.0, umidade: 14.2, co2: 1150, nivel: 88, foco: 0.18, prodCo2: 32 }),
  criarSilo(3, 'TRIGO', 3800, { temp: 25.8, umidade: 11.8, co2: 580, nivel: 60 }),
  criarSilo(4, 'MILHO', 4500, { temp: 24.1, umidade: 13.1, co2: 510, nivel: 85, carregando: true })
];

let sensorChuva = false;

// Histórico de 24 h por silo: um ponto a cada 10 min (144 pontos), pré-preenchido
const PASSO_HIST_MS = 10 * 60 * 1000;
const historico = new Map();
for (const s of silos) {
  const pontos = [];
  const agora = Date.now();
  for (let i = 143; i >= 0; i--) {
    const t = agora - i * PASSO_HIST_MS;
    const ciclo = Math.sin((t / 3.6e6) * (Math.PI / 12)); // ciclo diário
    const progresso = (143 - i) / 143;
    const tempFinal = temperaturaMax(s);
    pontos.push({
      t: new Date(t).toISOString(),
      temperatura: arred(tempFinal - (s.focoCalor ? 6 * (1 - progresso) : 0) + ciclo * 1.2 + ruido(0.3), 1),
      co2: Math.round(s.co2 - (s.producaoCo2 ? 500 * (1 - progresso) : 0) + ciclo * 30 + ruido(15))
    });
  }
  historico.set(s.id, pontos);
}
let ultimoPontoHist = Date.now();

// ---------------------------------------------------------------------------
// Log de auditoria (RF-08): últimas 20 ocorrências em memória
// ---------------------------------------------------------------------------
const LOG_MAX = 20;
const logAuditoria = [];
let proximoIdLog = 1;

function registrarLog({ siloId = null, tipo, origem, severidade = 'INFO', mensagem, operadorId = null }) {
  const entrada = {
    id: proximoIdLog++,
    timestamp: new Date().toISOString(),
    siloId,
    tipo,        // ATUADOR | ALARME | SISTEMA | CONFIG
    origem,      // AUTOMATICO | MANUAL | SISTEMA
    severidade,  // INFO | ATENCAO | ALERTA | CRITICO
    operadorId,
    mensagem
  };
  logAuditoria.unshift(entrada);
  if (logAuditoria.length > LOG_MAX) logAuditoria.length = LOG_MAX;
  transmitir('log_update', entrada);
  return entrada;
}

// ---------------------------------------------------------------------------
// Clientes SSE conectados
// ---------------------------------------------------------------------------
const clientes = new Set();
let eventosEnviados = 0;
let eventosJanela = [];

function enviarEvento(res, evento, dados) {
  res.write(`event: ${evento}\n`);
  res.write(`data: ${JSON.stringify(dados)}\n\n`);
}

function transmitir(evento, dados) {
  for (const res of clientes) enviarEvento(res, evento, dados);
  eventosEnviados++;
  eventosJanela.push(Date.now());
}

function handlerSSE(req, res) {
  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    Connection: 'keep-alive',
    'X-Accel-Buffering': 'no'
  });
  res.write('retry: 3000\n\n'); // orienta o EventSource a reconectar em 3 s

  clientes.add(res);

  // Sincronização imediata do estado consolidado (RNF-02)
  enviarEvento(res, 'sensor_update', snapshot());
  enviarEvento(res, 'log_snapshot', logAuditoria);
  enviarEvento(res, 'config_update', config);

  req.on('close', () => clientes.delete(res));
}

// Heartbeat: comentário SSE a cada 15 s para manter proxies/conexões vivos
setInterval(() => {
  for (const res of clientes) res.write(': ping\n\n');
}, 15000);

// ---------------------------------------------------------------------------
// Funções auxiliares
// ---------------------------------------------------------------------------
function arred(v, casas = 1) {
  const f = 10 ** casas;
  return Math.round(v * f) / f;
}
function ruido(amp) {
  return (Math.random() * 2 - 1) * amp;
}
function limitar(v, min, max) {
  return Math.min(max, Math.max(min, v));
}
function temperaturaMax(s) {
  const vals = Object.entries(s.termopares)
    .filter(([k]) => k !== s.termoparRompido)
    .map(([, v]) => v);
  return Math.max(...vals);
}
function exaustorLigado(s) {
  return s.atuadores.exaustor1 === 'LIGADO' || s.atuadores.exaustor2 === 'LIGADO';
}

function alarmeDoSilo(s) {
  const t = temperaturaMax(s);
  if (t >= config.tempCritica) return 'SUPERAQUECIMENTO';
  if (s.co2 >= config.co2Critico) return 'CO2_CRITICO';
  if (t >= config.tempExaustor) return 'ALERTA_TEMPERATURA';
  if (s.co2 >= config.co2Alerta) return 'CO2_ELEVADO';
  return 'NORMAL';
}

function nivelRisco(s) {
  const a = alarmeDoSilo(s);
  if (a === 'SUPERAQUECIMENTO' || a === 'CO2_CRITICO') return 'CRITICO';
  if (a !== 'NORMAL' || s.bloqueadoCarga || !s.comunicacaoOk) return 'ALERTA';
  return 'NORMAL';
}

/** Objeto público de um silo — campos da seção 7.1 + extensões */
function siloPublico(s) {
  const temperatura = temperaturaMax(s);
  const termopares = {};
  for (const k of ['topo', 'meio', 'fundo']) {
    termopares[k] = s.termoparRompido === k ? null : arred(s.termopares[k], 1);
  }
  return {
    siloId: s.id,
    codigo: s.codigo,
    grao: s.grao,
    temperatura: arred(temperatura, 1),
    co2: Math.round(s.co2),
    umidade: arred(s.umidade, 1),
    nivel: arred(s.nivel, 1),
    comporta: s.atuadores.comporta,
    exaustor: exaustorLigado(s) ? 'LIGADO' : 'DESLIGADO',
    alarme: alarmeDoSilo(s),
    // extensões usadas pelas telas
    nivelRisco: nivelRisco(s),
    atuadores: { ...s.atuadores },
    modo: s.modo,
    termopares,
    capacidadeTon: s.capacidadeTon,
    statusCarga: s.bloqueadoCarga ? 'BLOQUEADO_PARA_CARGA' : s.carregando ? 'CARREGANDO' : 'ESTAVEL',
    comunicacao: s.comunicacaoOk ? 'OK' : 'FALHA',
    timestamp: s.ultimaLeitura
  };
}

function snapshot() {
  return {
    timestamp: new Date().toISOString(),
    sensorChuva,
    silos: silos.map(siloPublico)
  };
}

// ---------------------------------------------------------------------------
// Atuação (comum a automação e comandos manuais)
// ---------------------------------------------------------------------------
function definirAtuador(s, alvo, valor, origem, operadorId = null, motivo = '') {
  if (s.atuadores[alvo] === valor) return false;
  s.atuadores[alvo] = valor;
  const nomes = { comporta: 'Comporta', exaustor1: 'Exaustor 01', exaustor2: 'Exaustor 02' };
  const quem = origem === 'MANUAL' ? `por Operador ${operadorId}` : 'pela automação';
  registrarLog({
    siloId: s.id,
    tipo: 'ATUADOR',
    origem,
    operadorId,
    mensagem: `${s.codigo}: ${nomes[alvo]} ${valor} ${quem}${motivo ? ` (${motivo})` : ''}`
  });
  return true;
}

// ---------------------------------------------------------------------------
// Motor de regras (RF-03, RF-04, RF-05)
// ---------------------------------------------------------------------------
function avaliarRegras(s) {
  const temp = temperaturaMax(s);
  const auto = s.modo === 'AUTOMATICO';

  // RF-04: temperatura → exaustores
  if (auto) {
    if (temp >= config.tempExaustor) {
      const motivo = `temp ${temp.toFixed(1)} °C ≥ ${config.tempExaustor} °C`;
      if (s.atuadores.exaustor1 === 'DESLIGADO') definirAtuador(s, 'exaustor1', 'LIGADO', 'AUTOMATICO', null, motivo);
      if (s.atuadores.exaustor2 === 'DESLIGADO') definirAtuador(s, 'exaustor2', 'LIGADO', 'AUTOMATICO', null, motivo);
    } else if (temp <= config.tempExaustor - HISTERESE.temp && s.co2 < config.co2Alerta) {
      if (s.atuadores.exaustor1 === 'LIGADO') definirAtuador(s, 'exaustor1', 'DESLIGADO', 'AUTOMATICO', null, 'temperatura normalizada');
      if (s.atuadores.exaustor2 === 'LIGADO') definirAtuador(s, 'exaustor2', 'DESLIGADO', 'AUTOMATICO', null, 'temperatura normalizada');
    }
  }

  // RF-04: alarme crítico sonoro (vale em qualquer modo)
  if (temp >= config.tempCritica && !s.alarmeCriticoAtivo) {
    s.alarmeCriticoAtivo = true;
    const msg = `${s.codigo}: SUPERAQUECIMENTO ${temp.toFixed(1)} °C ≥ ${config.tempCritica} °C — risco de combustão espontânea`;
    registrarLog({ siloId: s.id, tipo: 'ALARME', origem: 'SISTEMA', severidade: 'CRITICO', mensagem: msg });
    transmitir('alarme_critico', {
      siloId: s.id,
      codigo: s.codigo,
      tipoEvento: 'SUPERAQUECIMENTO',
      nivelSeveridade: 'CRITICO',
      temperatura: arred(temp, 1),
      sonoro: true,
      mensagem: msg,
      timestamp: new Date().toISOString()
    });
  } else if (temp < config.tempCritica - 1 && s.alarmeCriticoAtivo) {
    s.alarmeCriticoAtivo = false;
    registrarLog({ siloId: s.id, tipo: 'ALARME', origem: 'SISTEMA', mensagem: `${s.codigo}: temperatura abaixo do limite crítico` });
  }

  // RF-03: CO2 → alerta (≥ 1000) e comporta automática (≥ 1500)
  if (s.co2 >= config.co2Alerta && !s.co2AlertaAtivo) {
    s.co2AlertaAtivo = true;
    registrarLog({
      siloId: s.id, tipo: 'ALARME', origem: 'SISTEMA', severidade: 'ATENCAO',
      mensagem: `${s.codigo}: CO₂ elevado ${Math.round(s.co2)} ppm ≥ ${config.co2Alerta} ppm`
    });
  } else if (s.co2 < config.co2Alerta - 100 && s.co2AlertaAtivo) {
    s.co2AlertaAtivo = false;
  }
  if (auto) {
    if (s.co2 >= config.co2Critico && s.atuadores.comporta === 'FECHADA') {
      definirAtuador(s, 'comporta', 'ABERTA', 'AUTOMATICO', null, `CO₂ ${Math.round(s.co2)} ppm ≥ ${config.co2Critico} ppm`);
    } else if (s.co2 <= config.co2Critico - HISTERESE.co2 * 2 && s.atuadores.comporta === 'ABERTA') {
      definirAtuador(s, 'comporta', 'FECHADA', 'AUTOMATICO', null, 'CO₂ normalizado');
    }
  }

  // RF-05: trava de capacidade
  if (s.nivel >= config.cargaMaxima && !s.bloqueadoCarga) {
    s.bloqueadoCarga = true;
    s.carregando = false;
    const msg = `${s.codigo}: capacidade ${s.nivel.toFixed(1)}% ≥ ${config.cargaMaxima}% — silo BLOQUEADO PARA CARGA (prevenção de derramamento)`;
    registrarLog({ siloId: s.id, tipo: 'ALARME', origem: 'SISTEMA', severidade: 'ALERTA', mensagem: msg });
    transmitir('notificacao', { siloId: s.id, tipo: 'BLOQUEIO_CARGA', severidade: 'ALERTA', mensagem: msg, timestamp: new Date().toISOString() });
  }
}

// ---------------------------------------------------------------------------
// Simulador de telemetria (RF-01)
// ---------------------------------------------------------------------------
function simular(s) {
  if (!s.comunicacaoOk) return; // sensor sem sinal: mantém últimos dados

  const exaustao = exaustorLigado(s);
  const ventilacao = s.atuadores.comporta === 'ABERTA';
  const nExaustores = (s.atuadores.exaustor1 === 'LIGADO') + (s.atuadores.exaustor2 === 'LIGADO');

  // Temperatura: respiração da massa de grãos aquece o topo; exaustão resfria
  const alvoAmbiente = 25 + (s.umidade - 12) * 0.6;
  for (const camada of ['topo', 'meio', 'fundo']) {
    const peso = camada === 'topo' ? 1 : camada === 'meio' ? 0.55 : 0.2;
    let t = s.termopares[camada];
    t += s.focoCalor * peso;                              // reação exotérmica
    t -= nExaustores * 0.11 * peso;                       // exaustão forçada
    if (ventilacao) t -= 0.04 * peso;
    t += (alvoAmbiente - (camada === 'fundo' ? 5 : camada === 'meio' ? 2.5 : 0) - t) * 0.01; // retorno lento
    t += ruido(0.08);
    s.termopares[camada] = limitar(t, 10, 60);
  }

  // CO2: produção metabólica (cresce com temperatura e umidade); ventilação dissipa
  const fatorMetab = 1 + Math.max(0, temperaturaMax(s) - 25) * 0.08 + Math.max(0, s.umidade - 13) * 0.3;
  s.co2 += s.producaoCo2 * fatorMetab + 1;
  if (ventilacao) s.co2 -= 75;
  if (exaustao) s.co2 -= 18 * nExaustores;
  s.co2 += (480 - s.co2) * 0.01 + ruido(6);
  s.co2 = limitar(s.co2, 400, 5000);

  // Umidade: exaustão e ventilação secam lentamente
  s.umidade += ruido(0.04) - (exaustao ? 0.006 : 0) - (ventilacao ? 0.004 : 0) + 0.002;
  s.umidade = limitar(s.umidade, 8, 20);

  // Nível de grãos: silo em carga enche gradualmente
  if (s.carregando && !s.bloqueadoCarga) s.nivel += 0.25 + Math.random() * 0.1;
  s.nivel = limitar(s.nivel + ruido(0.01), 0, 100);

  s.ultimaLeitura = new Date().toISOString();
}

function atualizarHistorico() {
  const agora = Date.now();
  const novoPonto = agora - ultimoPontoHist >= PASSO_HIST_MS;
  for (const s of silos) {
    const pontos = historico.get(s.id);
    const ponto = { t: new Date(agora).toISOString(), temperatura: arred(temperaturaMax(s), 1), co2: Math.round(s.co2) };
    if (novoPonto) {
      pontos.push(ponto);
      if (pontos.length > 144) pontos.shift();
    } else {
      pontos[pontos.length - 1] = ponto; // o último ponto acompanha a leitura atual
    }
  }
  if (novoPonto) ultimoPontoHist = agora;
}

function cicloTelemetria() {
  // Sensor de chuva externo muda de estado ocasionalmente
  if (Math.random() < 0.003) {
    sensorChuva = !sensorChuva;
    registrarLog({ tipo: 'SISTEMA', origem: 'SISTEMA', severidade: sensorChuva ? 'ATENCAO' : 'INFO',
      mensagem: `Sensor de chuva externo ${sensorChuva ? 'ATIVO' : 'inativo'}` });
  }

  for (const s of silos) {
    simular(s);
    avaliarRegras(s);
  }
  atualizarHistorico();
  transmitir('sensor_update', snapshot()); // RF-02
}

setInterval(cicloTelemetria, INTERVALO_MS);

// ---------------------------------------------------------------------------
// Rotas — SSE (RF-02)
// ---------------------------------------------------------------------------
app.get('/api/silos/stream', handlerSSE);
app.get('/events', handlerSSE); // alias com o nome usado no RF-02

// ---------------------------------------------------------------------------
// Rotas — leitura (estado consolidado / ressincronização)
// ---------------------------------------------------------------------------
app.get('/api/silos', (req, res) => res.json(snapshot()));

function buscarSilo(req, res) {
  const id = Number(req.params.id);
  const s = silos.find((x) => x.id === id);
  if (!s) {
    res.status(404).json({ sucesso: false, erro: 'SILO_NAO_ENCONTRADO', mensagem: `Silo ${req.params.id} não existe.` });
    return null;
  }
  return s;
}

app.get('/api/silos/:id', (req, res) => {
  const s = buscarSilo(req, res);
  if (s) res.json(siloPublico(s));
});

app.get('/api/silos/:id/historico', (req, res) => {
  const s = buscarSilo(req, res);
  if (s) res.json({ siloId: s.id, intervaloMin: 10, pontos: historico.get(s.id) });
});

app.get('/api/log', (req, res) => res.json(logAuditoria));
app.get('/api/config', (req, res) => res.json(config));

app.get('/api/status', (req, res) => {
  const agora = Date.now();
  eventosJanela = eventosJanela.filter((t) => agora - t < 10000);
  res.json({
    clientesConectados: clientes.size,
    eventosPorSegundo: arred(eventosJanela.length / 10, 1),
    eventosEnviados,
    sensorChuva,
    intervaloMs: INTERVALO_MS
  });
});

// ---------------------------------------------------------------------------
// Rotas — comandos (RF-06)
// ---------------------------------------------------------------------------
const COMANDOS_COMPORTA = { ABRIR: 'ABERTA', FECHAR: 'FECHADA' };
const COMANDOS_EXAUSTOR = { LIGAR: 'LIGADO', DESLIGAR: 'DESLIGADO' };

/**
 * Valida e executa um conjunto de comandos em um silo.
 * Retorna { status, corpo } para a resposta HTTP.
 */
function executarComandos(s, { comportaComando = 'MANTER', exaustorComando = 'MANTER', exaustor2Comando = 'MANTER', operadorId }) {
  if (!operadorId || typeof operadorId !== 'string') {
    return { status: 400, corpo: { sucesso: false, siloId: s.id, erro: 'OPERADOR_OBRIGATORIO', mensagem: 'Informe o operadorId responsável pelo comando.' } };
  }
  const validos = (v, mapa) => v === 'MANTER' || v in mapa;
  if (!validos(comportaComando, COMANDOS_COMPORTA) || !validos(exaustorComando, COMANDOS_EXAUSTOR) || !validos(exaustor2Comando, COMANDOS_EXAUSTOR)) {
    return { status: 400, corpo: { sucesso: false, siloId: s.id, erro: 'COMANDO_INVALIDO', mensagem: 'Use ABRIR/FECHAR/MANTER para a comporta e LIGAR/DESLIGAR/MANTER para os exaustores.' } };
  }
  if (s.modo !== 'MANUAL') {
    return { status: 409, corpo: { sucesso: false, siloId: s.id, erro: 'MODO_AUTOMATICO', mensagem: `${s.codigo} está em modo automático. Mude para manual antes de enviar comandos.` } };
  }
  if (!s.comunicacaoOk) {
    return { status: 503, corpo: { sucesso: false, siloId: s.id, erro: 'SEM_COMUNICACAO', mensagem: `${s.codigo} sem comunicação com o CLP. Verifique o hardware.` } };
  }
  if (comportaComando === 'ABRIR' && sensorChuva) {
    registrarLog({ siloId: s.id, tipo: 'ATUADOR', origem: 'MANUAL', operadorId, severidade: 'ATENCAO',
      mensagem: `${s.codigo}: abertura da comporta bloqueada — sensor de chuva ativo` });
    return { status: 423, corpo: { sucesso: false, siloId: s.id, erro: 'BLOQUEIO_CHUVA', mensagem: 'Ação bloqueada: sensor de chuva ativo.' } };
  }
  for (const [cmd, alvo] of [[exaustorComando, 'exaustor1'], [exaustor2Comando, 'exaustor2']]) {
    if (cmd !== 'MANTER' && s.atuadores[alvo] === 'FALHA') {
      return { status: 423, corpo: { sucesso: false, siloId: s.id, erro: 'SOBRECARGA_MOTOR',
        mensagem: `${alvo === 'exaustor1' ? 'Exaustor 01' : 'Exaustor 02'} em falha (relé térmico disparado). Exige reset presencial no painel elétrico.` } };
    }
  }

  if (comportaComando !== 'MANTER') definirAtuador(s, 'comporta', COMANDOS_COMPORTA[comportaComando], 'MANUAL', operadorId);
  if (exaustorComando !== 'MANTER') definirAtuador(s, 'exaustor1', COMANDOS_EXAUSTOR[exaustorComando], 'MANUAL', operadorId);
  if (exaustor2Comando !== 'MANTER') definirAtuador(s, 'exaustor2', COMANDOS_EXAUSTOR[exaustor2Comando], 'MANUAL', operadorId);

  transmitir('sensor_update', snapshot()); // reflete o novo estado imediatamente em todos os painéis

  return {
    status: 200,
    corpo: {
      sucesso: true,
      siloId: s.id,
      novoEstado: {
        comporta: s.atuadores.comporta,
        exaustor: exaustorLigado(s) ? 'LIGADO' : 'DESLIGADO',
        exaustor1: s.atuadores.exaustor1,
        exaustor2: s.atuadores.exaustor2
      },
      mensagem: `Comando executado com sucesso nos atuadores do Silo ${String(s.id).padStart(2, '0')}.`
    }
  };
}

// Endpoint principal (seção 7.2)
app.post('/api/silos/:id/atuadores', (req, res) => {
  const s = buscarSilo(req, res);
  if (!s) return;
  if (req.body.siloId !== undefined && Number(req.body.siloId) !== s.id) {
    return res.status(400).json({ sucesso: false, siloId: s.id, erro: 'SILO_DIVERGENTE', mensagem: 'O siloId do corpo difere do id da URL.' });
  }
  const { status, corpo } = executarComandos(s, req.body);
  res.status(status).json(corpo);
});

// Rotas curtas do RF-06 (mesma lógica)
app.post('/api/silos/:id/comporta/:acao', (req, res) => {
  const s = buscarSilo(req, res);
  if (!s) return;
  const acao = String(req.params.acao).toUpperCase();
  const { status, corpo } = executarComandos(s, { comportaComando: acao, operadorId: req.body.operadorId });
  res.status(status).json(corpo);
});

app.post('/api/silos/:id/exaustor/:acao', (req, res) => {
  const s = buscarSilo(req, res);
  if (!s) return;
  const acao = String(req.params.acao).toUpperCase();
  const qual = Number(req.query.n || req.body.exaustor || 0); // 1, 2 ou 0 (ambos)
  const cmd = {
    exaustorComando: qual === 2 ? 'MANTER' : acao,
    exaustor2Comando: qual === 1 ? 'MANTER' : acao,
    operadorId: req.body.operadorId
  };
  const { status, corpo } = executarComandos(s, cmd);
  res.status(status).json(corpo);
});

// Alternância de modo Automático / Manual
app.post('/api/silos/:id/modo', (req, res) => {
  const s = buscarSilo(req, res);
  if (!s) return;
  const modo = String(req.body.modo || '').toUpperCase();
  const { operadorId } = req.body;
  if (!['AUTOMATICO', 'MANUAL'].includes(modo)) {
    return res.status(400).json({ sucesso: false, siloId: s.id, erro: 'MODO_INVALIDO', mensagem: 'Use AUTOMATICO ou MANUAL.' });
  }
  if (!operadorId) {
    return res.status(400).json({ sucesso: false, siloId: s.id, erro: 'OPERADOR_OBRIGATORIO', mensagem: 'Informe o operadorId.' });
  }
  if (s.modo !== modo) {
    s.modo = modo;
    registrarLog({
      siloId: s.id, tipo: 'ATUADOR', origem: 'MANUAL', operadorId, severidade: modo === 'MANUAL' ? 'ATENCAO' : 'INFO',
      mensagem: `${s.codigo}: modo ${modo === 'MANUAL' ? 'MANUAL (rotinas automáticas suspensas)' : 'AUTOMÁTICO restabelecido'} por Operador ${operadorId}`
    });
    if (modo === 'AUTOMATICO') avaliarRegras(s);
    transmitir('sensor_update', snapshot());
  }
  res.json({ sucesso: true, siloId: s.id, modo: s.modo, mensagem: `${s.codigo} em modo ${s.modo}.` });
});

// Parametrização de limiares (Tela 3)
app.put('/api/config', (req, res) => {
  const campos = {
    tempExaustor: [10, 60], tempCritica: [10, 80], co2Alerta: [400, 5000], co2Critico: [400, 5000]
  };
  const novo = { ...config };
  for (const [k, [min, max]] of Object.entries(campos)) {
    if (req.body[k] === undefined) continue;
    const v = Number(req.body[k]);
    if (!Number.isFinite(v) || v < min || v > max) {
      return res.status(400).json({ sucesso: false, erro: 'VALOR_INVALIDO', mensagem: `${k} deve estar entre ${min} e ${max}.` });
    }
    novo[k] = v;
  }
  if (novo.tempCritica <= novo.tempExaustor) {
    return res.status(400).json({ sucesso: false, erro: 'LIMIARES_INCOERENTES', mensagem: 'A temperatura crítica deve ser maior que a de acionamento dos exaustores.' });
  }
  if (novo.co2Critico <= novo.co2Alerta) {
    return res.status(400).json({ sucesso: false, erro: 'LIMIARES_INCOERENTES', mensagem: 'O CO₂ crítico deve ser maior que o CO₂ de alerta.' });
  }
  Object.assign(config, novo);
  registrarLog({
    tipo: 'CONFIG', origem: 'MANUAL', operadorId: req.body.operadorId || null,
    mensagem: `Limiares atualizados: exaustor ${config.tempExaustor} °C, crítico ${config.tempCritica} °C, CO₂ alerta ${config.co2Alerta} ppm, CO₂ crítico ${config.co2Critico} ppm`
  });
  transmitir('config_update', config);
  res.json({ sucesso: true, config, mensagem: 'Configurações salvas.' });
});

// ---------------------------------------------------------------------------
// Rotas de demonstração (apenas para apresentar os fluxos alternativos/exceção)
// ---------------------------------------------------------------------------
app.post('/api/simulacao/:id/cenario', (req, res) => {
  const s = buscarSilo(req, res);
  if (!s) return;
  const tipo = String(req.body.tipo || '');
  const log = (mensagem, severidade = 'ATENCAO') => registrarLog({ siloId: s.id, tipo: 'SISTEMA', origem: 'SISTEMA', severidade, mensagem: `[SIMULAÇÃO] ${mensagem}` });

  switch (tipo) {
    case 'superaquecimento':
      s.termopares.topo = config.tempCritica + 0.6;
      s.termopares.meio = config.tempCritica - 2;
      log(`${s.codigo}: pico térmico injetado`);
      break;
    case 'co2':
      s.co2 = config.co2Critico + 60;
      log(`${s.codigo}: pico de CO₂ injetado`);
      break;
    case 'falha-comunicacao':
      s.comunicacaoOk = false;
      log(`${s.codigo}: sensor perdeu sinal de campo (CLP)`, 'ALERTA');
      setTimeout(() => {
        s.comunicacaoOk = true;
        registrarLog({ siloId: s.id, tipo: 'SISTEMA', origem: 'SISTEMA', mensagem: `${s.codigo}: comunicação com o CLP restabelecida` });
      }, 20000);
      break;
    case 'termopar':
      s.termoparRompido = 'meio';
      log(`${s.codigo}: cabo do termopar do meio rompido`, 'ALERTA');
      break;
    case 'chuva':
      sensorChuva = !sensorChuva;
      log(`Sensor de chuva externo ${sensorChuva ? 'ATIVO' : 'inativo'}`);
      break;
    case 'sobrecarga':
      s.atuadores.exaustor1 = 'FALHA';
      log(`${s.codigo}: relé térmico do Exaustor 01 disparou (sobrecarga)`, 'ALERTA');
      break;
    case 'reset-exaustor':
      if (s.atuadores.exaustor1 === 'FALHA') s.atuadores.exaustor1 = 'DESLIGADO';
      if (s.atuadores.exaustor2 === 'FALHA') s.atuadores.exaustor2 = 'DESLIGADO';
      log(`${s.codigo}: reset presencial dos exaustores realizado`, 'INFO');
      break;
    case 'descarregar':
      s.nivel = 40;
      s.bloqueadoCarga = false;
      s.carregando = true;
      log(`${s.codigo}: descarga parcial — silo liberado para carga`, 'INFO');
      break;
    case 'normalizar':
      s.termopares = { topo: 26, meio: 24, fundo: 22 };
      s.co2 = 600;
      s.termoparRompido = null;
      s.comunicacaoOk = true;
      log(`${s.codigo}: leituras normalizadas`, 'INFO');
      break;
    default:
      return res.status(400).json({ sucesso: false, erro: 'CENARIO_INVALIDO', mensagem: `Cenário "${tipo}" desconhecido.` });
  }
  avaliarRegras(s);
  transmitir('sensor_update', snapshot());
  res.json({ sucesso: true, siloId: s.id, cenario: tipo });
});

// Raiz → dashboard
app.get('/', (req, res) => res.redirect('/tela1-dashboard.html'));

app.listen(PORT, () => {
  registrarLog({ tipo: 'SISTEMA', origem: 'SISTEMA', mensagem: `Check-in de sensores OK (${silos.length}/${silos.length})` });
  console.log(`AGRO-MONITORING PRO rodando em http://localhost:${PORT}`);
  console.log(`  SSE:       GET  /api/silos/stream  (alias /events)`);
  console.log(`  Comandos:  POST /api/silos/:id/atuadores`);
});
