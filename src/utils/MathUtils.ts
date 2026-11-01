/** Математические утилиты */

export function clamp(v: number, min: number, max: number): number {
  return v < min ? min : v > max ? max : v;
}

export function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

/** Экспоненциальное сглаживание, не зависящее от fps */
export function damp(current: number, target: number, lambda: number, dt: number): number {
  return lerp(current, target, 1 - Math.exp(-lambda * dt));
}

export function deg2rad(d: number): number {
  return (d * Math.PI) / 180;
}

export function randRange(min: number, max: number): number {
  return min + Math.random() * (max - min);
}

export function formatTime(sec: number): string {
  const s = Math.max(0, Math.floor(sec));
  const m = Math.floor(s / 60);
  return `${m}:${String(s % 60).padStart(2, '0')}`;
}

/**
 * Пересечение отрезка (origin → origin + dir*len) с AABB (метод слэбов).
 * Используется для проверки прямой видимости и попадания груза.
 */
export function segmentHitsAABB(
  ox: number, oy: number, oz: number,
  dx: number, dy: number, dz: number,
  len: number,
  b: { min: { x: number; y: number; z: number }; max: { x: number; y: number; z: number } }
): boolean {
  let tmin = 0;
  let tmax = len;
  const inv = [1 / dx, 1 / dy, 1 / dz]; // Infinity при dx=0 — ок, slab-метод это переваривает
  const o = [ox, oy, oz];
  const bmin = [b.min.x, b.min.y, b.min.z];
  const bmax = [b.max.x, b.max.y, b.max.z];
  for (let i = 0; i < 3; i++) {
    let t1 = (bmin[i] - o[i]) * inv[i];
    let t2 = (bmax[i] - o[i]) * inv[i];
    if (t1 > t2) { const tmp = t1; t1 = t2; t2 = tmp; }
    if (t1 > tmin) tmin = t1;
    if (t2 < tmax) tmax = t2;
    if (tmin > tmax) return false;
  }
  return true;
}

/** Определение мобильного устройства */
export function isMobileDevice(): boolean {
  if (typeof navigator === 'undefined') return false;
  const ua = navigator.userAgent;
  const uaMobile = /Android|iPhone|iPad|iPod|Mobile|Silk/i.test(ua);
  const touchPrim = (navigator.maxTouchPoints ?? 0) > 1 && Math.min(screen.width, screen.height) < 900;
  return uaMobile || touchPrim;
}
