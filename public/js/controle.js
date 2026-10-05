/* Tela 3 — Parametrização e controle de atuadores (US-03, RF-06, RF-08) */

const siloId = Util.siloIdDaURL();
let atual = null;
let sensorChuva = false;
let configCarregada = false;

const selSilo = document.getElementById('sel-silo');
const toggle = document.getElementById('toggle-modo');
const feedback = document.getElementById('feedback');
const terminal = document.getElementById('terminal');
const inputOperador = document.getElementById('operador');
const botoesCmd = [...document.querySelectorAll('.cmd')];

document.title = `${Util.nomeSilo(siloId)} — Controle de atuadores`;
document.getElementById('titulo-comando').textContent = `Comando manual — ${Util.nomeSilo(siloId)}`;
selSilo.addEventListener('change', () => (location.href = `tela3-controle.html?siloId=${selSilo.value}`));

try { inputOperador.value = localStorage.getItem('operadorId') || inputOperador.value; } catch {}
inputOperador.addEventListener('change', () => { try { localStorage.setItem('operadorId', inputOperador.value.trim()); } catch {} });

function operador() {
  const v = inputOperador.value.trim();
  if (!v) {
    mostrarFeedback('Informe o operador responsável antes de enviar comandos.', 'erro');
    inputOperador.focus();
    return null;
  }
  return v;
}

function mostrarFeedback(texto, tipo) {
  feedback.textContent = texto;
  feedback.className = `aviso ${tipo}`;
  clearTimeout(mostrarFeedback.t);
  mostrarFeedback.t = setTimeout(() => feedback.classList.add('oculto'), 6000);
}

/* ---------- Estado visual do silo ---------- */
function pintarAtuador(id, estado, ligadoQuando) {
  const l = document.getElementById(`l-${id}`);
  const s = document.getElementById(`s-${id}`);
  l.className = `lampada${estado === 'FALHA' ? ' falha' : estado === ligadoQuando ? ' ativa' : ''}`;
  const textos = { ABERTA: 'Aberta', FECHADA: 'Fechada', LIGADO: 'Ligado', DESLIGADO: 'Desligado', FALHA: 'Falha — relé térmico disparado. Reset presencial no painel elétrico.' };
  s.textContent = textos[estado] || estado;
  s.className = estado === 'FALHA' ? 'falha' : '';
}

function atualizarTela(s) {
  atual = s;
  const manual = s.modo === 'MANUAL';
  toggle.checked = manual;
  document.getElementById('chave-modo').classList.toggle('manual', manual);
  document.getElementById('modo-texto').textContent = manual ? 'Modo manual' : 'Modo automático';
  document.getElementById('modo-ajuda').textContent = manual
    ? 'Rotinas automáticas suspensas neste silo. Os alarmes continuam ativos.'
    : 'Rotinas de segurança ativas. Mude para manual para comandar os atuadores.';

  pintarAtuador('comporta', s.atuadores.comporta, 'ABERTA');
  pintarAtuador('exaustor1', s.atuadores.exaustor1, 'LIGADO');
  pintarAtuador('exaustor2', s.atuadores.exaustor2, 'LIGADO');

  const semSinal = s.comunicacao !== 'OK';
  for (const b of botoesCmd) {
    const alvo = { comportaComando: 'comporta', exaustorComando: 'exaustor1', exaustor2Comando: 'exaustor2' }[b.dataset.cmd];
    const estado = s.atuadores[alvo];
    const jaNoEstado =
      (b.dataset.valor === 'ABRIR' && estado === 'ABERTA') || (b.dataset.valor === 'FECHAR' && estado === 'FECHADA') ||
      (b.dataset.valor === 'LIGAR' && estado === 'LIGADO') || (b.dataset.valor === 'DESLIGAR' && estado === 'DESLIGADO');
    b.disabled = !manual || semSinal || estado === 'FALHA' || jaNoEstado;
  }

  document.getElementById('leitura-resumo').textContent = semSinal
    ? 'Sem comunicação com o CLP — comandos indisponíveis.'
    : `Leitura atual: ${Util.num(s.temperatura)} °C · ${s.co2.toLocaleString('pt-BR')} ppm CO₂ · umidade ${Util.num(s.umidade)} % · ${Util.textoAlarme(s.alarme)}`;
}

/* ---------- Comandos HTTP POST ---------- */
toggle.addEventListener('change', async () => {
  const op = operador();
  if (!op) { toggle.checked = !toggle.checked; return; }
  const modo = toggle.checked ? 'MANUAL' : 'AUTOMATICO';
  toggle.disabled = true;
  try {
    const r = await Util.api(`/api/silos/${siloId}/modo`, { metodo: 'POST', corpo: { modo, operadorId: op } });
    mostrarFeedback(r.mensagem, 'ok');
  } catch (e) {
    toggle.checked = !toggle.checked;
    mostrarFeedback(e.message, 'erro');
  } finally {
    toggle.disabled = false;
  }
});

for (const b of botoesCmd) {
  b.addEventListener('click', async () => {
    const op = operador();
    if (!op) return;
    const corpo = {
      siloId,
      comportaComando: 'MANTER',
      exaustorComando: 'MANTER',
      exaustor2Comando: 'MANTER',
      operadorId: op
    };
    corpo[b.dataset.cmd] = b.dataset.valor;
    b.classList.add('ocupado');
    try {
      const r = await Util.api(`/api/silos/${siloId}/atuadores`, { metodo: 'POST', corpo });
      mostrarFeedback(`${r.mensagem} Comporta: ${r.novoEstado.comporta} · Exaustores: ${r.novoEstado.exaustor1} / ${r.novoEstado.exaustor2}`, 'ok');
    } catch (e) {
      mostrarFeedback(e.status === 423 && e.dados?.erro === 'BLOQUEIO_CHUVA' ? '[Ação bloqueada: sensor de chuva ativo]' : e.message, 'erro');
    } finally {
      b.classList.remove('ocupado');
    }
  });
}

/* ---------- Limiares (PUT /api/config) ---------- */
const form = document.getElementById('form-config');
const msgConfig = document.getElementById('msg-config');

function preencherConfig(cfg) {
  form.tempExaustor.value = cfg.tempExaustor;
  form.tempCritica.value = cfg.tempCritica;
  form.co2Alerta.value = cfg.co2Alerta;
  form.co2Critico.value = cfg.co2Critico;
}

form.addEventListener('submit', async (e) => {
  e.preventDefault();
  if (!form.checkValidity()) {
    msgConfig.textContent = 'Revise os valores: há campos vazios ou fora da faixa permitida.';
    msgConfig.className = 'mensagem-form erro';
    form.reportValidity();
    return;
  }
  const corpo = {
    tempExaustor: Number(form.tempExaustor.value),
    tempCritica: Number(form.tempCritica.value),
    co2Alerta: Number(form.co2Alerta.value),
    co2Critico: Number(form.co2Critico.value),
    operadorId: inputOperador.value.trim() || null
  };
  try {
    const r = await Util.api('/api/config', { metodo: 'PUT', corpo });
    msgConfig.textContent = r.mensagem;
    msgConfig.className = 'mensagem-form ok';
  } catch (err) {
    msgConfig.textContent = err.message;
    msgConfig.className = 'mensagem-form erro';
  }
});

/* ---------- Log de auditoria (terminal) ---------- */
function linhaLog(l, nova = false) {
  const li = document.createElement('li');
  if (nova) li.className = 'novo';
  const classe = l.severidade !== 'INFO' ? l.severidade : l.origem === 'MANUAL' ? 'MANUAL' : '';
  li.innerHTML = `<span class="h">[${Util.hora(l.timestamp)}]</span><span class="${classe}">${Util.escapar(l.mensagem)}</span>`;
  return li;
}
function renderLog(lista) {
  terminal.replaceChildren(...lista.map((l) => linhaLog(l)));
}
function adicionarLog(l) {
  terminal.prepend(linhaLog(l, true));
  while (terminal.children.length > 20) terminal.lastElementChild.remove();
}

/* ---------- Status do motor SSE ---------- */
async function atualizarStatus() {
  try {
    const st = await Util.api('/api/status');
    document.getElementById('st-taxa').textContent = `~${Util.num(st.eventosPorSegundo)} msg/s`;
    document.getElementById('st-clientes').textContent = `${st.clientesConectados} estação(ões)`;
  } catch {
    document.getElementById('st-taxa').textContent = '—';
    document.getElementById('st-clientes').textContent = '—';
  }
}
setInterval(atualizarStatus, 5000);
atualizarStatus();

/* ---------- Cenários de demonstração ---------- */
document.querySelectorAll('[data-cenario]').forEach((b) =>
  b.addEventListener('click', async () => {
    try {
      await Util.api(`/api/simulacao/${siloId}/cenario`, { metodo: 'POST', corpo: { tipo: b.dataset.cenario } });
      Util.toast(`Cenário "${b.textContent}" aplicado ao ${Util.nomeSilo(siloId)}.`);
    } catch (e) {
      Util.toast(e.message, 'erro');
    }
  })
);

/* ---------- SSE ---------- */
new ConexaoSSE({
  badge: document.getElementById('badge-sse'),
  handlers: {
    onSensorUpdate(estado) {
      if (!selSilo.options.length) {
        selSilo.innerHTML = estado.silos.map((s) => `<option value="${s.siloId}">${Util.nomeSilo(s.siloId)} (${Util.grao(s.grao)})</option>`).join('');
        selSilo.value = String(siloId);
      }
      sensorChuva = estado.sensorChuva;
      document.getElementById('aviso-chuva').classList.toggle('oculto', !sensorChuva);
      const s = estado.silos.find((x) => x.siloId === siloId);
      if (s) atualizarTela(s);
    },
    onConfig(cfg) {
      // não sobrescreve o que o operador está digitando
      if (!configCarregada || !form.contains(document.activeElement)) preencherConfig(cfg);
      configCarregada = true;
    },
    onLogSnapshot: renderLog,
    onLog: adicionarLog,
    onAlarmeCritico(a) {
      Util.toast(a.mensagem, 'erro');
      Alarme.tocar(3);
    }
  }
}).iniciar();
