// Центральный конфиг: физика полёта, настройки пользователя, пресеты качества.

export type FlightMode = 'acro' | 'horizon' | 'angle';
export type ThrottleMode = 'hold' | 'assist';
export type QualitySetting = 'auto' | 'low' | 'medium' | 'high';
export type QualityLevel = 'low' | 'medium' | 'high';
export type TimeOfDay = 'day' | 'dusk' | 'night';
export type OsdStyle = 'analog' | 'digital';
export type PadMap = 'standard' | 'aetr' | 'taer';

export interface RateSet {
  center: number; // deg/s около центра (Betaflight Actual: Center Sensitivity)
  max: number; // deg/s на полном отклонении
  expo: number; // 0..1
}

export interface Settings {
  quality: QualitySetting;
  fov: number; // горизонтальный FOV, градусы
  camTilt: number; // наклон FPV-камеры, градусы
  flightMode: FlightMode;
  throttleMode: ThrottleMode;
  rpRates: RateSet;
  yawRates: RateSet;
  stickSens: number;
  deadzone: number;
  maxThrottle: number; // 0.4..1
  mass: number; // кг
  twr: number;
  osdStyle: OsdStyle;
  fpvFx: number; // 0..1 интенсивность FPV-эффектов
  volume: number; // 0..1
  stickSize: number; // 0.6..1.5
  stickMargin: number; // px от края
  stickBottom: number; // px от низа
  touchUi: 'auto' | 'on' | 'off';
  padMap: PadMap;
  timeOfDay: TimeOfDay;
  freeTargets: boolean;
  pipper: boolean;
  haptics: boolean;
}

export const DEFAULT_SETTINGS: Settings = {
  quality: 'auto',
  fov: 112,
  camTilt: 25,
  flightMode: 'angle',
  throttleMode: 'assist',
  rpRates: { center: 90, max: 600, expo: 0.25 },
  yawRates: { center: 80, max: 360, expo: 0.2 },
  stickSens: 1,
  deadzone: 0.06,
  maxThrottle: 1,
  mass: 0.9,
  twr: 5.5,
  osdStyle: 'analog',
  fpvFx: 0.7,
  volume: 0.6,
  stickSize: 1,
  stickMargin: 28,
  stickBottom: 24,
  touchUi: 'auto',
  padMap: 'standard',
  timeOfDay: 'day',
  freeTargets: true,
  pipper: true,
  haptics: true,
};

// Параметры физической модели (не меняются из меню, кроме mass/twr)
export const PHYS = {
  gravity: 9.81,
  hz: 240,
  // квадратичное сопротивление в осях корпуса (x — бок, y — вдоль оси тяги, z — фронт)
  dragQuad: [0.011, 0.016, 0.0075] as [number, number, number],
  dragLin: 0.04,
  thrustExpo: 0.6, // доля квадратичной составляющей в кривой тяги
  motorTauUp: 0.05, // раскрутка мотора, сек
  motorTauDown: 0.035,
  angTau: [0.04, 0.09, 0.04] as [number, number, number], // x(pitch), y(yaw), z(roll)
  maxAngAccel: 95, // рад/с² базовая угловая акселерация
  angleMax: (58 * Math.PI) / 180,
  angleP: 7.5,
  idle: 0.05,
  crashImpact: 7.5, // м/с — скачок скорости для краша
  bumpImpact: 3.2,
  crashTime: 3.2,
  armRadius: 0.085,
  batteryMah: 1600,
  cells: 4,
};

export interface QualityPreset {
  scale: number;
  prCap: number;
  shadow: number; // 0 — выкл, иначе размер карты
  msaa: number;
  physicsHz: number;
  fx: number; // множитель пост-эффектов
}

export const QUALITY: Record<QualityLevel, QualityPreset> = {
  low: { scale: 0.65, prCap: 1, shadow: 0, msaa: 0, physicsHz: 120, fx: 0.7 },
  medium: { scale: 0.85, prCap: 1.5, shadow: 1024, msaa: 2, physicsHz: 200, fx: 1 },
  high: { scale: 1, prCap: 2, shadow: 2048, msaa: 4, physicsHz: 240, fx: 1 },
};
