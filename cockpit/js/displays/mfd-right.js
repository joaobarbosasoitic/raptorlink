// MFD direito: páginas NAV (HSI), ADI (atitude reserva), RWR (alerta radar) e MSL (rastreamento de mísseis).
import { C, D2R, clamp, norm360, txt, line, circle, blink, thousands, pad, ownship, hbar } from './common.js';

const ROSE = ['N', '3', '6', 'E', '12', '15', 'S', '21', '24', 'W', '30', '33'];

function page(ui, api, name) {
  return {
    t: name,
    on: ui.pages.mfdR === name,
    act: () => {
      ui.pages.mfdR = name;
      api.cmd('mfdPage', { mfd: 'right', page: name });
    },
  };
}

function fmtLat(v, pos, neg) {
  if (!Number.isFinite(v)) return '---';
  const a = Math.abs(v);
  const d = Math.floor(a);
  const m = (a - d) * 60;
  return `${v >= 0 ? pos : neg}${d}°${m.toFixed(1).padStart(4, '0')}'`;
}

function nav(ctx, w, h, s) {
  const n = s.nav || {};
  const hdg = s.flight.heading || 0;
  const cx = w / 2;
  const cy = 152;
  const R = 80;

  txt(ctx, n.waypoint || '---', cx, 30, { size: 11, bold: true, align: 'center', color: C.cyan });
  txt(ctx, fmtLat(n.lat, 'N', 'S'), w - 10, 48, { size: 9, align: 'right', color: C.greenDim });
  txt(ctx, fmtLat(n.lon, 'E', 'W'), w - 10, 60, { size: 9, align: 'right', color: C.greenDim });

  for (let a = 0; a < 360; a += 5) {
    const ang = (a - hdg) * D2R;
    const l = a % 30 === 0 ? 9 : a % 10 === 0 ? 6 : 3;
    line(ctx, cx + Math.sin(ang) * (R - l), cy - Math.cos(ang) * (R - l), cx + Math.sin(ang) * R, cy - Math.cos(ang) * R, C.green, 1);
    if (a % 30 === 0) {
      txt(ctx, ROSE[a / 30], cx + Math.sin(ang) * (R - 18), cy - Math.cos(ang) * (R - 18), { size: 10, align: 'center', bold: a % 90 === 0 });
    }
  }
  // lubber line e proa digital
  ctx.fillStyle = C.white;
  ctx.beginPath();
  ctx.moveTo(cx, cy - R + 1);
  ctx.lineTo(cx - 5, cy - R - 8);
  ctx.lineTo(cx + 5, cy - R - 8);
  ctx.closePath();
  ctx.fill();
  txt(ctx, pad(norm360(hdg), 3), cx, cy - R - 16, { size: 11, bold: true, align: 'center', color: C.white });

  // ponteiro de rumo ao waypoint
  const ba = ((n.wptBearing || 0) - hdg) * D2R;
  const sx = Math.sin(ba);
  const sy = -Math.cos(ba);
  line(ctx, cx - sx * (R - 12), cy - sy * (R - 12), cx + sx * (R - 12), cy + sy * (R - 12), C.cyan, 2);
  ctx.fillStyle = C.cyan;
  ctx.beginPath();
  ctx.moveTo(cx + sx * (R - 4), cy + sy * (R - 4));
  ctx.lineTo(cx + sx * (R - 16) + sy * 6, cy + sy * (R - 16) - sx * 6);
  ctx.lineTo(cx + sx * (R - 16) - sy * 6, cy + sy * (R - 16) + sx * 6);
  ctx.closePath();
  ctx.fill();

  ownship(ctx, cx, cy, C.white, 1.3);

  const ete = n.ete || 0;
  txt(ctx, `DIST ${(n.wptDistance || 0).toFixed(1)} NM`, 12, 248, { size: 10 });
  txt(ctx, `ETE  ${pad(Math.floor(ete / 60), 2)}:${pad(ete % 60, 2)}`, 12, 262, { size: 10 });
  txt(ctx, `BRG ${pad(norm360(n.wptBearing || 0), 3)}`, w - 12, 248, { size: 10, align: 'right', color: C.cyan });
  txt(ctx, `GS ${Math.round(n.groundSpeed || 0)}`, w - 12, 262, { size: 10, align: 'right' });
}

function adi(ctx, w, h, s) {
  const f = s.flight;
  const cx = w / 2;
  const cy = 142;
  const R = 90;
  const ppd = 3.2;
  const roll = (f.roll || 0) * D2R;
  const hy = (f.pitch || 0) * ppd;

  ctx.save();
  ctx.beginPath();
  ctx.arc(cx, cy, R, 0, Math.PI * 2);
  ctx.clip();
  ctx.translate(cx, cy);
  ctx.rotate(-roll);
  ctx.fillStyle = '#0c3a66';
  ctx.fillRect(-R * 2, hy - R * 4, R * 4, R * 4);
  ctx.fillStyle = '#4b2f13';
  ctx.fillRect(-R * 2, hy, R * 4, R * 4);
  line(ctx, -R * 2, hy, R * 2, hy, C.white, 1.5);
  for (let p = -80; p <= 80; p += 5) {
    if (!p) continue;
    const y = hy - p * ppd;
    const half = p % 10 === 0 ? 22 : 10;
    line(ctx, -half, y, half, y, C.white, 1);
    if (p % 10 === 0) {
      txt(ctx, Math.abs(p), -half - 4, y, { size: 8, align: 'right', color: C.white });
      txt(ctx, Math.abs(p), half + 4, y, { size: 8, color: C.white });
    }
  }
  ctx.restore();
  circle(ctx, cx, cy, R, C.green, 1.5);

  // escala de rolamento
  for (const a of [-60, -45, -30, -20, -10, 0, 10, 20, 30, 45, 60]) {
    const ang = (a - 90) * D2R;
    const l = a % 30 === 0 ? 9 : 5;
    line(ctx, cx + Math.cos(ang) * R, cy + Math.sin(ang) * R, cx + Math.cos(ang) * (R + l), cy + Math.sin(ang) * (R + l), C.white, 1.3);
  }
  ctx.save();
  ctx.translate(cx, cy);
  ctx.rotate(-roll);
  ctx.fillStyle = C.yellow;
  ctx.beginPath();
  ctx.moveTo(0, -R + 1);
  ctx.lineTo(-5, -R + 10);
  ctx.lineTo(5, -R + 10);
  ctx.closePath();
  ctx.fill();
  ctx.restore();

  // símbolo da aeronave
  ctx.strokeStyle = C.yellow;
  ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.moveTo(cx - 46, cy);
  ctx.lineTo(cx - 18, cy);
  ctx.lineTo(cx - 10, cy + 8);
  ctx.moveTo(cx + 46, cy);
  ctx.lineTo(cx + 18, cy);
  ctx.lineTo(cx + 10, cy + 8);
  ctx.stroke();
  circle(ctx, cx, cy, 2.5, null, 1, C.yellow);

  txt(ctx, `IAS ${Math.round(f.airspeed || 0)}`, 12, 252, { size: 11, bold: true });
  txt(ctx, `ALT ${thousands(f.altitude)}`, w - 12, 252, { size: 11, bold: true, align: 'right' });
  txt(ctx, `P ${(f.pitch || 0).toFixed(1)}  R ${(f.roll || 0).toFixed(0)}`, cx, 266, { size: 9, align: 'center', color: C.greenDim });
}

function rwr(ctx, w, h, s, t) {
  const hdg = s.flight.heading || 0;
  const cx = w / 2;
  const cy = 145;
  const R = 100;
  txt(ctx, 'RWR', cx, 30, { size: 11, bold: true, align: 'center', color: C.cyan });
  circle(ctx, cx, cy, R, C.greenDim, 1);
  circle(ctx, cx, cy, R / 2, C.greenFaint, 1);
  circle(ctx, cx, cy, R / 4, C.greenFaint, 1);
  for (let a = 0; a < 360; a += 30) {
    const ang = a * D2R;
    line(ctx, cx + Math.sin(ang) * (R - 6), cy - Math.cos(ang) * (R - 6), cx + Math.sin(ang) * R, cy - Math.cos(ang) * R, C.green, 1);
  }

  const threats = (s.radar.contacts || []).filter((c) => c.type === 'hostile' && c.range < 80);
  for (const c of threats) {
    const a = (c.bearing - hdg) * D2R;
    const r = R * clamp(0.28 + (c.range / 80) * 0.72, 0.28, 0.95);
    const x = cx + Math.sin(a) * r;
    const y = cy - Math.cos(a) * r;
    const col = c.range < 25 ? C.red : C.yellow;
    txt(ctx, c.code || 'U', x, y, { size: 12, bold: true, align: 'center', color: col });
    if (c.range < 25) {
      ctx.strokeStyle = col;
      ctx.lineWidth = 1.3;
      ctx.beginPath();
      ctx.arc(x, y + 2, 11, Math.PI, 0);
      ctx.stroke();
    }
  }

  // um "M" por míssil inimigo em voo, na marcação real; quanto mais perto, mais ao centro
  const incoming = (s.missiles || []).filter((m) => m.side === 'enemy' && m.status === 'flight');
  for (const m of incoming) {
    const a = ((m.bearing || 0) - hdg) * D2R;
    const r = R * clamp(0.15 + (m.range / 40) * 0.8, 0.15, 0.95);
    const x = cx + Math.sin(a) * r;
    const y = cy - Math.cos(a) * r;
    if (blink(t, 4)) {
      txt(ctx, 'M', x, y, { size: 14, bold: true, align: 'center', color: C.red });
      circle(ctx, x, y, 10, C.red, 1.5);
    }
    txt(ctx, `${m.range.toFixed(1)}`, x, y + 18, { size: 9, align: 'center', color: C.red });
  }
  if (incoming.length) {
    const near = incoming.reduce((a, b) => (b.range < a.range ? b : a));
    txt(ctx, `LAUNCH · ${near.range.toFixed(1)}NM · ${Math.round(near.tof)}s`, cx, 262, { size: 11, bold: true, align: 'center', color: C.red });
  } else {
    txt(ctx, `THREATS ${threats.length}`, cx, 262, { size: 10, align: 'center', color: threats.length ? C.yellow : C.greenDim });
  }
  ownship(ctx, cx, cy, C.green, 0.9);
}

const STATUS_TXT = { flight: 'EM VOO', hit: 'ACERTOU', miss: 'ERROU', decoyed: 'DESPISTADO' };

/** Página MSL: acompanhamento de cada míssil (próprio ou inimigo) até o desfecho. */
function msl(ctx, w, h, s, t) {
  txt(ctx, 'MISSILE TRACK', w / 2, 30, { size: 11, bold: true, align: 'center', color: C.cyan });
  const list = [...(s.missiles || [])].sort((a, b) => (a.side === b.side ? 0 : a.side === 'enemy' ? -1 : 1));
  if (!list.length) {
    txt(ctx, 'NENHUM MÍSSIL NO AR', w / 2, h / 2, { size: 11, align: 'center', color: C.greenDim });
    return;
  }
  list.slice(0, 5).forEach((m, i) => {
    const y = 50 + i * 44;
    const enemy = m.side === 'enemy';
    const flying = m.status === 'flight';
    const col = !flying ? C.greenDim : enemy ? C.red : C.white;
    const done = m.status === 'hit' ? (enemy ? C.red : C.green) : C.amber;
    txt(ctx, `${m.id} ${enemy ? 'THR' : 'OWN'} ${m.type}`, 14, y, { size: 11, bold: true, color: col });
    txt(ctx, STATUS_TXT[m.status] || '', w - 14, y, {
      size: 10, bold: true, align: 'right', color: flying ? col : done,
    });
    const total = (m.flightTime || 0) + (m.tof || 0);
    const frac = flying ? (total > 0 ? m.flightTime / total : 0) : 1;
    hbar(ctx, 14, y + 8, 160, 8, frac, flying ? (enemy ? C.red : C.cyan) : done);
    txt(ctx, flying ? `TOF ${Math.round(m.tof)}s` : `${Math.round(m.flightTime)}s`, w - 14, y + 12, { size: 10, align: 'right', color: col });
    const alvo = enemy ? 'F-22' : m.target;
    txt(ctx, `${alvo} ${flying ? `${m.targetRange.toFixed(1)}NM` : ''} · ${Math.round(m.speed)}KT · ${Math.round(m.alt / 1000)}K`, 14, y + 26, {
      size: 9, color: C.greenDim,
    });
    if (enemy && flying && blink(t, 2)) circle(ctx, 8, y, 2.5, null, 1, C.red);
  });
  if (list.length > 5) txt(ctx, `+${list.length - 5}`, w - 14, h - 24, { size: 9, align: 'right', color: C.white });
}

export const mfdRight = {
  osb(s, ui, api) {
    const o = { top: [page(ui, api, 'NAV'), page(ui, api, 'ADI'), page(ui, api, 'RWR'), page(ui, api, 'MSL'), {}] };
    if (ui.pages.mfdR === 'NAV') {
      o.left = [
        { t: 'WP▲', act: () => api.cmd('waypoint', 'next') },
        { t: 'WP▼', act: () => api.cmd('waypoint', 'prev') },
      ];
    }
    return o;
  },
  render(ctx, w, h, s, ui, t) {
    const p = ui.pages.mfdR;
    if (p === 'ADI') adi(ctx, w, h, s);
    else if (p === 'RWR') rwr(ctx, w, h, s, t);
    else if (p === 'MSL') msl(ctx, w, h, s, t);
    else nav(ctx, w, h, s);
  },
};
