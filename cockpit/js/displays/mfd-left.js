// MFD esquerdo: páginas ENG (motores), FUEL (combustível), SYS (sistemas) e AMB (ambiente).
import { C, D2R, txt, line, circle, arcGauge, hbar, thousands, pad, blink, ownship } from './common.js';
import { LIMITS } from '../alerts.js';

// capacidades ilustrativas dos tanques (kg), somando 8 200 kg
const TANKS = [
  ['FEED', 1230],
  ['FWD', 1640],
  ['WING L', 1640],
  ['WING R', 1640],
  ['AFT', 2050],
];

function page(ui, api, name) {
  return {
    t: name,
    on: ui.pages.mfdL === name,
    act: () => {
      ui.pages.mfdL = name;
    },
  };
}

function eng(ctx, w, h, s) {
  const e = s.engine;
  txt(ctx, 'ENGINE', w / 2, 30, { size: 11, bold: true, align: 'center', color: C.cyan });
  ['left', 'right'].forEach((side, i) => {
    const x = i ? 196 : 84;
    const en = e[side] || {};
    txt(ctx, side === 'left' ? 'L' : 'R', x, 44, { size: 12, bold: true, align: 'center', color: C.cyan });
    arcGauge(ctx, x, 86, 30, en.rpm, 0, 110, { label: 'RPM %', warn: 102, danger: 106 });
    arcGauge(ctx, x, 160, 30, en.egt, 0, 1200, {
      label: 'TEMP °C', warn: LIMITS.engineTempCaution, danger: LIMITS.engineTempWarning,
    });
    const thr = (en.thrust || 0) / 100;
    hbar(ctx, x - 40, 206, 80, 9, thr, en.afterburner ? C.amber : C.green);
    line(ctx, x - 40 + 80 * 0.85, 203, x - 40 + 80 * 0.85, 218, C.white, 1);
    txt(ctx, `FF ${Math.round(en.fuelFlow || 0)} KG/M`, x, 228, { size: 10, align: 'center' });
    if (en.afterburner) txt(ctx, 'AB', x, 246, { size: 12, bold: true, align: 'center', color: C.amber });
  });
  txt(ctx, `THR ${Math.round(e.throttle || 0)}%`, w / 2, 246, { size: 10, align: 'center', color: C.white });
}

function fuel(ctx, w, h, s) {
  const f = s.fuel;
  const total = f.total || 0;
  txt(ctx, 'FUEL', w / 2, 30, { size: 11, bold: true, align: 'center', color: C.cyan });
  const low = total < (f.bingo || 0);
  txt(ctx, thousands(total), w / 2, 56, { size: 24, bold: true, align: 'center', color: low ? C.amber : C.green });
  txt(ctx, 'KG TOTAL', w / 2, 74, { size: 9, align: 'center', color: C.greenDim });

  // distribuição ilustrativa: tanque de alimentação (FEED) esvazia por último
  let rest = total;
  const feed = Math.min(TANKS[0][1], rest);
  rest -= feed;
  const othersCap = TANKS.slice(1).reduce((a, [, c]) => a + c, 0);
  TANKS.forEach(([name, cap], i) => {
    const q = i === 0 ? feed : (cap / othersCap) * Math.max(0, rest);
    const y = 94 + i * 22;
    txt(ctx, name, 26, y, { size: 10 });
    hbar(ctx, 90, y - 5, 120, 10, q / cap, q / cap < 0.2 ? C.amber : C.green);
    txt(ctx, thousands(q), 256, y, { size: 10, align: 'right' });
  });

  txt(ctx, `BINGO ${thousands(f.bingo)} KG`, 26, 210, { size: 10, color: low ? C.amber : C.green });
  txt(ctx, `${(f.consumption || 0).toFixed(1)} KG/MIN`, 26, 228, { size: 10 });
  const mins = f.endurance || 0;
  txt(ctx, `AUTONOMIA ${pad(Math.floor(mins), 2)}:${pad(Math.floor((mins % 1) * 60), 2)}`, 26, 246, { size: 10, color: low ? C.amber : C.white });
}

function sys(ctx, w, h, s) {
  const y0 = s.systems || {};
  txt(ctx, 'SYSTEMS', w / 2, 30, { size: 11, bold: true, align: 'center', color: C.cyan });
  const rows = [
    ['HYD A', `${Math.round(y0.hydA || 0)} PSI`, (y0.hydA || 0) < 2500 ? C.red : C.green],
    ['HYD B', `${Math.round(y0.hydB || 0)} PSI`, (y0.hydB || 0) < 2500 ? C.red : C.green],
    ['ELEC', `${Math.round(y0.elecVolts || 0)} V`, (y0.elecVolts || 0) < 250 ? C.amber : C.green],
    ['APU', y0.apu ? 'ON' : 'OFF', y0.apu ? C.amber : C.greenDim],
    ['OXY', `${Math.round(y0.oxygen || 0)} %`, (y0.oxygen || 0) < 50 ? C.amber : C.green],
    ['GEAR', y0.gear || '---', y0.gear === 'DOWN' ? C.green : y0.gear === 'TRANSIT' ? C.red : C.white],
    ['FLAPS', y0.flaps || '---', y0.flaps === 'UP' ? C.white : C.amber],
    ['SPD BRK', y0.speedBrake ? 'OUT' : 'IN', y0.speedBrake ? C.amber : C.white],
  ];
  rows.forEach(([k, v, col], i) => {
    const y = 54 + i * 25;
    txt(ctx, k, 30, y, { size: 11 });
    line(ctx, 100, y, 170, y, C.greenFaint, 1);
    txt(ctx, v, 250, y, { size: 11, bold: true, align: 'right', color: col });
  });
}

function amb(ctx, w, h, s, t) {
  const e = s.env || {};
  const hdg = s.flight.heading || 0;
  txt(ctx, 'AMBIENTE', w / 2, 30, { size: 11, bold: true, align: 'center', color: C.cyan });

  // rosa com a seta do vento relativa ao nariz (seta aponta para onde o vento sopra)
  const cx = 82;
  const cy = 112;
  const R = 50;
  circle(ctx, cx, cy, R, C.greenDim, 1);
  for (let a = 0; a < 360; a += 30) {
    const ang = (a - hdg) * D2R;
    line(ctx, cx + Math.sin(ang) * (R - 5), cy - Math.cos(ang) * (R - 5), cx + Math.sin(ang) * R, cy - Math.cos(ang) * R, C.green, 1);
  }
  const n = (0 - hdg) * D2R;
  txt(ctx, 'N', cx + Math.sin(n) * (R + 9), cy - Math.cos(n) * (R + 9), { size: 9, align: 'center', color: C.cyan, bold: true });
  ownship(ctx, cx, cy, C.white, 0.8);
  const to = ((e.windDir || 0) + 180 - hdg) * D2R;
  const sx = Math.sin(to);
  const sy = -Math.cos(to);
  const col = e.gust ? C.amber : C.cyan;
  line(ctx, cx - sx * (R - 8), cy - sy * (R - 8), cx + sx * (R - 12), cy + sy * (R - 12), col, 2.5);
  ctx.fillStyle = col;
  ctx.beginPath();
  ctx.moveTo(cx + sx * (R - 4), cy + sy * (R - 4));
  ctx.lineTo(cx + sx * (R - 16) + sy * 6, cy + sy * (R - 16) - sx * 6);
  ctx.lineTo(cx + sx * (R - 16) - sy * 6, cy + sy * (R - 16) + sx * 6);
  ctx.closePath();
  ctx.fill();

  const xr = 262;
  txt(ctx, 'VENTO', 160, 70, { size: 10, color: C.greenDim });
  txt(ctx, `${pad(e.windDir || 0, 3)}°`, xr, 70, { size: 13, bold: true, align: 'right', color: col });
  txt(ctx, `${Math.round(e.windSpeed || 0)} KT`, xr, 88, { size: 13, bold: true, align: 'right', color: col });
  txt(ctx, 'OAT', 160, 116, { size: 10, color: C.greenDim });
  txt(ctx, `${(e.oat || 0).toFixed(1)}°C`, xr, 116, { size: 13, bold: true, align: 'right' });
  txt(ctx, 'GS', 160, 142, { size: 10, color: C.greenDim });
  txt(ctx, `${Math.round(s.nav.groundSpeed || 0)} KT`, xr, 142, { size: 11, align: 'right' });
  txt(ctx, 'TRK', 160, 160, { size: 10, color: C.greenDim });
  txt(ctx, `${pad(s.nav.track || 0, 3)}°`, xr, 160, { size: 11, align: 'right' });

  const tb = e.turbulence || 0;
  const tcol = tb > 0.6 ? C.red : tb > 0.3 ? C.amber : C.green;
  txt(ctx, 'TURBULÊNCIA', 26, 192, { size: 10, color: C.greenDim });
  hbar(ctx, 26, 202, 228, 12, tb, tcol);
  txt(ctx, tb > 0.6 ? 'SEVERA' : tb > 0.3 ? 'MODERADA' : 'LEVE', 26, 228, { size: 11, bold: true, color: tcol });
  if (e.gust && blink(t, 2)) txt(ctx, 'RAJADA', 254, 228, { size: 11, bold: true, align: 'right', color: C.amber });
}

export const mfdLeft = {
  osb(s, ui, api) {
    return { top: [page(ui, api, 'ENG'), page(ui, api, 'FUEL'), page(ui, api, 'SYS'), page(ui, api, 'AMB'), {}] };
  },
  render(ctx, w, h, s, ui, t) {
    const p = ui.pages.mfdL;
    if (p === 'FUEL') fuel(ctx, w, h, s);
    else if (p === 'SYS') sys(ctx, w, h, s);
    else if (p === 'AMB') amb(ctx, w, h, s, t);
    else eng(ctx, w, h, s);
  },
};
