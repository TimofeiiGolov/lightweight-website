export const clamp = (x: number, a: number, b: number) => (x < a ? a : x > b ? b : x);
export const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
export const smoothstep = (a: number, b: number, x: number) => {
  const t = clamp((x - a) / (b - a), 0, 1);
  return t * t * (3 - 2 * t);
};
/** Экспоненциальное сглаживание, не зависящее от dt */
export const damp = (cur: number, target: number, rate: number, dt: number) =>
  lerp(cur, target, 1 - Math.exp(-rate * dt));

export function hash2(x: number, y: number): number {
  const s = Math.sin(x * 127.1 + y * 311.7) * 43758.5453;
  return s - Math.floor(s);
}

export function noise2(x: number, y: number): number {
  const xi = Math.floor(x);
  const yi = Math.floor(y);
  const xf = x - xi;
  const yf = y - yi;
  const u = xf * xf * (3 - 2 * xf);
  const v = yf * yf * (3 - 2 * yf);
  const a = hash2(xi, yi);
  const b = hash2(xi + 1, yi);
  const c = hash2(xi, yi + 1);
  const d = hash2(xi + 1, yi + 1);
  return lerp(lerp(a, b, u), lerp(c, d, u), v);
}

export function fbm(x: number, y: number, oct = 4): number {
  let amp = 0.5;
  let f = 1;
  let sum = 0;
  for (let i = 0; i < oct; i++) {
    sum += amp * noise2(x * f, y * f);
    f *= 2;
    amp *= 0.5;
  }
  return sum;
}

/** Детерминированный ГПСЧ (mulberry32) — мир одинаков при каждом запуске */
export function rng(seed: number) {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export const DEG = Math.PI / 180;

/** Betaflight Actual Rates: стик (-1..1) -> град/с */
export function actualRate(x: number, center: number, max: number, expo: number): number {
  const a = Math.abs(x);
  const expof = a * a * a * expo + a * (1 - expo);
  const stick = Math.max(0, max - center);
  return Math.sign(x) * (a * center + stick * expof);
}

/** Мировая высота рельефа: плато в центре, холмы по краям (чаша) */
export const WORLD_SIZE = 760;
export const FLAT_RADIUS = 250;
export function terrainHeight(x: number, z: number): number {
  const r = Math.hypot(x, z);
  const t = smoothstep(FLAT_RADIUS, FLAT_RADIUS + 110, r);
  if (t <= 0) return 0;
  const n = fbm(x * 0.012 + 11, z * 0.012 + 5, 4);
  return t * (8 + n * 70) + t * t * 40;
}
