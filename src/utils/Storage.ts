import { DEFAULT_SETTINGS, type Settings } from '../config';

const KEY_SETTINGS = 'fpv-sim/settings/v1';
const KEY_RECORDS = 'fpv-sim/records/v1';

export interface MissionRecord {
  stars: number;
  bestScore: number;
  bestTime: number; // сек, 0 — нет
  attempts: number;
}

function deepMerge<T>(base: T, over: unknown): T {
  if (typeof base !== 'object' || base === null || typeof over !== 'object' || over === null) {
    return (over === undefined ? base : (over as T)) ?? base;
  }
  const out: Record2 = { ...(base as Record2) };
  for (const k of Object.keys(base as Record2)) {
    const ov = (over as Record2)[k];
    if (ov !== undefined) out[k] = deepMerge((base as Record2)[k], ov);
  }
  return out as T;
}
type Record2 = { [k: string]: unknown };

export function loadSettings(): Settings {
  try {
    const raw = localStorage.getItem(KEY_SETTINGS);
    if (!raw) return structuredClone(DEFAULT_SETTINGS);
    return deepMerge(structuredClone(DEFAULT_SETTINGS), JSON.parse(raw));
  } catch {
    return structuredClone(DEFAULT_SETTINGS);
  }
}

export function saveSettings(s: Settings) {
  try {
    localStorage.setItem(KEY_SETTINGS, JSON.stringify(s));
  } catch {
    /* приватный режим — игнорируем */
  }
}

export function loadRecords(): { [id: string]: MissionRecord } {
  try {
    return JSON.parse(localStorage.getItem(KEY_RECORDS) || '{}');
  } catch {
    return {};
  }
}

export function submitRecord(id: string, stars: number, score: number, time: number, success: boolean): MissionRecord {
  const all = loadRecords();
  const r = all[id] ?? { stars: 0, bestScore: 0, bestTime: 0, attempts: 0 };
  r.attempts++;
  if (success) {
    r.stars = Math.max(r.stars, stars);
    r.bestTime = r.bestTime === 0 ? time : Math.min(r.bestTime, time);
  }
  r.bestScore = Math.max(r.bestScore, score);
  all[id] = r;
  try {
    localStorage.setItem(KEY_RECORDS, JSON.stringify(all));
  } catch {
    /* ignore */
  }
  return r;
}
