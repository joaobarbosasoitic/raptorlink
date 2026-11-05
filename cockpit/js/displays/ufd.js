// UFDs: esquerdo = ICAW (warnings/cautions/advisories), direito = COMM/NAV/IFF.
import { C, txt, blink, thousands } from './common.js';

const ORDER = { warning: 0, caution: 1, advisory: 2 };
const COLOR = { warning: C.red, caution: C.amber, advisory: C.green };

export const ufdLeft = {
  render(ctx, w, h, s, ui, t) {
    txt(ctx, 'ICAW', 10, 11, { size: 9, bold: true, color: C.greenDim });
    const list = [...(s.warnings || [])].sort((a, b) => (ORDER[a.level] ?? 3) - (ORDER[b.level] ?? 3));
    txt(ctx, `${list.length} MSG`, w - 10, 11, { size: 9, align: 'right', color: C.greenDim });

    if (!list.length) {
      txt(ctx, 'NO FAULTS', w / 2, h / 2 + 6, { size: 12, align: 'center', color: C.greenDim });
      return;
    }
    const warnUnacked = ui.ack.warning !== ui.alerts.warnKey;
    const perCol = 7;
    list.slice(0, perCol * 2).forEach((m, i) => {
      const col = Math.floor(i / perCol);
      const row = i % perCol;
      const x = 10 + col * (w / 2);
      const y = 28 + row * 16;
      const c = COLOR[m.level] || C.white;
      if (m.level === 'warning' && warnUnacked && !blink(t, 2)) {
        ctx.fillStyle = 'rgba(255,71,71,0.25)';
        ctx.fillRect(x - 4, y - 7, w / 2 - 12, 14);
      }
      txt(ctx, String(m.msg).slice(0, 18), x, y, { size: 10, bold: m.level !== 'advisory', color: c });
    });
    if (list.length > perCol * 2) txt(ctx, `+${list.length - perCol * 2}`, w - 10, h - 8, { size: 9, align: 'right', color: C.white });
  },
};

export const ufdRight = {
  render(ctx, w, h, s) {
    const c = s.comm || {};
    const n = s.nav || {};
    const f = s.fuel || {};
    const CY = C.cyan;
    const rows = [
      ['COM1', c.com1 || '---.--', `STPT ${n.wptIndex != null ? n.wptIndex + 1 : '-'}`],
      ['COM2', c.com2 || '---.--', String(n.waypoint || '').replace(/^STPT \d+\s*/, '')],
      ['IFF', c.iff ? `${c.iff}  M4` : '----', `${(n.wptDistance || 0).toFixed(1)} NM`],
      ['FUEL', `${thousands(f.total)} KG`, `BNG ${thousands(f.bingo)}`],
    ];
    rows.forEach(([k, v, r], i) => {
      const y = 18 + i * 25;
      txt(ctx, k, 10, y, { size: 10, color: 'rgba(53,227,255,0.6)' });
      txt(ctx, v, 58, y, { size: 13, bold: true, color: CY });
      txt(ctx, r, w - 10, y, { size: 11, align: 'right', color: k === 'FUEL' && f.total < f.bingo ? C.amber : C.white });
    });
    const d = new Date();
    const z = `${String(d.getUTCHours()).padStart(2, '0')}:${String(d.getUTCMinutes()).padStart(2, '0')}:${String(d.getUTCSeconds()).padStart(2, '0')}Z`;
    txt(ctx, z, 10, h - 12, { size: 11, color: C.white });
    txt(ctx, `${s.radar.mode || ''} ${s.radar.range || ''}NM`, w - 10, h - 12, { size: 11, align: 'right', color: CY });
  },
};
