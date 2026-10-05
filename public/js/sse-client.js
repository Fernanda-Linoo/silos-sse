/**
 * Cliente SSE compartilhado — RNF-02 (tolerância a falhas)
 *
 *  - Abre EventSource em /api/silos/stream e repassa cada evento aos handlers.
 *  - Ao detectar falha: muda o badge para "falha", fecha a conexão e tenta
 *    reconectar periodicamente (backoff 2 s → 4 s → 8 s → máx. 15 s).
 *  - Ao reconectar: solicita o estado consolidado (GET /api/silos e /api/log)
 *    para ressincronizar o painel.
 *  - Watchdog: se nenhum sensor_update chegar em 7 s, considera a conexão perdida.
 */
class ConexaoSSE {
  constructor({ url = '/api/silos/stream', badge, handlers = {} }) {
    this.url = url;
    this.badge = badge;
    this.h = handlers;
    this.es = null;
    this.tentativas = 0;
    this.timerReconexao = null;
    this.timerWatchdog = null;
    this.jaConectou = false;
  }

  iniciar() {
    this.conectar();
    window.addEventListener('online', () => this.reconectarAgora());
  }

  estado(e, texto) {
    if (!this.badge) return;
    this.badge.dataset.estado = e;
    this.badge.querySelector('.texto').textContent = texto;
    this.h.onEstado?.(e);
  }

  conectar() {
    clearTimeout(this.timerReconexao);
    this.estado('conectando', this.tentativas ? `Reconectando (tentativa ${this.tentativas})` : 'Conectando…');

    const es = new EventSource(this.url);
    this.es = es;

    es.addEventListener('open', () => {
      const eraReconexao = this.jaConectou;
      this.jaConectou = true;
      this.tentativas = 0;
      this.estado('ok', 'EventStream ativo');
      this.armarWatchdog();
      if (eraReconexao) this.ressincronizar();
    });

    es.addEventListener('sensor_update', (ev) => {
      this.armarWatchdog();
      this.h.onSensorUpdate?.(JSON.parse(ev.data));
    });
    es.addEventListener('log_snapshot', (ev) => this.h.onLogSnapshot?.(JSON.parse(ev.data)));
    es.addEventListener('log_update', (ev) => this.h.onLog?.(JSON.parse(ev.data)));
    es.addEventListener('alarme_critico', (ev) => this.h.onAlarmeCritico?.(JSON.parse(ev.data)));
    es.addEventListener('notificacao', (ev) => this.h.onNotificacao?.(JSON.parse(ev.data)));
    es.addEventListener('config_update', (ev) => this.h.onConfig?.(JSON.parse(ev.data)));

    es.addEventListener('error', () => this.falhou());
  }

  falhou() {
    clearTimeout(this.timerWatchdog);
    if (this.es) { this.es.close(); this.es = null; }
    this.tentativas++;
    const espera = Math.min(15000, 2000 * 2 ** (this.tentativas - 1));
    this.estado('falha', `Conexão perdida — nova tentativa em ${Math.round(espera / 1000)} s`);
    this.timerReconexao = setTimeout(() => this.conectar(), espera);
  }

  reconectarAgora() {
    if (this.badge?.dataset.estado === 'ok') return;
    if (this.es) { this.es.close(); this.es = null; }
    this.conectar();
  }

  armarWatchdog() {
    clearTimeout(this.timerWatchdog);
    this.timerWatchdog = setTimeout(() => this.falhou(), 7000);
  }

  async ressincronizar() {
    try {
      const [estado, log] = await Promise.all([Util.api('/api/silos'), Util.api('/api/log')]);
      this.h.onSensorUpdate?.(estado);
      this.h.onLogSnapshot?.(log);
      Util.toast('Conexão restabelecida. Estado dos silos sincronizado.', 'ok');
    } catch (e) {
      console.warn('Falha ao ressincronizar', e);
    }
  }
}
