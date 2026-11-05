// Estação de solo: mapa, gráficos, sensores por tópico, alertas, comandos e log MQTT.
import { state, stats, topicMeta, messageLog, onMessage, config } from '../state.js';
import { TOPICS, PROTOCOL_VERSION, makeCommand } from '../protocol.js';
import { createMap } from './map.js';
import { createCharts } from './charts.js';

const $ = (id) => document.getElementById(id);
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const hhmmss = (ms) => new Date(ms).toLocaleTimeString('pt-BR', { hour12: false });
const LEVEL_PT = { warning: 'AVISO', caution: 'CUIDADO', advisory: 'INFO' };
const SENSOR_TOPICS = Object.keys(TOPICS).filter((t) => t !== 'comandos');

function fmtValue(v) {
  if (typeof v === 'boolean') return v ? 'sim' : 'não';
  if (typeof v === 'number') return Number.isInteger(v) ? v.toLocaleString('pt-BR') : v.toLocaleString('pt-BR', { maximumFractionDigits: 2 });
  if (v === null || v === undefined) return '—';
  return String(v);
}

/** Achata os dados de um tópico em linhas [campo, valor, unidade]. */
function flatten(plain, units, prefix = '', out = []) {
  for (const [k, v] of Object.entries(plain || {})) {
    const path = prefix ? `${prefix}.${k}` : k;
    if (Array.isArray(v)) out.push([path, `${v.length} ${v.length === 1 ? 'item' : 'itens'}`, '']);
    else if (v && typeof v === 'object') flatten(v, units, path, out);
    else out.push([path, fmtValue(v), units?.[path] || '']);
  }
  return out;
}

export function initGround({ dispatch }) {
  let visible = false;
  const map = createMap($('gsMap'));
  const charts = createCharts();

  // ---------------------------------------------------------------- mensagens
  let logDirty = true;
  let cmdDirty = true;
  onMessage(({ sub, plain, meta }) => {
    logDirty = true;
    if (sub === 'comandos') {
      cmdDirty = true;
      return;
    }
    if (!plain) return;
    if (sub === 'misseis') {
      onMissiles();
      return;
    }
    charts.push(sub, plain, meta.time);
    if (sub === 'nav') map.updateNav(state.nav, state.flight);
    else if (sub === 'radar') map.updateTargets(state.radar.contacts, state.nav, state.targeting.locked ? state.targeting.targetId : null);
    else if (sub === 'ambiente') map.updateWind(state.env);
  });

  $('gsFollow').addEventListener('change', (e) => map.setFollow(e.target.checked));
  $('gsMap').addEventListener('follow-change', (e) => { $('gsFollow').checked = e.detail; });

  // ---------------------------------------------------------------- comandos
  const out = (id) => {
    const el = $(id);
    const o = el.parentElement.querySelector('output');
    const upd = () => { if (o) o.textContent = el.value; };
    el.addEventListener('input', upd);
    upd();
  };
  out('cmdGustKt');
  out('cmdGustDur');

  $('cmdGust').addEventListener('click', () => {
    dispatch(makeCommand('rajada', { intensidade: +$('cmdGustKt').value, duracao: +$('cmdGustDur').value }));
  });
  $('cmdTarget').addEventListener('click', () => {
    const valor = { tipo: $('cmdTgtType').value };
    if ($('cmdTgtBrg').value !== '') valor.marcacao = +$('cmdTgtBrg').value;
    if ($('cmdTgtDist').value !== '') valor.distancia = +$('cmdTgtDist').value;
    dispatch(makeCommand('novoAlvo', valor));
  });
  $('cmdManeuver').addEventListener('click', () => dispatch(makeCommand('manobra')));
  $('cmdThreat').addEventListener('click', () => dispatch(makeCommand('ameaca')));
  $('cmdPause').addEventListener('click', () => dispatch(makeCommand(state.engineStatus.paused ? 'retomar' : 'pausa')));
  $('cmdReset').addEventListener('click', () => {
    if (window.confirm('Reiniciar a simulação no motor?')) dispatch(makeCommand('reiniciar'));
  });

  function renderCommands() {
    const list = messageLog.filter((m) => m.sub === 'comandos').slice(0, 12);
    const ul = $('cmdLog');
    ul.innerHTML = list.length
      ? list.map((m) => {
        let c = {};
        try { c = JSON.parse(m.payload); } catch { /* ignora */ }
        const val = c.valor === undefined ? '' : JSON.stringify(c.valor);
        return `<li><time>${hhmmss(m.time)}</time><b>${esc(c.comando ?? '?')}</b><span>${esc(val)}</span><em>${esc(c.origem ?? '')}</em></li>`;
      }).join('')
      : '<li class="gs-empty">Nenhum comando enviado.</li>';
  }

  // ---------------------------------------------------------------- mísseis
  const MSL_STATUS = { flight: 'em voo', hit: 'acertou', miss: 'errou', decoyed: 'despistado' };
  const mslKnown = new Map(); // id → último status
  const mslHistory = [];
  let mslDirty = true;

  function onMissiles() {
    const list = state.missiles;
    map.updateMissiles(list, state.radar.contacts, state.nav);
    for (const m of list) {
      const prevStatus = mslKnown.get(m.id);
      if (prevStatus === undefined && m.status === 'flight' && $('mslAuto').checked && !map.followedMissile) {
        map.followMissile(m.id); // novo lançamento → câmera vai até ele
      }
      if (prevStatus === 'flight' && m.status !== 'flight') {
        mslHistory.unshift({ time: Date.now(), m: { ...m } });
        if (mslHistory.length > 10) mslHistory.length = 10;
      }
      mslKnown.set(m.id, m.status);
    }
    const ids = new Set(list.map((m) => m.id));
    for (const id of mslKnown.keys()) if (!ids.has(id)) mslKnown.delete(id);
    mslDirty = true;
  }

  // pointerdown (e não click): a tabela é redesenhada a 4 Hz e o clique poderia cair entre dois redesenhos
  $('mslBody').addEventListener('pointerdown', (e) => {
    const b = e.target.closest('button[data-msl]');
    if (!b) return;
    const id = b.dataset.msl;
    map.followMissile(map.followedMissile === id ? null : id);
  });
  $('gsMap').addEventListener('missile-follow', () => { mslDirty = true; });
  onMessage(({ sub }) => { if (sub === 'status') mslDirty = true; });

  function renderMissiles() {
    const list = [...state.missiles].sort((a, b) => (a.status === 'flight') === (b.status === 'flight') ? 0 : a.status === 'flight' ? -1 : 1);
    const followed = map.followedMissile;
    const flying = list.filter((m) => m.status === 'flight').length;
    $('mslCount').textContent = flying ? `${flying} em voo` : 'nenhum em voo';
    const es = state.engineStatus;
    const outdated = es.known && es.online && es.version !== PROTOCOL_VERSION;
    $('mslBody').innerHTML = outdated
      ? `<tr><td colspan="13" class="gs-empty warn">O motor conectado (${esc(es.id || '?')}) é de uma versão antiga e não publica f22/misseis. Reinicie o motor: <code>npm run engine</code>.</td></tr>`
      : list.length
      ? list.map((m) => {
        const enemy = m.side === 'enemy';
        const inFlight = m.status === 'flight';
        const total = m.flightTime + m.tof;
        const pct = inFlight ? Math.round((total > 0 ? m.flightTime / total : 0) * 100) : 100;
        const route = enemy ? `${esc(m.launcher)} → F-22` : `F-22 → ${esc(m.target)}`;
        return `<tr class="${enemy ? 'enemy' : 'own'} st-${m.status}${followed === m.id ? ' followed' : ''}">
          <td><i class="msl-dot"></i></td>
          <td><b>${esc(m.id)}</b></td>
          <td>${enemy ? 'inimigo' : 'próprio'}</td>
          <td>${esc(m.type)}</td>
          <td class="st">${MSL_STATUS[m.status]}</td>
          <td>${route}</td>
          <td>${inFlight ? `${m.targetRange.toFixed(1)} NM` : '—'}</td>
          <td>${inFlight ? `${m.tof.toFixed(1)} s` : '—'}</td>
          <td><div class="msl-bar"><i style="width:${pct}%"></i></div></td>
          <td>${Math.round(m.speed).toLocaleString('pt-BR')} kt</td>
          <td>${Math.round(m.alt).toLocaleString('pt-BR')} ft</td>
          <td>${m.flightTime.toFixed(1)} s</td>
          <td><button class="gs-btn small" data-msl="${esc(m.id)}">${followed === m.id ? 'Seguindo ✓' : 'Acompanhar'}</button></td>
        </tr>`;
      }).join('')
      : '<tr><td colspan="13" class="gs-empty">Nenhum míssil no ar. Dispare do cockpit (alvo travado + MASTER ARM + PICKLE) ou use “Lançar míssil inimigo”.</td></tr>';
    $('mslHist').innerHTML = mslHistory.length
      ? mslHistory.map(({ time, m }) => {
        const enemy = m.side === 'enemy';
        const good = enemy ? m.status !== 'hit' : m.status === 'hit';
        return `<li class="${good ? 'good' : 'bad'}"><time>${hhmmss(time)}</time><b>${esc(m.id)}</b>
          <span>${enemy ? `${esc(m.launcher)} → F-22` : `F-22 → ${esc(m.target)}`}</span>
          <em>${MSL_STATUS[m.status]} · ${m.flightTime.toFixed(1)} s</em></li>`;
      }).join('')
      : '<li class="gs-empty">Sem desfechos ainda.</li>';
  }

  // ---------------------------------------------------------------- alertas
  const history = [];
  let activeCodes = new Map();
  function trackAlerts(now) {
    const current = new Map(state.warnings.filter((a) => a.level !== 'advisory').map((a) => [a.code, a]));
    for (const [code, a] of current) if (!activeCodes.has(code)) history.unshift({ time: now, a, on: true });
    for (const [code, a] of activeCodes) if (!current.has(code)) history.unshift({ time: now, a, on: false });
    if (history.length > 60) history.length = 60;
    activeCodes = current;
  }

  let alertKey = '';
  function renderAlerts() {
    const key = state.warnings.map((a) => a.level + a.code + a.msg).join('|') + history.length;
    if (key === alertKey) return;
    alertKey = key;
    $('gsAlertCount').textContent = `${state.warnings.length} ativos`;
    $('gsAlertsActive').innerHTML = state.warnings.length
      ? state.warnings.map((a) => `<li class="lv-${a.level}"><span class="lv">${LEVEL_PT[a.level]}</span>${esc(a.msg)}<code>${esc(a.code)}</code></li>`).join('')
      : '<li class="gs-empty">Nenhum alerta.</li>';
    $('gsAlertsHist').innerHTML = history.length
      ? history.map((h) => `<li class="lv-${h.a.level}${h.on ? '' : ' off'}"><time>${hhmmss(h.time)}</time>${esc(h.a.msg)}<em>${h.on ? 'ativou' : 'normalizou'}</em></li>`).join('')
      : '<li class="gs-empty">Sem eventos.</li>';
  }

  // ---------------------------------------------------------------- sensores
  const cards = {};
  const grid = $('gsSensors');
  for (const sub of SENSOR_TOPICS) {
    const t = TOPICS[sub];
    const el = document.createElement('article');
    el.className = 'sensor';
    el.innerHTML = `<header><h3></h3><span class="badges"><i>QoS ${t.qos}</i>${t.retain ? '<i class="ret">RETIDO</i>' : ''}</span></header>
      <p class="sensor-meta">aguardando…</p><dl></dl>`;
    el.querySelector('h3').textContent = `${config.root}/${sub}`;
    el.title = t.desc;
    grid.appendChild(el);
    cards[sub] = { el, h3: el.querySelector('h3'), meta: el.querySelector('.sensor-meta'), dl: el.querySelector('dl'), seen: -1 };
  }

  function renderSensors() {
    const now = performance.now();
    for (const sub of SENSOR_TOPICS) {
      const c = cards[sub];
      const m = topicMeta[sub];
      const topic = `${config.root}/${sub}`;
      if (c.h3.textContent !== topic) c.h3.textContent = topic;
      if (!m) {
        c.meta.textContent = 'aguardando…';
        c.el.classList.add('idle');
        if (c.seen !== -1) { c.dl.innerHTML = ''; c.seen = -1; }
        continue;
      }
      c.el.classList.remove('idle');
      const age = (now - m.last) / 1000;
      c.el.classList.toggle('stale', age > 3.5 && sub !== 'status' && sub !== 'alertas');
      c.meta.textContent = `#${m.count} · seq ${m.seq ?? '—'} · há ${age.toFixed(1)} s${m.retain ? ' · recebida como retida' : ''}`;
      if (c.seen === m.count) continue;
      c.seen = m.count;
      const rows = sub === 'alertas'
        ? (m.plain.lista || []).map((a) => [a.nivel, a.mensagem, ''])
        : flatten(m.plain, m.units);
      c.dl.innerHTML = rows.length
        ? rows.map(([k, v, u]) => `<dt>${esc(k)}</dt><dd>${esc(v)}${u ? ` <small>${esc(u)}</small>` : ''}</dd>`).join('')
        : '<dt>—</dt><dd>sem alertas</dd>';
    }
  }

  // ---------------------------------------------------------------- link
  function renderLink() {
    const es = state.engineStatus;
    const set = (id, v) => { const el = $(id); if (el.textContent !== String(v)) el.textContent = v; };
    set('lkSource', document.querySelector('#srcSeg .on')?.textContent || '—');
    set('lkRoot', `${config.root}/#`);
    set('lkEngine', es.known ? `${es.id || '—'} · ${!es.online ? 'offline' : es.paused ? 'pausado' : 'online'}` : '—');
    set('lkInterval', es.intervalMs ? `${es.intervalMs} ms` : '—');
    set('lkRate', `${stats.rate} msg/s`);
    set('lkTotal', stats.total.toLocaleString('pt-BR'));
    $('cmdPause').textContent = es.paused ? '▶ Retomar' : '❚❚ Pausar';
    const n = state.nav;
    set('gsMapInfo', n.lat || n.lon
      ? `${n.lat.toFixed(4)}°, ${n.lon.toFixed(4)}° · ${Math.round(state.flight.altitude).toLocaleString('pt-BR')} ft · GS ${Math.round(n.groundSpeed)} kt · ${n.waypoint} (${n.wptDistance.toFixed(1)} NM)`
      : 'aguardando f22/nav…');
  }

  // ---------------------------------------------------------------- log MQTT
  const filter = $('logFilter');
  for (const sub of Object.keys(TOPICS)) filter.insertAdjacentHTML('beforeend', `<option value="${sub}">${sub}</option>`);
  filter.addEventListener('change', () => { logDirty = true; });
  function renderLog() {
    if ($('logPause').checked) return;
    const f = filter.value;
    const rows = messageLog.filter((m) => !f || m.sub === f).slice(0, 60);
    $('logBody').innerHTML = rows.map((m) => `<tr class="${m.sub === 'comandos' ? 'cmd' : ''}">
      <td>${hhmmss(m.time)}</td><td>${esc(m.topic)}</td><td>${m.qos}</td><td>${m.retain ? 'sim' : ''}</td><td>${m.bytes}</td>
      <td class="payload">${esc(m.payload.length > 220 ? `${m.payload.slice(0, 220)}…` : m.payload)}</td></tr>`).join('');
  }

  // ---------------------------------------------------------------- laço
  let lastSlow = 0;
  let lastLog = 0;
  return {
    frame(now) {
      if (now - lastSlow > 500) trackAlerts(Date.now()); // histórico é registrado mesmo com a aba oculta
      if (!visible) {
        if (now - lastSlow > 500) lastSlow = now;
        return;
      }
      charts.flush();
      if (mslDirty) {
        mslDirty = false;
        renderMissiles();
      }
      if (now - lastSlow > 500) {
        lastSlow = now;
        renderAlerts();
        renderSensors();
        renderLink();
        if (cmdDirty) { cmdDirty = false; renderCommands(); }
      }
      if (logDirty && now - lastLog > 300) {
        lastLog = now;
        logDirty = false;
        renderLog();
      }
    },
    setVisible(v) {
      visible = v;
      if (v) {
        requestAnimationFrame(() => map.invalidate());
        logDirty = true;
        cmdDirty = true;
        mslDirty = true;
        alertKey = '';
      }
    },
    reset() {
      map.reset();
      charts.reset();
      history.length = 0;
      mslHistory.length = 0;
      mslKnown.clear();
      mslDirty = true;
      activeCodes = new Map();
      for (const c of Object.values(cards)) c.seen = -2;
      logDirty = true;
      cmdDirty = true;
    },
  };
}
