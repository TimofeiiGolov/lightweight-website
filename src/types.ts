/** Общие типы проекта FPV POLYGON */

export type Quality = 'low' | 'medium' | 'high';
export type QualitySetting = 'auto' | Quality;
export type LightingMode = 'day' | 'dusk';
export type OSDStyle = 'analog' | 'digital';
export type FlightMode = 'ACRO' | 'ANGLE';
export type GameState = 'loading' | 'menu' | 'flying' | 'paused' | 'results';

/** Ввод пилота, все значения нормализованы [-1..1], throttle [0..1] */
export interface FlightInput {
  throttle: number; // 0..1, не пружинит к центру
  yaw: number;      // -1..1 (право +)
  pitch: number;    // -1..1 (вперёд/нос вниз +)
  roll: number;     // -1..1 (право +)
}

export interface Settings {
  // Rates в стиле Betaflight
  rcRate: number;      // 0.6..1.6
  superRate: number;   // 0.3..0.95
  expo: number;        // 0..0.6
  // Управление
  stickSens: number;   // 0.5..1.5 чувствительность стиков
  maxThrottle: number; // 60..120 %
  // Камера
  camTilt: number;     // 0..45 град (вверх)
  fov: number;         // 80..130
  // Физика дрона
  twr: number;         // 1.5..4 тяговооружённость
  massKg: number;      // 0.4..1.2
  // Графика
  quality: QualitySetting;
  lighting: LightingMode;
  shake: number;       // 0..1 тряска камеры
  // Звук
  volume: number;      // 0..1
  // OSD
  osdStyle: OSDStyle;
  showFps: boolean;
  // Стики
  stickScale: number;  // 0.7..1.4
}

export interface RecordEntry {
  stars: number;     // 0..3
  bestScore: number;
  bestTime: number;  // сек, меньше — лучше (0 если нет)
}

export interface Telemetry {
  speed: number;     // м/с
  alt: number;       // м
  vbat: number;      // В
  throttle: number;  // 0..1 фактический (со spool)
  rssi: number;      // 0..100
}

/** Цель миссии */
export type ObjectiveType = 'destroy' | 'gates' | 'payload' | 'hover' | 'land';

export interface ObjectiveDef {
  type: ObjectiveType;
  desc: string;
  /** destroy: индексы целей, gates: индексы ворот по порядку, payload: индексы зон */
  ids?: number[];
  /** hover: радиус удержания (м) */
  radius?: number;
  /** hover: сколько секунд суммарно удерживаться */
  seconds?: number;
  /** hover: точка якоря */
  anchor?: [number, number, number];
}

export interface MissionDef {
  id: string;
  title: string;
  desc: string;
  icon: string;
  mode: 'mission' | 'training' | 'free';
  timeLimit: number; // сек, 0 = без лимита
  spawn: { pos: [number, number, number]; yaw: number };
  objectives: ObjectiveDef[];
  /** время для 3 и 2 звёзд (тренировки без лимита времени) */
  starTimes?: [number, number];
}
