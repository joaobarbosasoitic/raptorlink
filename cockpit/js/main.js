// Bootstrap do painel RaptorLink: cockpit + estação de solo, fonte de dados (mock/MQTT),
// comandos em <raiz>/comandos, som e atalhos.
import { state, stats, config, applyMessage, resetState } from './state.js';
import { MqttLink } from './mqtt-client.js';
import { SimCore } from './sim/core.js';
import { SimRunner } from './sim/runner.js';
import { TOPICS, DEFAULT_ROOT, PROTOCOL_VERSION, cockpitCommand } from './protocol.js';
import { limitAlerts, mergeAlerts } from './alerts.js';
import { createView, updateView } from './smooth.js';
import { C, drawOSB, txt, box, norm360, pad, thousands } from './displays/common.js';
import { hud } from './displays/hud.js';
import { pmd } from './displays/pmd.js';
import { mfdLeft } from './displays/mfd-left.js';
import { mfdRight } from './displays/mfd-right.js';
import { smd } from './displays/smd.js';
import { ufdLeft, ufdRight } from './displays/ufd.js';
import { initICP } from './displays/icp.js';
import { initGround } from './ground/ground.js';

const DESIGN = { w: 1600, h: 1090 };
const STALE_MS = 3500; // telemetria chega a ~1 Hz
const $ = (id) => document.getElementById(id);

const ui = {
  source: 'mock',
  tab: 'cockpit',
  pages: { mfdL: 'ENG', mfdR: 'NAV' },
  declutter: false,
  muted: false,
  ack: { warning: '', caution: '' },
  alerts: { warnKey: '', cautKey: '' },
};

const storage = {
  get(k, d) { try { return localStorage.getItem(k) ?? d; } catch { return d; } },
  set(k, v) { try { localStorage.setItem(k, v); } catch { /* sem storage */ } },
};

// ------------------------------------------------------------------ fonte de dados
const core = new SimCore();
const mock = new SimRunner(core, (topic, payload, opts) => applyMessage(topic, payload, opts), {
  publishMs: 1000,
  origem: 'mock-navegador',
});
const link = new MqttLink({ onMessage: applyMessage, onStatus: setStatus });

/** Envia um comando já no formato do protocolo ({ comando, valor, origem, ts }). */
function dispatch(cmd) {
  if (!cmd) return false;
  const topic = `${config.root}/comandos`;
  if (ui.source === 'mqtt') {
    const ok = link.publish(topic, cmd, { qos: TOPICS.comandos.qos });
    if (!ok) flashStatus('SEM CONEXÃO MQTT');
    return ok;
  }
  // modo mock: registra no log como se tivesse passado pelo broker e aplica no núcleo local
  applyMessage(topic, JSON.stringify(cmd), { qos: TOPICS.comandos.qos, retain: false });
  mock.handleCommand(cmd);
  return true;
}

/** Ações do cockpit (nomes internos) → comando do protocolo. */
function sendCommand(action, value = 'toggle') {
  return dispatch(cockpitCommand(action, value));
}
const api = { cmd: sendCommand, ui };

let statusTimer = null;
function setStatus(status, detail = '') {
  $('statusDot').className = status;
  const map = {
    mock: 'MOCK LOCAL',
    connecting: 'CONECTANDO…',
    connected: 'CONECTADO',
    disconnected: 'DESCONECTADO',
    error: `ERRO: ${detail}`,
  };
  $('statusText').textContent = map[status] || status;
  $('statusText').title = detail;
  $('btnConnect').textContent = link.active ? 'DESCONECTAR' : 'CONECTAR';
}

function flashStatus(msg) {
  const el = $('statusText');
  const prev = el.textContent;
  el.textContent = msg;
  clearTimeout(statusTimer);
  statusTimer = setTimeout(() => { el.textContent = prev; }, 1500);
}

function setSource(src) {
  if (src === ui.source) return;
  ui.source = src;
  document.querySelectorAll('#srcSeg button').forEach((b) => b.classList.toggle('on', b.dataset.src === src));
  resetState();
  snapView = true;
  ground.reset();
  hideHit();
  hitSeen.clear();
  if (src === 'mock') {
    link.disconnect();
    config.root = DEFAULT_ROOT;
    core.reset();
    mock.start();
    setStatus('mock');
  } else {
    mock.stop();
    setStatus('disconnected');
  }
}

$('srcSeg').addEventListener('click', (e) => {
  const b = e.target.closest('button');
  if (b) setSource(b.dataset.src);
});

$('brokerUrl').value = storage.get('raptorlink.broker', 'ws://localhost:9001');
$('topicRoot').value = storage.get('raptorlink.root', DEFAULT_ROOT);
$('btnConnect').addEventListener('click', () => {
  if (link.active) {
    link.disconnect();
    return;
  }
  setSource('mqtt');
  const url = $('brokerUrl').value.trim();
  const root = ($('topicRoot').value.trim() || DEFAULT_ROOT).replace(/[#+]/g, '').replace(/\/+$/, '');
  $('topicRoot').value = root;
  storage.set('raptorlink.broker', url);
  storage.set('raptorlink.root', root);
  config.root = root;
  link.connect(url, root);
});
['brokerUrl', 'topicRoot'].forEach((id) => $(id).addEventListener('keydown', (e) => {
  if (e.key === 'Enter') $('btnConnect').click();
}));

// ------------------------------------------------------------------ abas
function setTab(tab) {
  ui.tab = tab;
  document.querySelectorAll('#tabs button').forEach((b) => b.classList.toggle('on', b.dataset.tab === tab));
  $('stage').hidden = tab !== 'cockpit';
  $('ground').hidden = tab !== 'ground';
  ground.setVisible(tab === 'ground');
  storage.set('raptorlink.tab', tab);
}
$('tabs').addEventListener('click', (e) => {
  const b = e.target.closest('button');
  if (b) setTab(b.dataset.tab);
});

// ------------------------------------------------------------------ telas do cockpit
const view = createView(state);
let snapView = true;
const displays = { hud, pmd, mfdL: mfdLeft, mfdR: mfdRight, smd, ufdL: ufdLeft, ufdR: ufdRight };
const screens = [];

document.querySelectorAll('[data-screen]').forEach((el) => {
  const id = el.dataset.screen;
  const d = displays[id];
  let canvas;
  let w;
  let h;
  if (el.tagName === 'CANVAS') {
    canvas = el;
    w = +el.dataset.w;
    h = +el.dataset.h;
  } else {
    w = h = +el.dataset.size;
    el.style.setProperty('--s', `${w}px`);
    for (const side of ['top', 'left', 'right', 'bottom']) {
      const row = document.createElement('div');
      row.className = `osb-row osb-${side}`;
      for (let i = 0; i < 5; i++) {
        const b = document.createElement('button');
        b.className = 'osb';
        b.dataset.side = side;
        b.dataset.i = i;
        b.setAttribute('aria-label', `OSB ${side} ${i + 1}`);
        row.appendChild(b);
      }
      el.appendChild(row);
    }
    canvas = document.createElement('canvas');
    el.appendChild(canvas);
    el.addEventListener('click', (e) => {
      const b = e.target.closest('.osb');
      if (!b || !d.osb) return;
      const entry = d.osb(view, ui, api)[b.dataset.side]?.[+b.dataset.i];
      entry?.act?.();
    });
  }
  canvas.style.width = `${w}px`;
  canvas.style.height = `${h}px`;
  screens.push({ id, d, canvas, ctx: canvas.getContext('2d'), w, h });
});

const updateICP = initICP($('icp'), api);
const ground = initGround({ dispatch, ui });

function fit() {
  const stage = $('stage');
  if (stage.hidden) return;
  const avW = stage.clientWidth;
  const avH = stage.clientHeight;
  const scale = Math.min(avW / DESIGN.w, avH / DESIGN.h);
  const cockpit = $('cockpit');
  cockpit.style.transform = `scale(${scale})`;
  cockpit.style.left = `${Math.max(0, (avW - DESIGN.w * scale) / 2)}px`;
  cockpit.style.top = `${Math.max(0, (avH - DESIGN.h * scale) / 2)}px`;
  const dpr = window.devicePixelRatio || 1;
  for (const sc of screens) {
    sc.canvas.width = Math.round(sc.w * scale * dpr);
    sc.canvas.height = Math.round(sc.h * scale * dpr);
  }
}
window.addEventListener('resize', fit);

function drawScreen(sc, t, stale) {
  const { ctx, w, h, d } = sc;
  const k = sc.canvas.width / w;
  ctx.setTransform(k, 0, 0, k, 0, 0);
  ctx.fillStyle = sc.id === 'ufdR' ? '#00070a' : C.bg;
  ctx.fillRect(0, 0, w, h);
  ctx.save();
  d.render(ctx, w, h, view, ui, t);
  ctx.restore();
  if (d.osb) {
    ctx.save();
    drawOSB(ctx, w, h, d.osb(view, ui, api));
    ctx.restore();
  }
  if (stale) {
    box(ctx, w / 2 - 44, h / 2 - 11, 88, 22, C.amber, 1, 'rgba(0,0,0,0.75)');
    txt(ctx, 'NO DATA', w / 2, h / 2, { size: 12, bold: true, align: 'center', color: C.amber });
  }
}

// ------------------------------------------------------------------ consoles e lâmpadas
const thr = $('throttle');
let thrDragging = false;
let thrLastSent = 0;
let thrHoldUntil = 0;
thr.addEventListener('pointerdown', () => { thrDragging = true; });
window.addEventListener('pointerup', () => { thrDragging = false; });
thr.addEventListener('input', () => {
  $('thrVal').textContent = thr.value;
  thrHoldUntil = performance.now() + 1500;
  const now = performance.now();
  if (ui.source === 'mock' || now - thrLastSent > 150) {
    sendCommand('throttle', +thr.value);
    thrLastSent = now;
  }
});
thr.addEventListener('change', () => sendCommand('throttle', +thr.value));

document.addEventListener('click', (e) => {
  const b = e.target.closest('[data-cmd]');
  if (b) {
    const raw = b.dataset.val;
    sendCommand(b.dataset.cmd, raw === undefined ? 'toggle' : raw);
  }
  const lamp = e.target.closest('[data-ack]');
  if (lamp) {
    if (lamp.dataset.ack === 'warning') ui.ack.warning = ui.alerts.warnKey;
    else ui.ack.caution = ui.alerts.cautKey;
  }
  const btn = e.target.closest('button');
  if (btn) btn.blur();
});

function setText(id, v) {
  const el = $(id);
  const s = String(v);
  if (el && el.textContent !== s) el.textContent = s;
}
function setOn(id, cls, on) {
  $(id)?.classList.toggle(cls, !!on);
}
function lamp(name, lit, blinking = false) {
  const el = document.querySelector(`[data-lamp="${name}"]`);
  if (!el) return;
  el.classList.toggle('lit', !!lit);
  el.classList.toggle('blink', !!lit && blinking);
}

function updatePanels(s) {
  const e = s.engine;
  const w = s.weapons;
  const sy = s.systems;
  const f = s.flight;

  const throttle = Math.round(e.throttle || 0);
  if (!thrDragging && performance.now() > thrHoldUntil && document.activeElement !== thr) {
    if (+thr.value !== throttle) thr.value = throttle;
    setText('thrVal', throttle);
  }
  setOn('thrAb', 'on', e.left?.afterburner || e.right?.afterburner);

  setOn('swArm', 'on', w.masterArm);
  setText('armTxt', w.masterArm ? 'ARM' : 'SAFE');
  setText('gearTxt', sy.gear || '---');
  ['gl1', 'gl2', 'gl3'].forEach((id) => {
    setOn(id, 'green', sy.gear === 'DOWN');
    setOn(id, 'red', sy.gear === 'TRANSIT');
  });
  setOn('swGear', 'down', sy.gear === 'DOWN' || sy.gear === 'TRANSIT');
  setText('flapsTxt', sy.flaps || '---');
  setOn('swFlaps', 'on', sy.flaps && sy.flaps !== 'UP');
  setText('sbTxt', sy.speedBrake ? 'OUT' : 'IN');
  setOn('swSb', 'on', sy.speedBrake);
  setText('apuTxt', sy.apu ? 'ON' : 'OFF');
  setOn('swApu', 'on', sy.apu);
  setText('flrCnt', w.flares ?? 0);
  setText('chfCnt', w.chaff ?? 0);
  setText('wpnTxt', w.selected || '---');

  const px = Math.max(-1, Math.min(1, (f.roll || 0) / 60));
  const py = Math.max(-1, Math.min(1, -(f.pitch || 0) / 15));
  $('stickKnob').style.transform = `translate(${px * 44}px, ${py * 44}px)`;
  setText('stkP', (f.pitch || 0).toFixed(1));
  setText('stkR', (f.roll || 0).toFixed(0));
  setText('stkG', (f.gload || 0).toFixed(1));

  setText('sbyIas', Math.round(f.airspeed || 0));
  setText('sbyAlt', thousands(f.altitude));
  setText('sbyHdg', pad(norm360(f.heading || 0), 3));
  setText('sbyMach', (f.mach || 0).toFixed(2));
  setText('sbyFuel', `${thousands(s.fuel.total)} kg`);

  const warns = s.warnings.filter((x) => x.level === 'warning');
  const cauts = s.warnings.filter((x) => x.level === 'caution');
  lamp('mwarn', warns.length, ui.ack.warning !== ui.alerts.warnKey);
  lamp('mcaut', cauts.length, ui.ack.caution !== ui.alerts.cautKey);
  lamp('lock', s.targeting.locked);
  lamp('shoot', s.targeting.shootCue, true);
  lamp('mlnch', s.threats?.missileLaunch, true);
  lamp('arm', w.masterArm);
  lamp('bay', Object.values(w.bays || {}).some(Boolean));
  lamp('fuel', s.fuel.total > 0 && s.fuel.total < s.fuel.bingo);
  lamp('abL', e.left?.afterburner);
  lamp('abR', e.right?.afterburner);
  lamp('gearDn', sy.gear === 'DOWN');
  lamp('gearTr', sy.gear === 'TRANSIT', true);
}

function updateTopbar() {
  const es = state.engineStatus;
  let label = 'MOTOR —';
  let cls = '';
  if (ui.source === 'mock') {
    label = es.paused ? 'MOTOR LOCAL · PAUSADO' : 'MOTOR LOCAL';
    cls = es.paused ? 'paused' : 'online';
  } else if (es.known) {
    const outdated = es.online && es.version !== PROTOCOL_VERSION;
    label = !es.online ? 'MOTOR OFFLINE' : outdated ? 'MOTOR DESATUALIZADO' : es.paused ? 'MOTOR PAUSADO' : 'MOTOR ONLINE';
    cls = !es.online ? 'offline' : outdated || es.paused ? 'paused' : 'online';
  }
  setText('engineStatus', label);
  const el = $('engineStatus');
  if (el.dataset.cls !== cls) {
    el.className = `pill ${cls}`;
    el.dataset.cls = cls;
  }
}

setInterval(() => {
  stats.rate = stats.window;
  stats.window = 0;
  setText('msgRate', stats.rate);
}, 1000);

// ------------------------------------------------------------------ som
const audio = {
  ctx: null,
  ensure() {
    if (!this.ctx) {
      try { this.ctx = new (window.AudioContext || window.webkitAudioContext)(); } catch { return; }
    }
    if (this.ctx.state === 'suspended') this.ctx.resume();
  },
  tone(freq, dur, delay = 0, vol = 0.035, type = 'square') {
    if (ui.muted || !this.ctx || this.ctx.state !== 'running') return;
    const t0 = this.ctx.currentTime + delay;
    const o = this.ctx.createOscillator();
    const g = this.ctx.createGain();
    o.type = type;
    o.frequency.value = freq;
    g.gain.setValueAtTime(vol, t0);
    g.gain.setValueAtTime(0, t0 + dur);
    o.connect(g).connect(this.ctx.destination);
    o.start(t0);
    o.stop(t0 + dur + 0.02);
  },
};
['pointerdown', 'keydown'].forEach((ev) => document.addEventListener(ev, () => audio.ensure(), { capture: true }));

const prev = { locked: false, shoot: false, warnKey: '', warble: 0 };
function sounds(t) {
  const s = state;
  if (s.targeting.locked && !prev.locked) { audio.tone(1300, 0.06); audio.tone(1300, 0.06, 0.1); }
  if (s.targeting.shootCue && !prev.shoot) audio.tone(1700, 0.25, 0, 0.03, 'sine');
  if (ui.alerts.warnKey && ui.alerts.warnKey !== prev.warnKey && ui.ack.warning !== ui.alerts.warnKey) {
    [0, 0.18, 0.36].forEach((d) => audio.tone(700, 0.12, d));
  }
  if (s.threats?.missileLaunch && ui.ack.warning !== ui.alerts.warnKey && t - prev.warble > 0.5) {
    audio.tone(900, 0.12, 0, 0.03);
    audio.tone(1350, 0.12, 0.14, 0.03);
    prev.warble = t;
  }
  prev.locked = s.targeting.locked;
  prev.shoot = s.targeting.shootCue;
  prev.warnKey = ui.alerts.warnKey;
}

// ------------------------------------------------------------------ alerta "CAÇA ATINGIDO"
const HIT_SHOW_MS = 6000;
const hitSeen = new Set(); // impactos já anunciados (id do míssil ou mensagem do alerta)
let hitTimer = null;

function hideHit() {
  clearTimeout(hitTimer);
  $('hitAlert').hidden = true;
  $('hitFlash').hidden = true;
}

function showHit(missileId) {
  $('hitSub').textContent = `${missileId ? `Míssil ${missileId} · ` : ''}falha hidráulica A`;
  $('hitAlert').hidden = false;
  // reinicia as animações (tremor de entrada e vinheta vermelha)
  for (const id of ['hitAlert', 'hitFlash']) {
    const el = $(id);
    el.hidden = false;
    el.style.animation = 'none';
    void el.offsetWidth;
    el.style.animation = '';
  }
  [0, 0.16, 0.32, 0.6, 0.76, 0.92].forEach((d, i) => audio.tone(i % 2 ? 330 : 440, 0.13, d, 0.05, 'sawtooth'));
  clearTimeout(hitTimer);
  hitTimer = setTimeout(hideHit, HIT_SHOW_MS);
}

/** Detecta um impacto novo: alerta AERONAVE_ATINGIDA do motor ou míssil inimigo com estado "acertou". */
function checkHit() {
  const enemyHits = state.missiles.filter((m) => m.side === 'enemy' && m.status === 'hit');
  const alert = state.engineAlerts.find((a) => a.code === 'AERONAVE_ATINGIDA');
  let fresh = null;
  for (const m of enemyHits) {
    if (!hitSeen.has(m.id)) {
      hitSeen.add(m.id);
      fresh = fresh || { id: m.id };
    }
  }
  if (alert) {
    const id = alert.msg.match(/\b(E\d+)\b/)?.[1] || null;
    const key = id || alert.msg;
    if (!hitSeen.has(key)) {
      hitSeen.add(key);
      fresh = fresh || { id };
    }
  }
  if (fresh) showHit(fresh.id);
}

$('hitAlert').addEventListener('click', hideHit);
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && !$('hitAlert').hidden) hideHit();
});

function toggleMute() {
  ui.muted = !ui.muted;
  $('btnMute').textContent = ui.muted ? 'SOM OFF' : 'SOM ON';
  $('btnMute').classList.toggle('off', ui.muted);
}
$('btnMute').addEventListener('click', toggleMute);

// ------------------------------------------------------------------ teclado
const KEYS = {
  l: ['targetLock', 'toggle'],
  n: ['targetLock', 'next'],
  u: ['targetLock', 'off'],
  w: ['weaponSelect', 'next'],
  ' ': ['pickle', 'toggle'],
  a: ['masterArm', 'toggle'],
  g: ['gear', 'toggle'],
  f: ['countermeasure', 'flare'],
  c: ['countermeasure', 'chaff'],
  r: ['radarMode', 'next'],
  ']': ['radarRange', 'up'],
  '[': ['radarRange', 'down'],
  b: ['speedBrake', 'toggle'],
  k: ['flaps', 'next'],
};
document.addEventListener('keydown', (e) => {
  if (e.target.matches('input, textarea, select') || e.ctrlKey || e.metaKey || e.altKey) return;
  if (ui.tab !== 'cockpit') return;
  const key = e.key.length === 1 ? e.key.toLowerCase() : e.key;
  if (key === 'PageUp' || key === 'PageDown') {
    const v = Math.max(0, Math.min(100, (+thr.value || 0) + (key === 'PageUp' ? 5 : -5)));
    thr.value = v;
    setText('thrVal', v);
    thrHoldUntil = performance.now() + 1500;
    sendCommand('throttle', v);
    e.preventDefault();
    return;
  }
  if (key === 'm') return toggleMute();
  if (key === 'Escape') {
    ui.ack.warning = ui.alerts.warnKey;
    ui.ack.caution = ui.alerts.cautKey;
    return;
  }
  const m = KEYS[key];
  if (m) {
    e.preventDefault();
    sendCommand(m[0], m[1]);
  }
});

// ------------------------------------------------------------------ loop
let lastFrame = performance.now();
function frame(now) {
  const t = now / 1000;
  const dt = (now - lastFrame) / 1000;
  lastFrame = now;

  const stale = !stats.lastMessage || now - stats.lastMessage > STALE_MS;
  state.warnings = mergeAlerts(state.engineAlerts, limitAlerts(state, { mqtt: ui.source === 'mqtt', stale: ui.source === 'mqtt' && link.connected && stale }));
  ui.alerts.warnKey = state.warnings.filter((x) => x.level === 'warning').map((x) => x.code).sort().join('|');
  ui.alerts.cautKey = state.warnings.filter((x) => x.level === 'caution').map((x) => x.code).sort().join('|');

  updateView(view, state, dt, snapView || state.engineStatus.paused);
  snapView = false;

  if (ui.tab === 'cockpit') {
    for (const sc of screens) drawScreen(sc, t, stale);
    updatePanels(view);
    updateICP(view);
  }
  ground.frame(now);
  updateTopbar();
  checkHit();
  sounds(t);
  requestAnimationFrame(frame);
}

// #solo / #cockpit na URL escolhe a aba (útil para abrir cada visão em um monitor)
const tabFromHash = () => ({ '#solo': 'ground', '#cockpit': 'cockpit' }[location.hash]);
window.addEventListener('hashchange', () => tabFromHash() && setTab(tabFromHash()));
setTab(tabFromHash() || (storage.get('raptorlink.tab', 'cockpit') === 'ground' ? 'ground' : 'cockpit'));
fit();
// ?broker=ws://host:9001[&raiz=f22] conecta direto ao broker; sem isso, inicia no modo MOCK
const params = new URLSearchParams(location.search);
if (params.get('broker')) {
  $('brokerUrl').value = params.get('broker');
  if (params.get('raiz')) $('topicRoot').value = params.get('raiz');
  ui.source = 'mock-pending';
  window.addEventListener('load', () => $('btnConnect').click());
} else {
  mock.start();
  setStatus('mock');
}
requestAnimationFrame(frame);
// redesenha com a fonte correta assim que carregar (canvas usa fallback até lá)
document.fonts?.ready.then(fit);
// ao voltar para a aba do cockpit, recalcula a escala
new MutationObserver(fit).observe($('stage'), { attributes: true, attributeFilter: ['hidden'] });
