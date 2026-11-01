import type { RecordEntry, Settings } from '../types';

const SETTINGS_KEY = 'fpvpolygon.settings.v1';
const RECORDS_KEY = 'fpvpolygon.records.v1';

export const DEFAULT_SETTINGS: Settings = {
  rcRate: 1.0,
  superRate: 0.7,
  expo: 0.2,
  stickSens: 1.0,
  maxThrottle: 100,
  camTilt: 25,
  fov: 110,
  twr: 3.2,
  massKg: 0.68,
  quality: 'auto',
  lighting: 'day',
  shake: 0.6,
  volume: 0.8,
  osdStyle: 'analog',
  showFps: false,
  stickScale: 1.0,
};

function hasLS(): boolean {
  try {
    return typeof localStorage !== 'undefined';
  } catch {
    return false;
  }
}

export function loadSettings(): Settings {
  if (!hasLS()) return { ...DEFAULT_SETTINGS };
  try {
    const raw = localStorage.getItem(SETTINGS_KEY);
    if (!raw) return { ...DEFAULT_SETTINGS };
    const parsed = JSON.parse(raw) as Partial<Settings>;
    return { ...DEFAULT_SETTINGS, ...parsed };
  } catch {
    return { ...DEFAULT_SETTINGS };
  }
}

export function saveSettings(s: Settings): void {
  if (!hasLS()) return;
  try {
    localStorage.setItem(SETTINGS_KEY, JSON.stringify(s));
  } catch {
    /* приватный режим — игнорируем */
  }
}

export function loadRecords(): Record<string, RecordEntry> {
  if (!hasLS()) return {};
  try {
    const raw = localStorage.getItem(RECORDS_KEY);
    if (!raw) return {};
    return JSON.parse(raw) as Record<string, RecordEntry>;
  } catch {
    return {};
  }
}

export function saveRecord(id: string, entry: RecordEntry): Record<string, RecordEntry> {
  const all = loadRecords();
  const prev = all[id];
  if (!prev ||
      entry.stars > prev.stars ||
      entry.bestScore > prev.bestScore ||
      (entry.bestTime > 0 && (prev.bestTime === 0 || entry.bestTime < prev.bestTime))) {
    all[id] = {
      stars: Math.max(entry.stars, prev?.stars ?? 0),
      bestScore: Math.max(entry.bestScore, prev?.bestScore ?? 0),
      bestTime: entry.bestTime > 0
        ? (prev?.bestTime ? Math.min(entry.bestTime, prev.bestTime) : entry.bestTime)
        : (prev?.bestTime ?? 0),
    };
    if (hasLS()) {
      try {
        localStorage.setItem(RECORDS_KEY, JSON.stringify(all));
      } catch {
        /* ignore */
      }
    }
  }
  return all;
}

export function clearRecords(): void {
  if (!hasLS()) return;
  try {
    localStorage.removeItem(RECORDS_KEY);
  } catch {
    /* ignore */
  }
}
