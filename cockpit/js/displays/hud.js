// HUD: horizonte/escada, fitas de velocidade/altitude/proa, dados de voo e simbologia de alvo.
import { C, D2R, clamp, norm180, norm360, txt, line, circle, box, blink, pad, thousands } from './common.js';

export const hud = {
  render(ctx, w, h, s, ui, t) {
    const f = s.flight;
    const tg = s.targeting;
    const wp = s.weapons;
    const cx = w / 2;
    const cy = h / 2 + 8;
    const ppd = 7.5; // pixels por grau
    const roll = (f.roll || 0) * D2R;
    const hy = (f.pitch || 0) * ppd;

    // --- mundo externo (céu/solo) visto através do combiner
    ctx.save();
    ctx.translate(cx, cy);
    ctx.rotate(-roll);
    let g = ctx.createLinearGradient(0, hy - h * 1.3, 0, hy);
    g.addColorStop(0, '#030b16');
    g.addColorStop(1, '#173550');
    ctx.fillStyle = g;
    ctx.fillRect(-w * 1.5, hy - h * 3, w * 3, h * 3);
    g = ctx.createLinearGradient(0, hy, 0, hy + h * 1.3);
    g.addColorStop(0, '#2b2617');
    g.addColorStop(1, '#0b0a06');
    ctx.fillStyle = g;
    ctx.fillRect(-w * 1.5, hy, w * 3, h * 3);
    ctx.restore();

    ctx.shadowColor = C.green;
    ctx.shadowBlur = 4;
    const G = C.green;

    // --- escada de arfagem
    ctx.save();
    ctx.beginPath();
    ctx.rect(cx - 175, 30, 350, h - 52);
    ctx.clip();
    ctx.translate(cx, cy);
    ctx.rotate(-roll);
    for (let p = -90; p <= 90; p += 5) {
      const y = hy - p * ppd;
      if (y < -h || y > h) continue;
      if (p === 0) {
        line(ctx, -240, y, -36, y, G, 1.4);
        line(ctx, 36, y, 240, y, G, 1.4);
        continue;
      }
      const half = p % 10 === 0 ? 62 : 42;
      const dir = p > 0 ? 6 : -6;
      ctx.setLineDash(p < 0 ? [7, 5] : []);
      line(ctx, -half, y, -20, y, G, 1.3);
      line(ctx, 20, y, half, y, G, 1.3);
      ctx.setLineDash([]);
      line(ctx, -half, y, -half, y + dir, G, 1.3);
      line(ctx, half, y, half, y + dir, G, 1.3);
      if (p % 10 === 0) {
        txt(ctx, Math.abs(p), -half - 6, y, { size: 10, align: 'right' });
        txt(ctx, Math.abs(p), half + 6, y, { size: 10 });
      }
    }
    ctx.restore();

    // --- linha de referência (waterline) e flight path marker
    ctx.strokeStyle = G;
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    [[-28, 0], [-14, 0], [-7, 7], [0, 0], [7, 7], [14, 0], [28, 0]].forEach(([x, y], i) =>
      i ? ctx.lineTo(cx + x, cy + y) : ctx.moveTo(cx + x, cy + y));
    ctx.stroke();

    const fpmY = cy + clamp(f.aoa || 0, -5, 20) * ppd * 0.8;
    circle(ctx, cx, fpmY, 6, G, 1.5);
    line(ctx, cx - 16, fpmY, cx - 6, fpmY, G, 1.5);
    line(ctx, cx + 6, fpmY, cx + 16, fpmY, G, 1.5);
    line(ctx, cx, fpmY - 6, cx, fpmY - 12, G, 1.5);

    // --- fita de proa
    const hdg = f.heading || 0;
    ctx.save();
    ctx.beginPath();
    ctx.rect(cx - 130, 0, 260, 28);
    ctx.clip();
    for (let d = Math.floor(hdg - 30); d <= hdg + 30; d++) {
      if (d % 5) continue;
      const x = cx + (d - hdg) * 5;
      line(ctx, x, 22, x, 22 - (d % 10 ? 4 : 8), G, 1.2);
      if (d % 10 === 0) txt(ctx, pad(norm360(d) / 10, 2), x, 8, { size: 10, align: 'center' });
    }
    ctx.restore();
    line(ctx, cx, 24, cx - 5, 30, G, 1.4);
    line(ctx, cx, 24, cx + 5, 30, G, 1.4);
    box(ctx, cx - 18, 31, 36, 14, G, 1, 'rgba(0,0,0,0.55)');
    txt(ctx, pad(norm360(hdg), 3), cx, 38.5, { size: 11, bold: true, align: 'center' });

    // --- fita de velocidade (esquerda)
    const ias = f.airspeed || 0;
    const sx = 76;
    ctx.save();
    ctx.beginPath();
    ctx.rect(10, 40, 72, h - 82);
    ctx.clip();
    for (let v = Math.floor((ias - 70) / 10) * 10; v <= ias + 70; v += 10) {
      if (v < 0) continue;
      const y = cy - (v - ias) * 1.6;
      line(ctx, sx - (v % 50 ? 5 : 10), y, sx, y, G, 1.2);
      if (v % 50 === 0) txt(ctx, v, sx - 13, y, { size: 10, align: 'right' });
    }
    ctx.restore();
    line(ctx, sx, 40, sx, h - 42, G, 1);
    box(ctx, 14, cy - 9, 56, 18, G, 1.2, 'rgba(0,0,0,0.7)');
    txt(ctx, Math.round(ias), 66, cy, { size: 12, bold: true, align: 'right' });
    txt(ctx, `G ${(f.gload || 0).toFixed(1)}`, 14, 30, { size: 11, bold: true, color: (f.gload || 0) > 8 ? C.amber : G });

    // --- fita de altitude (direita)
    const alt = f.altitude || 0;
    const ax = w - 76;
    ctx.save();
    ctx.beginPath();
    ctx.rect(ax - 6, 40, 76, h - 82);
    ctx.clip();
    for (let a = Math.floor((alt - 700) / 100) * 100; a <= alt + 700; a += 100) {
      const y = cy - (a - alt) * 0.125;
      line(ctx, ax, y, ax + (a % 500 ? 5 : 10), y, G, 1.2);
      if (a % 500 === 0) txt(ctx, (a / 1000).toFixed(1), ax + 13, y, { size: 10 });
    }
    ctx.restore();
    line(ctx, ax, 40, ax, h - 42, G, 1);
    box(ctx, w - 70, cy - 9, 60, 18, G, 1.2, 'rgba(0,0,0,0.7)');
    txt(ctx, thousands(alt), w - 14, cy, { size: 12, bold: true, align: 'right' });
    const vvi = f.vvi || 0;
    txt(ctx, `${vvi >= 0 ? '+' : '-'}${Math.abs(Math.round(vvi / 10) * 10)}`, w - 14, 30, { size: 11, bold: true, align: 'right' });

    // --- dados inferiores
    txt(ctx, `M ${(f.mach || 0).toFixed(2)}`, 14, h - 34, { size: 11, bold: true });
    txt(ctx, `α ${(f.aoa || 0).toFixed(1)}`, 14, h - 21, { size: 11 });
    txt(ctx, `GMAX ${(f.gmax || 0).toFixed(1)}`, 14, h - 8, { size: 10 });

    const count = wp.selected === 'GUN'
      ? wp.gun
      : (wp.stores || []).filter((st) => st.type === wp.selected && st.status === 'RDY').length;
    txt(ctx, `${wp.selected || '---'} ${count ?? 0}`, w - 14, h - 34, { size: 11, bold: true, align: 'right' });
    txt(ctx, wp.masterArm ? 'ARM' : 'SAFE', w - 14, h - 21, { size: 11, bold: wp.masterArm, align: 'right' });
    txt(ctx, `${s.radar.mode || ''} ${s.radar.range || ''}`, w - 14, h - 8, { size: 10, align: 'right' });

    if (s.systems?.gear && s.systems.gear !== 'UP') txt(ctx, 'GEAR', cx - 150, h - 12, { size: 11, bold: true });

    // --- alvo travado
    const c = tg.locked ? (s.radar.contacts || []).find((k) => k.id === tg.targetId) : null;
    if (c) {
      const az = norm180(c.bearing - hdg);
      const el = Math.atan2((c.alt || 0) - alt, Math.max(c.range, 0.01) * 6076) / D2R;
      const x = az * ppd;
      const y = -(el - (f.pitch || 0)) * ppd;
      const xr = x * Math.cos(-roll) - y * Math.sin(-roll);
      const yr = x * Math.sin(-roll) + y * Math.cos(-roll);

      if (Math.abs(xr) < w / 2 - 95 && Math.abs(yr) < h / 2 - 26) {
        box(ctx, cx + xr - 9, cy + yr - 9, 18, 18, G, 1.6);
        if (tg.shootCue && blink(t, 3)) {
          ctx.beginPath();
          ctx.moveTo(cx + xr, cy + yr - 15);
          ctx.lineTo(cx + xr + 15, cy + yr);
          ctx.lineTo(cx + xr, cy + yr + 15);
          ctx.lineTo(cx + xr - 15, cy + yr);
          ctx.closePath();
          ctx.stroke();
        }
      } else {
        // linha localizadora apontando para o alvo fora do campo de visão
        const ang = Math.atan2(yr, xr);
        line(ctx, cx + Math.cos(ang) * 22, cy + Math.sin(ang) * 22, cx + Math.cos(ang) * 60, cy + Math.sin(ang) * 60, G, 1.6);
        txt(ctx, `${Math.round(Math.abs(az))}`, cx + Math.cos(ang) * 74, cy + Math.sin(ang) * 74, { size: 10, align: 'center' });
      }

      if (wp.selected !== 'GUN') {
        circle(ctx, cx, cy, 42, C.greenDim, 1.2);
        const dx = clamp(az * 3, -40, 40);
        circle(ctx, cx + dx, cy - clamp(el * 3, -40, 40) * 0.3, 3, null, 1, G);
      }

      txt(ctx, c.id, 96, 52, { size: 10, bold: true });
      txt(ctx, `R ${tg.range.toFixed(1)}`, 96, 65, { size: 10 });
      txt(ctx, `Vc ${Math.round(tg.closure)}`, 96, 78, { size: 10 });
      txt(ctx, `ASP ${Math.abs(Math.round(tg.aspect))}${tg.aspect >= 0 ? 'R' : 'L'}`, w - 96, 52, { size: 10, align: 'right' });
      txt(ctx, `${Math.round((c.alt || 0) / 1000)}K`, w - 96, 65, { size: 10, align: 'right' });
    }

    if (wp.selected === 'GUN') {
      const gy = cy + 34;
      circle(ctx, cx, gy, 12, G, 1.3);
      circle(ctx, cx, gy, 1.5, null, 1, G);
      if (c && tg.range < 2) {
        ctx.lineWidth = 3;
        ctx.beginPath();
        ctx.arc(cx, gy, 12, -Math.PI / 2, -Math.PI / 2 + (Math.PI * 2 * clamp(tg.range / 1.2, 0, 1)));
        ctx.stroke();
      }
    }

    if (tg.shootCue) {
      if (blink(t, 2.5)) txt(ctx, 'SHOOT', cx, cy + 56, { size: 17, bold: true, align: 'center' });
    } else if (tg.inRange && tg.locked) {
      txt(ctx, 'IN RNG', cx, cy + 56, { size: 12, align: 'center' });
    }

    if (s.threats?.missileLaunch && blink(t, 3)) {
      txt(ctx, 'MSL LAUNCH', cx, cy - 52, { size: 15, bold: true, align: 'center' });
    }

    // rastreamento de mísseis: inimigo mais próximo (direção + distância + tempo) e TOF dos próprios
    const msls = s.missiles || [];
    const incoming = msls.filter((m) => m.side === 'enemy' && m.status === 'flight');
    if (incoming.length) {
      const m = incoming.reduce((a, b) => (b.range < a.range ? b : a));
      txt(ctx, `${m.id} ${m.range.toFixed(1)}NM ${Math.round(m.tof)}s`, cx, cy - 36, { size: 11, bold: true, align: 'center' });
      const a = norm180(m.bearing - hdg) * D2R; // marcação relativa ao nariz (0 = à frente)
      const r0 = 50;
      const r1 = 72;
      ctx.strokeStyle = G;
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(cx + Math.sin(a) * r0, cy - Math.cos(a) * r0);
      ctx.lineTo(cx + Math.sin(a) * r1, cy - Math.cos(a) * r1);
      ctx.stroke();
      if (blink(t, 3)) txt(ctx, 'M', cx + Math.sin(a) * (r1 + 9), cy - Math.cos(a) * (r1 + 9), { size: 12, bold: true, align: 'center' });
    }
    msls.filter((m) => m.side === 'own').slice(0, 3).forEach((m, i) => {
      const label = m.status === 'flight' ? `${m.id} TOF ${Math.round(m.tof)}` : `${m.id} ${m.status === 'hit' ? 'HIT' : 'MISS'}`;
      txt(ctx, label, 96, 92 + i * 13, { size: 10, bold: m.status === 'flight' });
    });
    if ((s.warnings || []).some((x) => x.code === 'PULL_UP') && blink(t, 3)) {
      txt(ctx, 'PULL UP', cx, cy - 40, { size: 18, bold: true, align: 'center' });
    }

    ctx.shadowBlur = 0;

    // reflexo do vidro do combiner
    g = ctx.createLinearGradient(0, 0, w, h);
    g.addColorStop(0, 'rgba(255,255,255,0.05)');
    g.addColorStop(0.45, 'rgba(255,255,255,0)');
    g.addColorStop(0.55, 'rgba(255,255,255,0.025)');
    g.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, w, h);
  },
};
