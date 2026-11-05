// "View" suavizada do estado: a telemetria chega a ~1 Hz, então interpolamos
// os valores contínuos a cada quadro para o HUD e o radar não andarem aos saltos.
import { norm180, norm360 } from './displays/common.js';

const SMOOTH = new Set([
  'airspeed', 'mach', 'altitude', 'vvi', 'heading', 'pitch', 'roll', 'yaw', 'aoa', 'gload',
  'rpm', 'egt', 'thrust', 'fuelFlow', 'throttle', 'total', 'consumption',
  'bearing', 'range', 'alt', 'wptBearing', 'wptDistance', 'lat', 'lon', 'groundSpeed', 'track',
  'windSpeed', 'windDir', 'oat', 'turbulence', 'closure', 'aspect', 'tof', 'targetRange', 'flightTime',
]);
const ANGLES = new Set(['heading', 'yaw', 'bearing', 'wptBearing', 'windDir', 'track']);
const TAU = 0.35; // s

const isObj = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);

function clone(v) {
  if (Array.isArray(v)) return v.map(clone);
  if (isObj(v)) {
    const o = {};
    for (const k of Object.keys(v)) o[k] = clone(v[k]);
    return o;
  }
  return v;
}

function sync(dst, src, k) {
  for (const key of Object.keys(src)) {
    const v = src[key];
    const cur = dst[key];
    if (Array.isArray(v)) {
      if (v.length && isObj(v[0]) && 'id' in v[0] && Array.isArray(cur)) {
        dst[key] = v.map((item) => {
          const prev = cur.find((c) => c && c.id === item.id);
          if (!prev) return clone(item);
          sync(prev, item, k);
          return prev;
        });
      } else {
        dst[key] = clone(v);
      }
    } else if (isObj(v)) {
      if (!isObj(cur)) dst[key] = {};
      sync(dst[key], v, k);
    } else if (typeof v === 'number' && typeof cur === 'number' && Number.isFinite(cur) && SMOOTH.has(key)) {
      dst[key] = ANGLES.has(key) ? norm360(cur + norm180(v - cur) * k) : cur + (v - cur) * k;
    } else {
      dst[key] = v;
    }
  }
}

export function createView(state) {
  return clone(state);
}

/** Atualiza a view em direção ao estado. snap=true copia sem interpolar. */
export function updateView(view, state, dt, snap = false) {
  const k = snap ? 1 : 1 - Math.exp(-Math.max(dt, 0) / TAU);
  sync(view, state, k);
  return view;
}
