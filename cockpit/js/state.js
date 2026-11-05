// Estado do avião no painel + aplicação das mensagens MQTT do RaptorLink.
// Toda telemetria (motor real via broker ou mock local) entra por applyMessage().
import { TOPICS, DEFAULT_ROOT, decode } from './protocol.js';

export function createDefaultState() {
  const engine = () => ({ rpm: 0, egt: 0, thrust: 0, fuelFlow: 0, afterburner: false });
  return {
    flight: { airspeed: 0, mach: 0, altitude: 0, vvi: 0, heading: 0, pitch: 0, roll: 0, yaw: 0, aoa: 0, gload: 1, gmax: 1 },
    env: { windSpeed: 0, windDir: 0, oat: 0, turbulence: 0, gust: false },
    engine: { throttle: 0, left: engine(), right: engine() },
    fuel: { total: 0, consumption: 0, bingo: 1800, endurance: 0 },
    radar: { mode: 'RWS', range: 40, lockState: 'buscando', contacts: [] },
    targeting: { locked: false, targetId: null, range: 0, bearing: 0, closure: 0, aspect: 0, shootCue: false, inRange: false },
    weapons: {
      masterArm: false,
      selected: 'AIM-120',
      bays: { main: false, sideLeft: false, sideRight: false },
      stores: [],
      gun: 0,
      flares: 0,
      chaff: 0,
    },
    // f22/misseis: próprios e inimigos, em voo ou recém-finalizados
    missiles: [],
    nav: { waypoint: '', wptName: '', wptIndex: 0, wptBearing: 0, wptDistance: 0, ete: 0, lat: 0, lon: 0, groundSpeed: 0, track: 0, route: [] },
    comm: { com1: '', com2: '', iff: '' },
    systems: { gear: 'UP', flaps: 'UP', speedBrake: false, hydA: 0, hydB: 0, elecVolts: 0, apu: false, oxygen: 0 },
    threats: { missileLaunch: false, bearing: 0 },
    engineAlerts: [],
    engineStatus: { online: false, paused: false, id: '', intervalMs: 0, known: false },
    warnings: [], // alertas mesclados (motor + limites do painel), preenchido por alerts.js
  };
}

export const state = createDefaultState();
export const stats = { lastMessage: 0, total: 0, window: 0, rate: 0 };
export const config = { root: DEFAULT_ROOT };

/** Metadados por subtópico: contagem, horário, QoS, retain, valores planos e unidades. */
export const topicMeta = {};

/** Log das últimas mensagens (inclusive comandos). */
export const messageLog = [];
const LOG_MAX = 200;

const listeners = new Set();
/** fn({ sub, topic, msg, meta, plain, units }) é chamada a cada mensagem recebida. */
export function onMessage(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

/**
 * @param {string} topic  ex.: f22/nav
 * @param {string} raw    payload JSON
 * @param {{qos?: number, retain?: boolean}} meta
 */
export function applyMessage(topic, raw, meta = {}) {
  const prefix = `${config.root}/`;
  if (!topic.startsWith(prefix)) return false;
  const sub = topic.slice(prefix.length);
  const text = typeof raw === 'string' ? raw : String(raw);

  let msg = null;
  try { msg = JSON.parse(text); } catch { /* payload não-JSON: só vai para o log */ }

  const entry = {
    time: Date.now(),
    topic,
    sub,
    qos: meta.qos ?? 0,
    retain: !!meta.retain,
    bytes: text.length,
    payload: text,
  };
  messageLog.unshift(entry);
  if (messageLog.length > LOG_MAX) messageLog.length = LOG_MAX;

  let decoded = null;
  if (msg && TOPICS[sub] && sub !== 'comandos') {
    decoded = decode(sub, msg, state);
    if (sub === 'status' && decoded) state.engineStatus.known = true;
  }

  if (decoded) {
    const m = topicMeta[sub] || (topicMeta[sub] = { count: 0 });
    Object.assign(m, {
      count: m.count + 1,
      last: performance.now(),
      ts: msg.ts || null,
      seq: msg.seq ?? null,
      origem: msg.origem || '',
      qos: entry.qos,
      retain: entry.retain,
      plain: decoded.plain,
      units: decoded.units,
    });
    if (sub !== 'status') {
      stats.lastMessage = performance.now();
      stats.total++;
      stats.window++;
    }
  }

  for (const fn of listeners) fn({ sub, topic, msg, meta: entry, plain: decoded?.plain, units: decoded?.units });
  return !!decoded;
}

export function resetState() {
  for (const k of Object.keys(state)) delete state[k];
  Object.assign(state, createDefaultState());
  for (const k of Object.keys(topicMeta)) delete topicMeta[k];
  messageLog.length = 0;
  stats.lastMessage = 0;
}
