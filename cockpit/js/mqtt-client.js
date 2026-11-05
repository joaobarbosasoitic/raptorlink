// Cliente MQTT do painel (mqtt.js via WebSocket).
// Assina <raiz>/# e publica comandos em <raiz>/comandos.

export class MqttLink {
  constructor({ onMessage, onStatus }) {
    this.onMessage = onMessage;
    this.onStatus = onStatus;
    this.client = null;
    this.root = 'f22';
  }

  get connected() {
    return !!this.client?.connected;
  }

  get active() {
    return !!this.client;
  }

  connect(url, root = 'f22') {
    this.disconnect();
    this.root = root;
    if (!window.mqtt) {
      this.onStatus('error', 'mqtt.js não carregou (sem internet?)');
      return;
    }
    this.onStatus('connecting', url);
    const clientId = 'raptorlink-painel-' + Math.random().toString(16).slice(2, 10);
    let client;
    try {
      client = window.mqtt.connect(url, { clientId, reconnectPeriod: 3000, connectTimeout: 5000, clean: true });
    } catch (err) {
      this.onStatus('error', err.message);
      return;
    }
    this.client = client;

    client.on('connect', () => {
      client.subscribe(`${root}/#`, { qos: 1 });
      this.onStatus('connected', url);
    });
    client.on('reconnect', () => this.onStatus('connecting', url));
    client.on('offline', () => this.onStatus('connecting', url));
    client.on('error', (err) => this.onStatus('error', err.message));
    client.on('message', (topic, payload, packet) =>
      this.onMessage(topic, payload.toString(), { qos: packet?.qos ?? 0, retain: !!packet?.retain }));
  }

  disconnect() {
    if (!this.client) return;
    this.client.removeAllListeners();
    this.client.end(true);
    this.client = null;
    this.onStatus('disconnected');
  }

  publish(topic, value, { qos = 1, retain = false } = {}) {
    if (!this.connected) return false;
    const payload = typeof value === 'string' ? value : JSON.stringify(value);
    this.client.publish(topic, payload, { qos, retain });
    return true;
  }
}
