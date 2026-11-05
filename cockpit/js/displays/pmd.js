// PMD (display central): situação tática com radar, contatos, alvo travado, mísseis e waypoint.
import { C, D2R, clamp, norm360, txt, line, circle, box, blink, contactSymbol, ownship, pad } from './common.js';

const LABELS = ['N', '03', '06', 'E', '12', '15', 'S', '21', '24', 'W', '30', '33'];

export const pmd = {
  osb(s, ui, api) {
    return {
      top: [
        { t: 'RNG▲', act: () => api.cmd('radarRange', 'up') },
        { t: 'RNG▼', act: () => api.cmd('radarRange', 'down') },
        { t: s.radar.mode || 'RWS', on: true, act: () => api.cmd('radarMode', 'next') },
        { t: 'DCLT', on: ui.declutter, act: () => (ui.declutter = !ui.declutter) },
        { t: 'SA', on: true },
      ],
      bottom: [
        { t: 'LOCK', act: () => api.cmd('targetLock', 'nearest') },
        { t: 'NEXT', act: () => api.cmd('targetLock', 'next') },
        {},
        { t: 'UNLK', act: () => api.cmd('targetLock', 'off') },
        {},
      ],
    };
  },

  render(ctx, w, h, s, ui, t) {
    const cx = w / 2;
    const cy = h / 2 + 6;
    const R = 118;
    const rng = s.radar.range || 40;
    const hdg = s.flight.heading || 0;
    const polar = (brg, dist) => {
      const a = (brg - hdg) * D2R;
      const r = (dist / rng) * R;
      return [cx + Math.sin(a) * r, cy - Math.cos(a) * r, r];
    };

    // anéis e rosa
    circle(ctx, cx, cy, R, C.cyanDim, 1.2);
    circle(ctx, cx, cy, R / 2, C.cyanDim, 1);
    txt(ctx, rng / 2, cx + 3, cy - R / 2 - 6, { size: 9, color: C.cyanDim });
    for (let a = 0; a < 360; a += 10) {
      const ang = (a - hdg) * D2R;
      const l = a % 30 ? 4 : 8;
      line(ctx, cx + Math.sin(ang) * (R - l), cy - Math.cos(ang) * (R - l), cx + Math.sin(ang) * R, cy - Math.cos(ang) * R, C.cyan, 1);
      if (a % 30 === 0) {
        txt(ctx, LABELS[a / 30], cx + Math.sin(ang) * (R - 16), cy - Math.cos(ang) * (R - 16), {
          size: 9, color: C.cyan, align: 'center', bold: a === 0,
        });
      }
    }
    line(ctx, cx, cy - R - 6, cx, cy - R + 2, C.white, 2);

    // cone do radar ±60° e varredura
    const coneR = R;
    for (const s2 of [-60, 60]) {
      const a = s2 * D2R;
      line(ctx, cx, cy, cx + Math.sin(a) * coneR, cy - Math.cos(a) * coneR, C.greenFaint, 1);
    }
    if (s.radar.mode !== 'STT') {
      const a = 60 * Math.sin(t * 1.4) * D2R;
      line(ctx, cx, cy, cx + Math.sin(a) * coneR, cy - Math.cos(a) * coneR, C.greenDim, 1.5);
    }

    // waypoint
    const nav = s.nav || {};
    if (nav.wptDistance != null && nav.wptDistance <= rng) {
      const [x, y] = polar(nav.wptBearing, nav.wptDistance);
      ctx.strokeStyle = C.cyan;
      ctx.lineWidth = 1.4;
      ctx.beginPath();
      ctx.moveTo(x, y - 6);
      ctx.lineTo(x + 6, y);
      ctx.lineTo(x, y + 6);
      ctx.lineTo(x - 6, y);
      ctx.closePath();
      ctx.stroke();
      txt(ctx, nav.wptIndex != null ? nav.wptIndex + 1 : '', x + 9, y, { size: 9, color: C.cyan });
    }

    // contatos
    const tgId = s.targeting.locked ? s.targeting.targetId : null;
    for (const c of s.radar.contacts || []) {
      const [x, y, r] = polar(c.bearing, c.range);
      if (r > R) continue;
      const col = contactSymbol(ctx, c.type, x, y, 6);
      const va = ((c.heading || 0) - hdg) * D2R;
      const vl = 6 + (c.speed || 400) / 45;
      line(ctx, x + Math.sin(va) * 6, y - Math.cos(va) * 6, x + Math.sin(va) * (6 + vl), y - Math.cos(va) * (6 + vl), col, 1.3);
      txt(ctx, Math.round((c.alt || 0) / 1000), x + 9, y + 4, { size: 9, color: col });
      if (!ui.declutter) txt(ctx, c.id, x + 9, y - 7, { size: 8, color: C.greenDim });
      if (c.id === tgId) {
        box(ctx, x - 11, y - 11, 22, 22, C.white, 1.6);
        if (blink(t, 1.5)) line(ctx, cx, cy, x, y, 'rgba(234,255,242,0.35)', 1);
      }
    }

    // mísseis (próprios em branco, inimigos em vermelho)
    const contactsById = new Map((s.radar.contacts || []).map((c) => [c.id, c]));
    for (const m of s.missiles || []) {
      const [x, y, r] = polar(m.bearing, m.range);
      if (r > R) continue;
      const flying = m.status === 'flight';
      if (m.side === 'own') {
        const tgt = contactsById.get(m.target);
        if (flying && tgt) {
          const [tx, ty, tr] = polar(tgt.bearing, tgt.range);
          if (tr <= R) {
            ctx.setLineDash([3, 3]);
            line(ctx, x, y, tx, ty, 'rgba(234,255,242,0.45)', 1);
            ctx.setLineDash([]);
          }
        }
        circle(ctx, x, y, 3, null, 1, flying ? C.white : C.greenDim);
        txt(ctx, flying ? `${m.id} ${Math.round(m.tof)}s` : `${m.id} ${m.status === 'hit' ? 'HIT' : 'MISS'}`, x + 6, y - 7, {
          size: 8, bold: true, color: flying ? C.white : C.greenDim,
        });
      } else {
        const col = flying ? C.red : C.greenDim;
        if (flying || blink(t, 1)) {
          ctx.strokeStyle = col;
          ctx.lineWidth = 1.6;
          ctx.beginPath();
          ctx.moveTo(x, y - 6);
          ctx.lineTo(x + 6, y);
          ctx.lineTo(x, y + 6);
          ctx.lineTo(x - 6, y);
          ctx.closePath();
          ctx.stroke();
          const va = ((m.heading || 0) - hdg) * D2R;
          line(ctx, x, y, x + Math.sin(va) * 16, y - Math.cos(va) * 16, col, 1.5);
          txt(ctx, flying ? `${m.id} ${m.range.toFixed(1)}` : `${m.id} ${m.status === 'decoyed' ? 'DCY' : m.status === 'hit' ? 'HIT' : 'MISS'}`, x + 8, y + 9, {
            size: 8, bold: true, color: col,
          });
        }
      }
    }

    // ameaça (lançamento de míssil)
    if (s.threats?.missileLaunch && blink(t, 3)) {
      txt(ctx, 'MSL LAUNCH', cx, cy + 40, { size: 12, bold: true, color: C.red, align: 'center' });
    }

    ownship(ctx, cx, cy, C.cyan);

    // cabeçalho
    txt(ctx, `${s.radar.mode || ''}  ${rng}NM`, 12, 30, { size: 10, color: C.green, bold: true });
    txt(ctx, `HDG ${pad(norm360(hdg), 3)}`, 12, 43, { size: 10, color: C.cyan });

    const tg = s.targeting;
    if (tg.locked) {
      const xr = w - 10;
      txt(ctx, `TGT ${tg.targetId}`, xr, 30, { size: 10, bold: true, align: 'right', color: C.white });
      txt(ctx, `${tg.range.toFixed(1)}NM`, xr, 43, { size: 10, align: 'right' });
      txt(ctx, `Vc ${Math.round(tg.closure)}`, xr, 56, { size: 10, align: 'right' });
      if (tg.shootCue && blink(t, 2.5)) txt(ctx, 'SHOOT', xr, 70, { size: 11, bold: true, align: 'right', color: C.green });
    } else {
      txt(ctx, 'BUSCANDO', w - 10, 30, { size: 10, align: 'right', color: C.greenDim });
    }

    const counts = { hostile: 0, friendly: 0, unknown: 0 };
    for (const c of s.radar.contacts || []) counts[c.type] = (counts[c.type] || 0) + 1;
    txt(ctx, `H${counts.hostile}`, 12, h - 30, { size: 9, color: C.red });
    txt(ctx, `F${counts.friendly}`, 34, h - 30, { size: 9, color: C.green });
    txt(ctx, `U${counts.unknown}`, 56, h - 30, { size: 9, color: C.yellow });
    const ownFlying = (s.missiles || []).filter((m) => m.side === 'own' && m.status === 'flight').length;
    const enemyFlying = (s.missiles || []).filter((m) => m.side === 'enemy' && m.status === 'flight').length;
    txt(ctx, `${clamp(ownFlying, 0, 9)} MSL`, w - 10, h - 30, { size: 9, align: 'right', color: C.white });
    if (enemyFlying) txt(ctx, `${enemyFlying} THR`, w - 50, h - 30, { size: 9, align: 'right', color: C.red, bold: true });
  },
};
