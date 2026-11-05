#!/usr/bin/env node
// Motor de simulação RaptorLink: gera os dados dos sensores do F-22 e publica no broker MQTT.
// Recebe comandos do painel em <raiz>/comandos e os aplica ao cenário.
//
// Variáveis de ambiente:
//   MQTT_URL      mqtt://localhost:1883
//   PUBLISH_MS    1000          intervalo de publicação (ms)
//   TOPIC_ROOT    f22           prefixo dos tópicos
//   ENGINE_ID     motor-raptor-01
//   FUEL_BURN_X   6             acelera o consumo de combustível (demo)
//   MQTT_USER / MQTT_PASS       credenciais, se o broker exigir
import mqtt from 'mqtt';
import { SimCore } from '../cockpit/js/sim/core.js';
import { SimRunner } from '../cockpit/js/sim/runner.js';
import { TOPICS, envelope } from '../cockpit/js/protocol.js';

const URL = process.env.MQTT_URL || 'mqtt://localhost:1883';
const PUBLISH_MS = Math.max(100, +process.env.PUBLISH_MS || 1000);
const ROOT = (process.env.TOPIC_ROOT || 'f22').replace(/\/+$/, '');
const ID = process.env.ENGINE_ID || 'motor-raptor-01';
const FUEL_BURN_X = +process.env.FUEL_BURN_X || 6;

const log = (...a) => console.log(new Date().toISOString().slice(11, 19), ...a);

const core = new SimCore({ fuelBurnX: FUEL_BURN_X });
let client;
const runner = new SimRunner(
  core,
  (topic, payload, opts) => client?.connected && client.publish(topic, payload, opts),
  { publishMs: PUBLISH_MS, origem: ID, root: ROOT },
);

const statusTopic = `${ROOT}/status`;
const willPayload = JSON.stringify(envelope({ online: false, pausado: false, id: ID }, { origem: ID }));

client = mqtt.connect(URL, {
  clientId: `${ID}-${Math.random().toString(16).slice(2, 8)}`,
  username: process.env.MQTT_USER,
  password: process.env.MQTT_PASS,
  reconnectPeriod: 2000,
  connectTimeout: 5000,
  will: { topic: statusTopic, payload: willPayload, qos: 1, retain: true }, // LWT: motor caiu → offline
});

client.on('connect', () => {
  log(`conectado a ${URL} — publicando em ${ROOT}/* a cada ${PUBLISH_MS} ms`);
  client.subscribe(`${ROOT}/comandos`, { qos: TOPICS.comandos.qos }, (err) => {
    if (err) log('erro ao assinar comandos:', err.message);
    else log(`aguardando comandos em ${ROOT}/comandos`);
  });
  if (!runner.running) runner.start();
  else runner.publishStatus(true);
});

client.on('reconnect', () => log('reconectando…'));
client.on('offline', () => log('broker indisponível'));
client.on('error', (err) => log('erro MQTT:', err.message));

client.on('message', (topic, buf) => {
  let cmd;
  try {
    cmd = JSON.parse(buf.toString());
  } catch {
    log('comando ignorado (JSON inválido):', buf.toString().slice(0, 120));
    return;
  }
  if (!cmd || typeof cmd.comando !== 'string') {
    log('comando ignorado (sem campo "comando")');
    return;
  }
  const res = runner.handleCommand(cmd);
  const val = cmd.valor === undefined ? '' : JSON.stringify(cmd.valor);
  log(`comando ${res.ok ? '✓' : '✗'} ${cmd.comando} ${val} ← ${cmd.origem || '?'}${res.erro ? ` (${res.erro})` : ''}`);
});

// resumo periódico no terminal
setInterval(() => {
  const r = core.readings();
  log(
    `${core.paused ? '[PAUSADO] ' : ''}alt ${r.nav.altitude.valor} ft · ${r.nav.velocidade.valor} kt · M${r.nav.mach.valor}`
      + ` · G ${r.atitude.forcaG.valor} · comb ${r.combustivel.quantidade.valor} kg`
      + ` · vento ${r.ambiente.ventoDirecao.valor}°/${r.ambiente.ventoVelocidade.valor} kt`
      + ` · mira ${r.radar.estadoMira} · mísseis no ar ${r.misseis.emVoo} · alertas ${r.alertas.lista.length}`,
  );
}, 10000);

function shutdown() {
  log('encerrando: publicando status offline');
  runner.stop();
  if (!client.connected) process.exit(0);
  client.publish(statusTopic, willPayload, { qos: 1, retain: true }, () => client.end(false, () => process.exit(0)));
  setTimeout(() => process.exit(0), 1500);
}
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
