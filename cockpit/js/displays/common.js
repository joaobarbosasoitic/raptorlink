// Utilitários de desenho compartilhados pelas telas (canvas 2D).

export const C = {
  bg: '#010805',
  green: '#3cff7c',
  greenDim: 'rgba(60,255,124,0.38)',
  greenFaint: 'rgba(60,255,124,0.14)',
  cyan: '#35e3ff',
  cyanDim: 'rgba(53,227,255,0.35)',
  white: '#eafff2',
  yellow: '#ffd43b',
  amber: '#ffab2e',
  red: '#ff4747',
  magenta: '#ff63e8',
  dim: '#4f6b5a',
};

export const FONT = '"B612 Mono", "DejaVu Sans Mono", "Consolas", monospace';
export const D2R = Math.PI / 180;

export const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
export const norm360 = (a) => ((a % 360) + 360) % 360;
export const norm180 = (a) => {
  const n = norm360(a);
  return n > 180 ? n - 360 : n;
};
export const blink = (t, hz = 2) => Math.floor(t * hz * 2) % 2 === 0;
export const num = (v, d = 0) => (Number.isFinite(+v) ? (+v).toFixed(d) : '--');
export const thousands = (v) => (Number.isFinite(+v) ? Math.round(+v).toLocaleString('en-US') : '--');
export const pad = (v, n) => String(Math.round(v)).padStart(n, '0');

export function font(ctx, size, bold = false) {
  ctx.font = `${bold ? '700 ' : ''}${size}px ${FONT}`;
}

export function txt(ctx, s, x, y, o = {}) {
  ctx.fillStyle = o.color || C.green;
  font(ctx, o.size || 12, o.bold);
  ctx.textAlign = o.align || 'left';
  ctx.textBaseline = o.base || 'middle';
  ctx.fillText(String(s), x, y);
}

export function line(ctx, x1, y1, x2, y2, color = C.green, w = 1) {
  ctx.strokeStyle = color;
  ctx.lineWidth = w;
  ctx.beginPath();
  ctx.moveTo(x1, y1);
  ctx.lineTo(x2, y2);
  ctx.stroke();
}

export function circle(ctx, x, y, r, color = C.green, w = 1, fill = null) {
  ctx.beginPath();
  ctx.arc(x, y, r, 0, Math.PI * 2);
  if (fill) {
    ctx.fillStyle = fill;
    ctx.fill();
  }
  if (color) {
    ctx.strokeStyle = color;
    ctx.lineWidth = w;
    ctx.stroke();
  }
}

export function box(ctx, x, y, w, h, color = C.green, lw = 1, fill = null) {
  if (fill) {
    ctx.fillStyle = fill;
    ctx.fillRect(x, y, w, h);
  }
  if (color) {
    ctx.strokeStyle = color;
    ctx.lineWidth = lw;
    ctx.strokeRect(x, y, w, h);
  }
}

/** Texto com caixa ao redor (usado para destacar valores). */
export function boxedTxt(ctx, s, x, y, o = {}) {
  txt(ctx, s, x, y, o);
  const m = ctx.measureText(String(s)).width;
  const align = o.align || 'left';
  const bx = align === 'center' ? x - m / 2 : align === 'right' ? x - m : x;
  const hgt = (o.size || 12) + 4;
  box(ctx, bx - 3, y - hgt / 2, m + 6, hgt, o.color || C.green, 1);
}

/**
 * Rótulos dos OSBs (5 por lado). Posições batem com os botões HTML
 * distribuídos com `justify-content: space-around`.
 * osb = { top:[{t,on,color}], bottom:[...], left:[...], right:[...] }
 */
export function drawOSB(ctx, w, h, osb) {
  const pos = (i, L) => ((i + 0.5) * L) / 5;
  const draw = (e, x, y, align) => {
    if (!e || !e.t) return;
    const col = e.color || C.green;
    if (e.on) boxedTxt(ctx, e.t, x, y, { size: 10, bold: true, align, color: col });
    else txt(ctx, e.t, x, y, { size: 10, bold: true, align, color: col });
  };
  (osb.top || []).forEach((e, i) => draw(e, pos(i, w), 11, 'center'));
  (osb.bottom || []).forEach((e, i) => draw(e, pos(i, w), h - 11, 'center'));
  (osb.left || []).forEach((e, i) => draw(e, 7, pos(i, h), 'left'));
  (osb.right || []).forEach((e, i) => draw(e, w - 7, pos(i, h), 'right'));
}

/** Mostrador em arco de 270°. */
export function arcGauge(ctx, cx, cy, r, v, min, max, o = {}) {
  const a0 = 135 * D2R;
  const sweep = 270 * D2R;
  const val = Number.isFinite(+v) ? +v : min;
  const f = clamp((val - min) / (max - min), 0, 1);
  const at = (x) => a0 + sweep * clamp((x - min) / (max - min), 0, 1);

  ctx.lineWidth = 1;
  ctx.strokeStyle = C.greenDim;
  ctx.beginPath();
  ctx.arc(cx, cy, r, a0, a0 + sweep);
  ctx.stroke();

  for (let i = 0; i <= 10; i++) {
    const a = a0 + (sweep * i) / 10;
    const l = i % 5 === 0 ? 7 : 4;
    line(ctx, cx + Math.cos(a) * (r - l), cy + Math.sin(a) * (r - l), cx + Math.cos(a) * r, cy + Math.sin(a) * r, C.greenDim, 1);
  }
  if (o.warn != null) {
    ctx.strokeStyle = C.amber;
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(cx, cy, r + 3, at(o.warn), at(o.danger ?? max));
    ctx.stroke();
  }
  if (o.danger != null) {
    ctx.strokeStyle = C.red;
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(cx, cy, r + 3, at(o.danger), at(max));
    ctx.stroke();
  }

  let col = C.green;
  if (o.danger != null && val >= o.danger) col = C.red;
  else if (o.warn != null && val >= o.warn) col = C.amber;

  ctx.strokeStyle = col;
  ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.arc(cx, cy, r - 2, a0, a0 + sweep * f);
  ctx.stroke();

  const a = a0 + sweep * f;
  line(ctx, cx, cy, cx + Math.cos(a) * (r - 8), cy + Math.sin(a) * (r - 8), C.white, 1.5);
  circle(ctx, cx, cy, 2, null, 1, C.white);

  const fmt = o.fmt || ((x) => x.toFixed(0));
  txt(ctx, fmt(val), cx, cy + r * 0.48, { color: col, size: 13, bold: true, align: 'center' });
  if (o.label) txt(ctx, o.label, cx, cy + r + 9, { color: C.greenDim, size: 9, align: 'center' });
}

export function hbar(ctx, x, y, w, h, frac, color = C.green) {
  box(ctx, x, y, w, h, C.greenDim, 1);
  ctx.fillStyle = color;
  ctx.fillRect(x + 1, y + 1, Math.max(0, (w - 2) * clamp(frac, 0, 1)), h - 2);
}

export const CONTACT_COLOR = { hostile: C.red, friendly: C.green, unknown: C.yellow };

/** Símbolo de contato tático (hostil=triângulo, amigo=círculo, desconhecido=quadrado). */
export function contactSymbol(ctx, type, x, y, size = 6) {
  const col = CONTACT_COLOR[type] || C.yellow;
  ctx.strokeStyle = col;
  ctx.lineWidth = 1.6;
  ctx.beginPath();
  if (type === 'hostile') {
    ctx.moveTo(x, y - size);
    ctx.lineTo(x + size, y + size * 0.8);
    ctx.lineTo(x - size, y + size * 0.8);
    ctx.closePath();
  } else if (type === 'friendly') {
    ctx.arc(x, y, size * 0.9, 0, Math.PI * 2);
  } else {
    ctx.rect(x - size * 0.8, y - size * 0.8, size * 1.6, size * 1.6);
  }
  ctx.stroke();
  return col;
}

/** Símbolo da própria aeronave (vista de cima). */
export function ownship(ctx, x, y, color = C.cyan, s = 1) {
  ctx.strokeStyle = color;
  ctx.lineWidth = 1.6;
  ctx.beginPath();
  ctx.moveTo(x, y - 9 * s);
  ctx.lineTo(x, y + 7 * s);
  ctx.moveTo(x - 8 * s, y + 1 * s);
  ctx.lineTo(x + 8 * s, y + 1 * s);
  ctx.moveTo(x - 4 * s, y + 7 * s);
  ctx.lineTo(x + 4 * s, y + 7 * s);
  ctx.stroke();
}
