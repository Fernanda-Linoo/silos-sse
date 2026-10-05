/* Utilitários compartilhados pelas três telas */

const Util = {
  /** Lê ?siloId=N da URL (padrão: 2, o silo do fluxo feliz) */
  siloIdDaURL(padrao = 2) {
    const v = Number(new URLSearchParams(location.search).get('siloId'));
    return Number.isInteger(v) && v > 0 ? v : padrao;
  },

  nomeSilo(id) {
    return `Silo ${String(id).padStart(2, '0')}`;
  },

  grao(g) {
    return { MILHO: 'Milho', SOJA: 'Soja', TRIGO: 'Trigo', SORGO: 'Sorgo' }[g] || g;
  },

  hora(iso) {
    return new Date(iso).toLocaleTimeString('pt-BR', { hour12: false });
  },

  num(v, casas = 1) {
    return v === null || v === undefined ? '—' : Number(v).toLocaleString('pt-BR', { minimumFractionDigits: casas, maximumFractionDigits: casas });
  },

  escapar(t) {
    const d = document.createElement('div');
    d.textContent = t ?? '';
    return d.innerHTML;
  },

  /** Classe visual de uma grandeza conforme os limiares do servidor */
  classeTemp(t, cfg) {
    if (t === null || t === undefined) return '';
    if (t >= cfg.tempCritica) return 'critico';
    if (t >= cfg.tempExaustor) return 'alerta';
    return '';
  },
  classeCo2(c, cfg) {
    if (c >= cfg.co2Critico) return 'critico';
    if (c >= cfg.co2Alerta) return 'alerta';
    return '';
  },

  textoRisco(risco) {
    return { NORMAL: 'Status: OK', ALERTA: 'Alerta', CRITICO: 'Alerta crítico' }[risco] || risco;
  },
  classeRisco(risco) {
    return { NORMAL: '', ALERTA: 'alerta', CRITICO: 'critico' }[risco] || '';
  },

  textoAlarme(a) {
    return {
      NORMAL: 'Normal',
      CO2_ELEVADO: 'CO₂ elevado',
      CO2_CRITICO: 'CO₂ crítico',
      ALERTA_TEMPERATURA: 'Temperatura alta',
      SUPERAQUECIMENTO: 'Superaquecimento'
    }[a] || a;
  },

  /** fetch com JSON e tratamento de erro padronizado */
  async api(url, { metodo = 'GET', corpo } = {}) {
    const opcoes = { method: metodo, headers: {} };
    if (corpo !== undefined) {
      opcoes.headers['Content-Type'] = 'application/json';
      opcoes.body = JSON.stringify(corpo);
    }
    let resp;
    try {
      resp = await fetch(url, opcoes);
    } catch {
      throw Object.assign(new Error('Servidor indisponível. Verifique se o backend está rodando.'), { status: 0 });
    }
    const dados = await resp.json().catch(() => ({}));
    if (!resp.ok) throw Object.assign(new Error(dados.mensagem || `Erro HTTP ${resp.status}`), { status: resp.status, dados });
    return dados;
  },

  toast(texto, tipo = '') {
    let area = document.querySelector('.toast-area');
    if (!area) {
      area = document.createElement('div');
      area.className = 'toast-area';
      area.setAttribute('role', 'status');
      area.setAttribute('aria-live', 'polite');
      document.body.appendChild(area);
    }
    const el = document.createElement('div');
    el.className = `toast ${tipo}`;
    el.textContent = texto;
    area.appendChild(el);
    setTimeout(() => el.remove(), 4500);
  }
};

/* ---------- Alarme sonoro (Web Audio, sem arquivos externos) ---------- */
const Alarme = {
  ctx: null,
  ativo: localStorage.getItem('somAlarme') !== 'off',

  desbloquear() {
    if (!this.ctx) {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (AC) this.ctx = new AC();
    }
    if (this.ctx && this.ctx.state === 'suspended') this.ctx.resume();
  },

  alternar() {
    this.ativo = !this.ativo;
    try { localStorage.setItem('somAlarme', this.ativo ? 'on' : 'off'); } catch {}
    if (this.ativo) this.desbloquear();
    return this.ativo;
  },

  tocar(repeticoes = 3) {
    if (!this.ativo) return;
    this.desbloquear();
    if (!this.ctx) return;
    const t0 = this.ctx.currentTime;
    for (let i = 0; i < repeticoes; i++) {
      for (const [freq, desloc] of [[880, 0], [660, 0.22]]) {
        const osc = this.ctx.createOscillator();
        const gan = this.ctx.createGain();
        osc.type = 'square';
        osc.frequency.value = freq;
        const ini = t0 + i * 0.5 + desloc;
        gan.gain.setValueAtTime(0.0001, ini);
        gan.gain.exponentialRampToValueAtTime(0.18, ini + 0.02);
        gan.gain.exponentialRampToValueAtTime(0.0001, ini + 0.2);
        osc.connect(gan).connect(this.ctx.destination);
        osc.start(ini);
        osc.stop(ini + 0.21);
      }
    }
  }
};

// O navegador só libera áudio após uma interação do usuário
document.addEventListener('pointerdown', () => Alarme.ativo && Alarme.desbloquear(), { once: true });

/** Liga um botão de som no topo da página */
function configurarBotaoSom(botao) {
  if (!botao) return;
  const pintar = () => {
    botao.setAttribute('aria-pressed', String(Alarme.ativo));
    botao.textContent = Alarme.ativo ? '🔔 Som do alarme ligado' : '🔕 Som do alarme desligado';
  };
  pintar();
  botao.addEventListener('click', () => { Alarme.alternar(); pintar(); });
}
