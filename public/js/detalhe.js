/* Tela 2 — Visão detalhada com corte transversal SVG (US-02) */

const siloId = Util.siloIdDaURL();
let config = { tempExaustor: 30, tempCritica: 35, co2Alerta: 1000, co2Critico: 1500, cargaMaxima: 98 };
let historico = [];
let atual = null;

const areaSvg = document.getElementById('svg-area');
const listaLeituras = document.getElementById('leituras');
const canvas = document.getElementById('grafico');
const areaNotif = document.getElementById('notificacoes');

document.getElementById('btn-controle').href = `tela3-controle.html?siloId=${siloId}`;
document.title = `${Util.nomeSilo(siloId)} — Telemetria detalhada`;
configurarBotaoSom(document.getElementById('btn-som'));

const selSilo = document.getElementById('sel-silo');
selSilo.addEventListener('change', () => (location.href = `tela2-detalhe.html?siloId=${selSilo.value}`));

/* ---------- Cores dos termopares ---------- */
function corTemp(t) {
  if (t === null) return '#7a7f7c';
  if (t >= config.tempCritica) return '#c62828';
  if (t >= config.tempExaustor) return '#e0a100';
  return '#2e9e5b';
}

/* ---------- SVG do silo ---------- */
function helice(cx, cy, estado, rotulo) {
  const cor = estado === 'FALHA' ? '#c62828' : estado === 'LIGADO' ? '#1d7a43' : '#8a938e';
  const pas = [0, 120, 240]
    .map((a) => `<ellipse cx="${cx}" cy="${cy - 6}" rx="3" ry="6" fill="${cor}" transform="rotate(${a} ${cx} ${cy})"/>`)
    .join('');
  return `
    <g>
      <circle cx="${cx}" cy="${cy}" r="13" fill="#fff" stroke="${cor}" stroke-width="2"/>
      <g class="${estado === 'LIGADO' ? 'helice-girando' : ''}">${pas}</g>
      <circle cx="${cx}" cy="${cy}" r="2.5" fill="${cor}"/>
      <text x="${cx}" y="${cy + 26}" text-anchor="middle" font-size="9" font-weight="600" fill="${cor}">${rotulo} ${estado === 'FALHA' ? 'FALHA' : estado === 'LIGADO' ? 'ON' : 'OFF'}</text>
    </g>`;
}

function desenharSilo(s) {
  const corpo = { x: 90, y: 100, w: 160, h: 270 };
  const nivel = Math.max(0, Math.min(100, s.nivel));
  const alturaGrao = (corpo.h - 6) * (nivel / 100);
  const yGrao = corpo.y + corpo.h - alturaGrao;
  const aberta = s.comporta === 'ABERTA';
  const corComporta = aberta ? '#1d7a43' : '#6b7470';

  const sensores = [
    { k: 'topo', nome: 'Topo', y: corpo.y + 50 },
    { k: 'meio', nome: 'Meio', y: corpo.y + 140 },
    { k: 'fundo', nome: 'Fundo', y: corpo.y + 230 }
  ];
  const validos = sensores.map((x) => s.termopares[x.k]).filter((v) => v !== null);
  const maxT = Math.max(...validos);

  const termopares = sensores.map(({ k, nome, y }) => {
    const t = s.termopares[k];
    const foco = t !== null && t === maxT && t >= config.tempExaustor;
    const cor = corTemp(t);
    const valor = t === null ? 'ERR' : `${Util.num(t)} °C`;
    const marcador = t === null
      ? `<g><polygon points="170,${y - 9} 179,${y + 7} 161,${y + 7}" fill="#f2b705" stroke="#7a5b00"/><text x="170" y="${y + 5}" text-anchor="middle" font-size="10" font-weight="700" fill="#4a3800">!</text></g>`
      : `<circle cx="170" cy="${y}" r="${foco ? 9 : 7}" fill="${cor}" stroke="#fff" stroke-width="2"/>`;
    const anel = foco ? `<circle cx="170" cy="${y}" r="15" fill="none" stroke="${cor}" stroke-width="2" opacity="0.6"><animate attributeName="r" values="10;18;10" dur="1.6s" repeatCount="indefinite"/><animate attributeName="opacity" values="0.8;0;0.8" dur="1.6s" repeatCount="indefinite"/></circle>` : '';
    return `
      ${anel}
      <line x1="178" y1="${y}" x2="258" y2="${y}" stroke="${cor}" stroke-dasharray="3 3"/>
      ${marcador}
      <text x="262" y="${y - 3}" font-size="11" font-weight="700" fill="${cor}">${nome}</text>
      <text x="262" y="${y + 11}" font-size="11" font-weight="600" fill="${cor}">${valor}${foco ? ' · foco' : ''}</text>`;
  }).join('');

  const fluxoAr = aberta
    ? `<g stroke="#1d7a43" stroke-width="2" fill="none" stroke-linecap="round">
         <path d="M162 16 v-12 M156 9 l6 -6 l6 6"/><path d="M178 16 v-12 M172 9 l6 -6 l6 6"/>
       </g>`
    : '';

  areaSvg.innerHTML = `
  <svg viewBox="0 0 340 450" xmlns="http://www.w3.org/2000/svg" font-family="Barlow, Segoe UI, sans-serif">
    <defs>
      <clipPath id="clip-corpo"><rect x="${corpo.x + 3}" y="${corpo.y}" width="${corpo.w - 6}" height="${corpo.h - 3}"/></clipPath>
      <linearGradient id="grad-grao" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0" stop-color="#f3d98a"/><stop offset="1" stop-color="#d9b257"/>
      </linearGradient>
      <linearGradient id="grad-metal" x1="0" y1="0" x2="1" y2="0">
        <stop offset="0" stop-color="#aeb9bf"/><stop offset="0.5" stop-color="#d7dee2"/><stop offset="1" stop-color="#9aa6ad"/>
      </linearGradient>
    </defs>

    ${fluxoAr}
    <rect x="148" y="20" width="44" height="14" rx="3" fill="${corComporta}" stroke="#333" stroke-width="1"/>
    ${aberta ? '<rect x="152" y="23" width="36" height="8" fill="#fff" opacity="0.65"/>' : ''}

    <polygon points="${corpo.x},${corpo.y} 170,36 ${corpo.x + corpo.w},${corpo.y}" fill="url(#grad-metal)" stroke="#4f5b62" stroke-width="2.5" stroke-linejoin="round"/>

    <rect x="${corpo.x}" y="${corpo.y}" width="${corpo.w}" height="${corpo.h}" fill="#e9eef0" stroke="#4f5b62" stroke-width="2.5"/>
    <g clip-path="url(#clip-corpo)">
      <path d="M${corpo.x} ${yGrao + 6} Q170 ${yGrao - 8} ${corpo.x + corpo.w} ${yGrao + 6} V${corpo.y + corpo.h} H${corpo.x} Z" fill="url(#grad-grao)"/>
      ${nivel >= config.cargaMaxima ? `<rect x="${corpo.x}" y="${corpo.y}" width="${corpo.w}" height="8" fill="#c62828" opacity="0.5"/>` : ''}
    </g>
    <text x="${corpo.x + 10}" y="${Math.max(corpo.y + 18, yGrao + 22)}" font-size="12" font-weight="700" fill="#6b4f0e">${Util.grao(s.grao)} (${Util.num(nivel, 0)}%)</text>
    ${nivel < 20 ? `<text x="170" y="${corpo.y + 30}" text-anchor="middle" font-size="11" font-weight="600" fill="#0d3b66">Nível baixo de grãos</text>` : ''}

    ${helice(125, 80, s.atuadores.exaustor1, 'E01')}
    ${helice(215, 80, s.atuadores.exaustor2, 'E02')}
    <line x1="170" y1="${corpo.y + 4}" x2="170" y2="${corpo.y + corpo.h - 20}" stroke="#4f5b62" stroke-width="1.5"/>
    ${termopares}

    <polygon points="${corpo.x},${corpo.y + corpo.h} ${corpo.x + corpo.w},${corpo.y + corpo.h} 205,425 135,425" fill="#9aa6ad" stroke="#4f5b62" stroke-width="2.5" stroke-linejoin="round"/>
    <rect x="160" y="425" width="20" height="10" fill="#6b7470"/>

    ${s.comunicacao === 'FALHA' ? `<rect x="40" y="200" width="260" height="34" rx="6" fill="#2b2f2d" opacity="0.92"/><text x="170" y="222" text-anchor="middle" font-size="12" font-weight="700" fill="#ffd54f">Falha de comunicação — check hardware</text>` : ''}
  </svg>`;

  // texto acessível do SVG
  areaSvg.setAttribute('aria-label',
    `Corte do ${Util.nomeSilo(s.siloId)}: ${Util.num(nivel, 0)}% cheio, comporta ${aberta ? 'aberta' : 'fechada'}, ` +
    sensores.map(({ k, nome }) => `${nome} ${s.termopares[k] === null ? 'erro de leitura' : Util.num(s.termopares[k]) + ' graus'}`).join(', '));

  // Rótulo da comporta acima (visível sempre)
  const svg = areaSvg.querySelector('svg');
  const rotulo = document.createElementNS('http://www.w3.org/2000/svg', 'text');
  rotulo.setAttribute('x', '200');
  rotulo.setAttribute('y', '31');
  rotulo.setAttribute('font-size', '10');
  rotulo.setAttribute('font-weight', '700');
  rotulo.setAttribute('fill', corComporta);
  rotulo.textContent = `Comporta (${aberta ? 'ABERTA' : 'FECHADA'})`;
  svg.appendChild(rotulo);
}

/* ---------- Leituras ---------- */
function linha(icone, rotulo, valor, classe = '') {
  return `<li class="${classe}"><span class="rotulo">${icone} ${rotulo}</span><span class="valor">${valor}</span></li>`;
}

function atualizarLeituras(s) {
  const ct = Util.classeTemp(s.temperatura, config);
  const cc = Util.classeCo2(s.co2, config);
  const sufixoTemp = ct === 'critico' ? ' (crítico)' : ct === 'alerta' ? ' (alta)' : '';
  const sufixoCo2 = cc === 'critico' ? ' (crítico)' : cc === 'alerta' ? ' (elevado)' : '';
  const nomesAt = { LIGADO: 'Ligado', DESLIGADO: 'Desligado', FALHA: 'Falha' };
  const modo = s.modo === 'MANUAL' ? 'manual' : 'automação';

  listaLeituras.innerHTML = [
    linha('🌡️', 'Temperatura máxima', `${Util.num(s.temperatura)} °C${sufixoTemp}`, ct),
    linha('☁️', 'Concentração CO₂', `${s.co2.toLocaleString('pt-BR')} ppm${sufixoCo2}`, cc),
    linha('💧', 'Umidade relativa', `${Util.num(s.umidade)} % (limite 14%)`, s.umidade > 14 ? 'alerta' : ''),
    linha('📦', 'Nível de ocupação', `${Util.num(s.nivel)} %${s.statusCarga === 'BLOQUEADO_PARA_CARGA' ? ' — bloqueado para carga' : ''}`, s.statusCarga === 'BLOQUEADO_PARA_CARGA' ? 'critico' : ''),
    linha('🚪', 'Comporta superior', `${s.comporta === 'ABERTA' ? 'Aberta' : 'Fechada'} (${modo})`, s.comporta === 'ABERTA' ? 'ok' : ''),
    linha('🌀', 'Exaustores E01 / E02', `${nomesAt[s.atuadores.exaustor1]} / ${nomesAt[s.atuadores.exaustor2]}`,
      [s.atuadores.exaustor1, s.atuadores.exaustor2].includes('FALHA') ? 'critico' : s.exaustor === 'LIGADO' ? 'ok' : ''),
    linha('📡', 'Comunicação CLP', s.comunicacao === 'OK' ? `OK · ${Util.hora(s.timestamp)}` : 'Falha — mantendo última leitura', s.comunicacao === 'OK' ? '' : 'critico')
  ].join('');

  const grau = { NORMAL: '1 (baixo)', ALERTA: '2 (moderado)', CRITICO: '3 (elevado)' }[s.nivelRisco];
  const badge = document.getElementById('grau-risco');
  badge.textContent = `Grau de risco: ${grau}`;
  badge.className = `etiqueta ${s.nivelRisco === 'CRITICO' ? 'critico' : s.nivelRisco === 'ALERTA' ? 'alerta' : ''}`;

  document.getElementById('titulo').textContent = `Telemetria detalhada — ${Util.nomeSilo(s.siloId)} (${Util.grao(s.grao)})`;
  document.getElementById('d-capacidade').textContent = `${s.capacidadeTon.toLocaleString('pt-BR')} t`;
  document.getElementById('d-grao').textContent = Util.grao(s.grao);
  document.getElementById('d-umidade').textContent = `${Util.num(s.umidade)} %`;
}

/* ---------- Gráfico 24 h (canvas, sem bibliotecas) ---------- */
function desenharGrafico() {
  if (historico.length < 2) return;
  const dpr = window.devicePixelRatio || 1;
  const w = canvas.clientWidth;
  const h = canvas.clientHeight;
  canvas.width = w * dpr;
  canvas.height = h * dpr;
  const g = canvas.getContext('2d');
  g.scale(dpr, dpr);
  g.clearRect(0, 0, w, h);

  const m = { e: 40, d: 46, t: 10, b: 24 };
  const iw = w - m.e - m.d;
  const ih = h - m.t - m.b;
  const t0 = new Date(historico[0].t).getTime();
  const t1 = new Date(historico[historico.length - 1].t).getTime();
  const temps = historico.map((p) => p.temperatura);
  const co2s = historico.map((p) => p.co2);
  const tMin = Math.floor(Math.min(...temps, config.tempExaustor) - 1);
  const tMax = Math.ceil(Math.max(...temps, config.tempExaustor) + 1);
  const cMin = Math.floor(Math.min(...co2s) / 100) * 100;
  const cMax = Math.ceil(Math.max(...co2s, config.co2Alerta) / 100) * 100 + 100;

  const x = (t) => m.e + ((t - t0) / (t1 - t0 || 1)) * iw;
  const yT = (v) => m.t + ih - ((v - tMin) / (tMax - tMin)) * ih;
  const yC = (v) => m.t + ih - ((v - cMin) / (cMax - cMin)) * ih;

  g.font = '11px Barlow, Segoe UI, sans-serif';
  g.lineWidth = 1;

  // grade e eixos
  for (let i = 0; i <= 4; i++) {
    const yy = m.t + (ih / 4) * i;
    g.strokeStyle = '#e5e9e6';
    g.beginPath(); g.moveTo(m.e, yy); g.lineTo(m.e + iw, yy); g.stroke();
    g.fillStyle = '#c62828';
    g.textAlign = 'right';
    g.fillText((tMax - ((tMax - tMin) / 4) * i).toFixed(0), m.e - 6, yy + 4);
    g.fillStyle = '#0d3b66';
    g.textAlign = 'left';
    g.fillText(Math.round(cMax - ((cMax - cMin) / 4) * i), m.e + iw + 6, yy + 4);
  }
  g.fillStyle = '#5b6660';
  g.textAlign = 'center';
  for (let i = 0; i <= 4; i++) {
    const t = t0 + ((t1 - t0) / 4) * i;
    g.fillText(new Date(t).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' }), x(t), h - 6);
  }

  // limiar dos exaustores
  g.strokeStyle = '#e0a100';
  g.setLineDash([4, 4]);
  g.beginPath(); g.moveTo(m.e, yT(config.tempExaustor)); g.lineTo(m.e + iw, yT(config.tempExaustor)); g.stroke();
  g.setLineDash([]);

  const serie = (cor, fy, campo) => {
    g.strokeStyle = cor;
    g.lineWidth = 2;
    g.beginPath();
    historico.forEach((p, i) => {
      const px = x(new Date(p.t).getTime());
      const py = fy(p[campo]);
      i ? g.lineTo(px, py) : g.moveTo(px, py);
    });
    g.stroke();
  };
  serie('#0d3b66', yC, 'co2');
  serie('#c62828', yT, 'temperatura');
}

async function carregarHistorico() {
  try {
    const dados = await Util.api(`/api/silos/${siloId}/historico`);
    historico = dados.pontos;
    desenharGrafico();
  } catch (e) {
    Util.toast(`Não foi possível carregar o histórico: ${e.message}`, 'erro');
  }
}

window.addEventListener('resize', desenharGrafico);

function notificar(texto, critico, timestamp) {
  const el = document.createElement('div');
  el.className = `notificacao${critico ? ' critico' : ''}`;
  el.innerHTML = `<span aria-hidden="true">${critico ? '🚨' : '⚠️'}</span><span class="hora">${Util.hora(timestamp)}</span><span class="texto">${Util.escapar(texto)}</span><button type="button" aria-label="Dispensar notificação">×</button>`;
  el.querySelector('button').addEventListener('click', () => el.remove());
  areaNotif.prepend(el);
  while (areaNotif.children.length > 3) areaNotif.lastElementChild.remove();
}

/* ---------- SSE ---------- */
new ConexaoSSE({
  badge: document.getElementById('badge-sse'),
  handlers: {
    onSensorUpdate(estado) {
      if (!selSilo.options.length) {
        selSilo.innerHTML = estado.silos.map((s) => `<option value="${s.siloId}">${Util.nomeSilo(s.siloId)} (${Util.grao(s.grao)})</option>`).join('');
        selSilo.value = String(siloId);
      }
      const s = estado.silos.find((x) => x.siloId === siloId);
      if (!s) {
        areaSvg.innerHTML = `<p class="vazio">${Util.nomeSilo(siloId)} não existe. Volte ao dashboard e escolha um silo.</p>`;
        return;
      }
      atual = s;
      desenharSilo(s); // em falha de comunicação mantém os últimos dados com aviso sobreposto
      atualizarLeituras(s);

      // último ponto do gráfico acompanha a leitura em tempo real
      if (historico.length && s.comunicacao === 'OK') {
        historico[historico.length - 1] = { t: s.timestamp, temperatura: s.temperatura, co2: s.co2 };
        desenharGrafico();
      }
    },
    onConfig(cfg) {
      config = cfg;
      if (atual) desenharSilo(atual);
      desenharGrafico();
    },
    onAlarmeCritico(a) {
      notificar(a.mensagem, true, a.timestamp);
      if (a.sonoro) Alarme.tocar(4);
    },
    onNotificacao(n) {
      if (n.siloId === siloId) notificar(n.mensagem, false, n.timestamp);
    }
  }
}).iniciar();

carregarHistorico();
setInterval(carregarHistorico, 10 * 60 * 1000); // novo ponto a cada 10 min
