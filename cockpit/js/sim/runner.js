// Laço do motor de simulação: avança o núcleo em passos curtos e publica as
// leituras de cada subsistema em intervalos regulares (padrão 1 s, como na proposta).
// O transporte é injetado: MQTT real (engine/index.js) ou direto no painel (modo MOCK).
import { TOPICS, DEFAULT_ROOT, PROTOCOL_VERSION, envelope } from '../protocol.js';

export class SimRunner {
  /**
   * @param {import('./core.js').SimCore} core
   * @param {(topic: string, payload: string, opts: {qos: number, retain: boolean}) => void} publish
   */
  constructor(core, publish, { publishMs = 1000, missileMs = 250, tickMs = 50, origem = 'motor-raptor-01', root = DEFAULT_ROOT } = {}) {
    this.missileMs = Math.min(missileMs, publishMs);
    this.sinceMissiles = 0;
    this.core = core;
    this.publish = publish;
    this.publishMs = publishMs;
    this.tickMs = tickMs;
    this.origem = origem;
    this.root = root;
    this.seq = 0;
    this.timer = null;
    this.sinceLast = 0;
  }

  get running() {
    return !!this.timer;
  }

  start() {
    if (this.timer) return;
    let last = Date.now();
    this.timer = setInterval(() => {
      const now = Date.now();
      const dt = Math.min(0.25, (now - last) / 1000);
      last = now;
      this.core.step(dt);
      this.sinceLast += dt * 1000;
      this.sinceMissiles += dt * 1000;
      if (this.sinceLast >= this.publishMs) {
        this.sinceLast = 0;
        this.sinceMissiles = 0;
        this.publishAll();
      } else if (this.core.missiles?.length && this.sinceMissiles >= this.missileMs) {
        // rastreamento: enquanto houver míssil no ar, f22/misseis sai com mais frequência
        this.sinceMissiles = 0;
        this.send('misseis', this.core.missileReadings());
      }
    }, this.tickMs);
    this.publishStatus(true);
    this.publishAll();
  }

  stop() {
    clearInterval(this.timer);
    this.timer = null;
  }

  send(sub, dados) {
    const t = TOPICS[sub];
    const msg = envelope(dados, { seq: ++this.seq, origem: this.origem });
    this.publish(`${this.root}/${sub}`, JSON.stringify(msg), { qos: t.qos, retain: t.retain });
  }

  publishAll() {
    const r = this.core.readings();
    for (const sub of Object.keys(r)) this.send(sub, r[sub]);
  }

  statusPayload(online) {
    return {
      online,
      pausado: !!this.core.paused,
      id: this.origem,
      versao: PROTOCOL_VERSION,
      intervaloMs: { valor: this.publishMs, unidade: 'ms' },
    };
  }

  publishStatus(online = true) {
    this.send('status', this.statusPayload(online));
  }

  /** Aplica um comando de f22/comandos e publica o novo estado imediatamente. */
  handleCommand(cmd) {
    const wasPaused = this.core.paused;
    const res = this.core.command(cmd);
    if (this.core.paused !== wasPaused || cmd?.comando === 'reiniciar') this.publishStatus(true);
    this.publishAll();
    return res;
  }
}
