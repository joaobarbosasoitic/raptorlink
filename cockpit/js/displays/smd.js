// SMD (MFD inferior): gerenciamento de armamento — baias, estações, master arm, canhão, contramedidas.
import { C, txt, line, box, blink } from './common.js';

const OUTLINE = [
  [0, -74], [-9, -50], [-20, -30], [-22, -6], [-70, 30], [-70, 40], [-30, 40], [-38, 62], [-36, 71],
  [-14, 67], [-8, 60], [8, 60], [14, 67], [36, 71], [38, 62], [30, 40], [70, 40], [70, 30], [22, -6],
  [20, -30], [9, -50],
];

// posição de cada estação (relativa ao centro do desenho)
const STATIONS = {
  SL: { x: -40, y: -16, bay: 'sideLeft' },
  SR: { x: 40, y: -16, bay: 'sideRight' },
  M1: { x: -14, y: 4, bay: 'main' },
  M2: { x: 14, y: 4, bay: 'main' },
  M3: { x: -14, y: 20, bay: 'main' },
  M4: { x: 14, y: 20, bay: 'main' },
  M5: { x: -14, y: 36, bay: 'main' },
  M6: { x: 14, y: 36, bay: 'main' },
};

const SHORT = { 'AIM-120': '120', 'AIM-9': '9' };

export const smd = {
  osb(s, ui, api) {
    const w = s.weapons;
    const sel = (type, t) => ({ t, on: w.selected === type, color: w.selected === type ? C.cyan : C.green, act: () => api.cmd('weaponSelect', type) });
    const bay = (k, t) => ({ t, on: !!w.bays?.[k], color: w.bays?.[k] ? C.amber : C.green, act: () => api.cmd('bay', k) });
    return {
      top: [sel('AIM-120', 'A-120'), sel('AIM-9', 'A-9'), sel('GUN', 'GUN'), {}, {}],
      bottom: [
        bay('main', 'MAIN'),
        bay('sideLeft', 'BAY L'),
        bay('sideRight', 'BAY R'),
        {},
        { t: w.masterArm ? 'ARM' : 'SAFE', on: true, color: w.masterArm ? C.red : C.green, act: () => api.cmd('masterArm', 'toggle') },
      ],
      left: [{}, {}, { t: 'FLR', act: () => api.cmd('countermeasure', 'flare') }, { t: 'CHF', act: () => api.cmd('countermeasure', 'chaff') }, {}],
    };
  },

  render(ctx, w, h, s, ui, t) {
    const wp = s.weapons;
    const cx = w / 2;
    const cy = 112;

    // contorno da aeronave
    ctx.strokeStyle = C.greenDim;
    ctx.lineWidth = 1.3;
    ctx.beginPath();
    OUTLINE.forEach(([x, y], i) => (i ? ctx.lineTo(cx + x, cy + y) : ctx.moveTo(cx + x, cy + y)));
    ctx.closePath();
    ctx.stroke();

    // portas das baias
    const bayRect = { sideLeft: [-54, -26, 28, 20], sideRight: [26, -26, 28, 20], main: [-32, -6, 64, 52] };
    for (const [k, [x, y, bw, bh]] of Object.entries(bayRect)) {
      const open = !!wp.bays?.[k];
      ctx.setLineDash(open ? [] : [3, 3]);
      box(ctx, cx + x, cy + y, bw, bh, open ? C.amber : C.greenDim, open ? 1.6 : 1);
      ctx.setLineDash([]);
      if (open) txt(ctx, 'OPEN', cx + x + bw / 2, cy + y - 6, { size: 8, bold: true, align: 'center', color: C.amber });
    }

    // estações
    const stores = wp.stores || [];
    const nextId = stores.find((st) => st.type === wp.selected && st.status === 'RDY')?.station;
    for (const st of stores) {
      const p = STATIONS[st.station];
      if (!p) continue;
      const x = cx + p.x - 11;
      const y = cy + p.y - 6;
      const selected = st.type === wp.selected;
      if (st.status === 'RDY') {
        ctx.fillStyle = selected ? C.cyan : C.green;
        ctx.fillRect(x, y, 22, 12);
        txt(ctx, SHORT[st.type] || st.type, x + 11, y + 6.5, { size: 8, bold: true, align: 'center', color: '#001a0a' });
      } else {
        box(ctx, x, y, 22, 12, C.red, 1);
        line(ctx, x, y, x + 22, y + 12, C.red, 1);
        line(ctx, x + 22, y, x, y + 12, C.red, 1);
      }
      if (st.station === nextId && blink(t, 1.5)) box(ctx, x - 3, y - 3, 28, 18, C.white, 1.3);
    }

    // textos
    const rdy = stores.filter((st) => st.type === wp.selected && st.status === 'RDY').length;
    const selTxt = wp.selected === 'GUN' ? `GUN ${wp.gun}` : `${wp.selected} ×${rdy}`;
    txt(ctx, selTxt, 12, 30, { size: 11, bold: true, color: C.cyan });
    txt(ctx, `GUN ${wp.gun ?? 0}`, w - 12, 30, { size: 10, align: 'right', color: (wp.gun || 0) < 100 ? C.amber : C.green });
    txt(ctx, `FLR ${wp.flares ?? 0}`, w - 12, 150, { size: 10, align: 'right', color: (wp.flares || 0) < 10 ? C.amber : C.green });
    txt(ctx, `CHF ${wp.chaff ?? 0}`, w - 12, 164, { size: 10, align: 'right', color: (wp.chaff || 0) < 10 ? C.amber : C.green });

    const inF = (s.missiles || []).filter((m) => m.side === 'own' && m.status === 'flight');
    if (inF.length) {
      txt(ctx, `MSL ${inF.length}`, w - 12, 56, { size: 10, bold: true, align: 'right', color: C.white });
      inF.slice(0, 3).forEach((m, i) => txt(ctx, `TOF ${Math.round(m.tof || 0)}`, w - 12, 70 + i * 12, { size: 9, align: 'right', color: C.white }));
    }

    const armCol = wp.masterArm ? C.red : C.green;
    box(ctx, cx - 34, 192, 68, 18, armCol, 1.5, wp.masterArm ? 'rgba(255,71,71,0.15)' : null);
    txt(ctx, wp.masterArm ? 'ARM' : 'SAFE', cx, 201.5, { size: 12, bold: true, align: 'center', color: armCol });
  },
};
