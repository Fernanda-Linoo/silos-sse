/* Tela 1 — Dashboard geral de monitoramento (US-01, RF-07) */

const grade = document.getElementById('grade');
const tpl = document.getElementById('tpl-card');
const areaNotif = document.getElementById('notificacoes');
const resumo = document.getElementById('resumo');

let config = { tempExaustor: 30, tempCritica: 35, co2Alerta: 1000, co2Critico: 1500, cargaMaxima: 98 };
let filtroRisco = 'TODOS';
let filtroGrao = 'TODOS';
const cards = new Map();     // siloId → elemento
const tendencias = new Map(); // siloId → últimas temperaturas
let ultimoEstado = null;

configurarBotaoSom(document.getElementById('btn-som'));

/* ---------- Filtros ---------- */
document.querySelectorAll('[data-risco]').forEach((b) =>
  b.addEventListener('click', () => {
    filtroRisco = b.dataset.risco;
    document.querySelectorAll('[data-risco]').forEach((x) => x.setAttribute('aria-pressed', String(x === b)));
    aplicarFiltros();
  })
);
document.getElementById('filtro-grao').addEventListener('change', (e) => {
  filtroGrao = e.target.value;
  aplicarFiltros();
});

function aplicarFiltros() {
  if (!ultimoEstado) return;
  let visiveis = 0;
  for (const s of ultimoEstado.silos) {
    const el = cards.get(s.siloId);
    const passaRisco = filtroRisco === 'TODOS' || s.nivelRisco !== 'NORMAL';
    const passaGrao = filtroGrao === 'TODOS' || s.grao === filtroGrao;
    const mostrar = passaRisco && passaGrao;
    el.hidden = !mostrar;
    if (mostrar) visiveis++;
  }
  let vazio = grade.querySelector('.vazio');
  if (!visiveis) {
    if (!vazio) {
      vazio = document.createElement('p');
      vazio.className = 'vazio';
      grade.appendChild(vazio);
    }
    vazio.textContent = filtroRisco === 'ALERTAS' ? 'Nenhum silo em alerta. Todos operando normalmente.' : 'Nenhum silo com esse tipo de grão.';
  } else if (vazio) {
    vazio.remove();
  }
}

/* ---------- Cards ---------- */
function criarCard(s) {
  const el = tpl.content.firstElementChild.cloneNode(true);
  el.dataset.id = s.siloId;
  const urlDetalhe = `tela2-detalhe.html?siloId=${s.siloId}`;
  const det = el.querySelector('[data-c="detalhe"]');
  det.href = urlDetalhe;
  det.setAttribute('aria-label', `Ver detalhes do ${Util.nomeSilo(s.siloId)}`);
  const ctl = el.querySelector('[data-c="controle"]');
  ctl.href = `tela3-controle.html?siloId=${s.siloId}`;
  ctl.setAttribute('aria-label', `Controlar atuadores do ${Util.nomeSilo(s.siloId)}`);

  // Card inteiro clicável (exceto os botões, que têm destino próprio)
  el.addEventListener('click', (e) => { if (!e.target.closest('a')) location.href = urlDetalhe; });
  el.addEventListener('keydown', (e) => { if (e.key === 'Enter' && e.target === el) location.href = urlDetalhe; });

  grade.querySelector('.vazio')?.remove();
  grade.appendChild(el);
  cards.set(s.siloId, el);
  tendencias.set(s.siloId, []);
  return el;
}

function atualizarCard(s) {
  const el = cards.get(s.siloId) || criarCard(s);
  const c = (n) => el.querySelector(`[data-c="${n}"]`);

  el.dataset.risco = s.nivelRisco;
  el.classList.toggle('piscando', s.alarme === 'SUPERAQUECIMENTO' && !matchMedia('(prefers-reduced-motion: reduce)').matches);
  el.classList.toggle('sem-sinal', s.comunicacao === 'FALHA');
  el.setAttribute('aria-label', `${Util.nomeSilo(s.siloId)}, ${Util.grao(s.grao)}, ${Util.textoRisco(s.nivelRisco)}`);

  c('nome').textContent = Util.nomeSilo(s.siloId);
  c('grao').textContent = Util.grao(s.grao);

  const st = c('status');
  st.textContent = s.alarme === 'NORMAL' ? Util.textoRisco(s.nivelRisco) : Util.textoAlarme(s.alarme);
  st.className = `etiqueta ${Util.classeRisco(s.nivelRisco)}`;

  const carga = c('carga');
  carga.classList.toggle('oculto', s.statusCarga === 'ESTAVEL');
  carga.textContent = s.statusCarga === 'BLOQUEADO_PARA_CARGA' ? 'Bloqueado para carga' : 'Carregando';
  carga.className = `etiqueta ${s.statusCarga === 'BLOQUEADO_PARA_CARGA' ? 'critico' : 'info'}${s.statusCarga === 'ESTAVEL' ? ' oculto' : ''}`;

  c('nivel').textContent = `${Util.num(s.nivel, 0)}%`;
  const barra = c('barra');
  barra.firstElementChild.style.width = `${Math.min(100, s.nivel)}%`;
  barra.classList.toggle('cheia', s.nivel >= config.cargaMaxima);
  barra.classList.toggle('carregando', s.statusCarga === 'CARREGANDO');

  c('temp').textContent = `${Util.num(s.temperatura)} °C`;
  el.querySelector('[data-m="temp"]').className = `metrica ${Util.classeTemp(s.temperatura, config)}`;
  c('umidade').textContent = `${Util.num(s.umidade)} %`;
  c('co2').textContent = `${s.co2.toLocaleString('pt-BR')} ppm`;
  el.querySelector('[data-m="co2"]').className = `metrica ${Util.classeCo2(s.co2, config)}`;
  c('atuadores').textContent = `${s.exaustor === 'LIGADO' ? 'Ligado' : 'Deslig.'} / ${s.comporta === 'ABERTA' ? 'Aberta' : 'Fechada'}${s.modo === 'MANUAL' ? ' · manual' : ''}`;

  // Tendência (últimas 40 leituras ≈ 80 s)
  if (s.comunicacao === 'OK') {
    const buf = tendencias.get(s.siloId);
    buf.push(s.temperatura);
    if (buf.length > 40) buf.shift();
    desenharSparkline(c('spark'), buf, s.nivelRisco);
  }
}

function desenharSparkline(canvas, valores, risco) {
  const dpr = window.devicePixelRatio || 1;
  const w = canvas.clientWidth;
  const h = canvas.clientHeight;
  if (!w) return;
  canvas.width = w * dpr;
  canvas.height = h * dpr;
  const g = canvas.getContext('2d');
  g.scale(dpr, dpr);
  g.clearRect(0, 0, w, h);
  if (valores.length < 2) return;
  const min = Math.min(...valores) - 0.3;
  const max = Math.max(...valores) + 0.3;
  const x = (i) => (i / (valores.length - 1)) * w;
  const y = (v) => h - 3 - ((v - min) / (max - min)) * (h - 6);

  // linha do limiar dos exaustores, se visível na escala
  if (config.tempExaustor > min && config.tempExaustor < max) {
    g.strokeStyle = '#e0a100';
    g.setLineDash([3, 3]);
    g.beginPath();
    g.moveTo(0, y(config.tempExaustor));
    g.lineTo(w, y(config.tempExaustor));
    g.stroke();
    g.setLineDash([]);
  }
  g.strokeStyle = risco === 'CRITICO' ? '#c62828' : risco === 'ALERTA' ? '#b26a00' : '#1d7a43';
  g.lineWidth = 2;
  g.beginPath();
  valores.forEach((v, i) => (i ? g.lineTo(x(i), y(v)) : g.moveTo(x(i), y(v))));
  g.stroke();
}

function atualizarResumo(estado) {
  const n = { NORMAL: 0, ALERTA: 0, CRITICO: 0 };
  estado.silos.forEach((s) => n[s.nivelRisco]++);
  resumo.textContent = `${estado.silos.length} silos · ${n.NORMAL} normais · ${n.ALERTA} em alerta · ${n.CRITICO} críticos · última leitura ${Util.hora(estado.timestamp)}`;
}

/* ---------- Notificações na barra superior ---------- */
function notificar(texto, critico, timestamp) {
  const el = document.createElement('div');
  el.className = `notificacao${critico ? ' critico' : ''}`;
  el.innerHTML = `<span aria-hidden="true">${critico ? '🚨' : '⚠️'}</span><span class="hora">${Util.hora(timestamp)}</span><span class="texto">${Util.escapar(texto)}</span><button type="button" aria-label="Dispensar notificação">×</button>`;
  el.querySelector('button').addEventListener('click', () => el.remove());
  areaNotif.prepend(el);
  while (areaNotif.children.length > 4) areaNotif.lastElementChild.remove();
}

/* ---------- Conexão SSE ---------- */
new ConexaoSSE({
  badge: document.getElementById('badge-sse'),
  handlers: {
    onSensorUpdate(estado) {
      ultimoEstado = estado;
      estado.silos.forEach(atualizarCard);
      atualizarResumo(estado);
      aplicarFiltros();
    },
    onConfig(cfg) { config = cfg; },
    onAlarmeCritico(a) {
      notificar(a.mensagem, true, a.timestamp);
      if (a.sonoro) Alarme.tocar(4);
    },
    onNotificacao(n) { notificar(n.mensagem, n.severidade === 'CRITICO', n.timestamp); }
  }
}).iniciar();
