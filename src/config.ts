/**
 * Конфигурация физики и мира.
 * Все ключевые параметры собраны здесь — можно тюнить без правки логики.
 */

export const TITLE = 'FPV ПОЛИГОН';
export const VERSION = '1.0.0';

/** Физика полёта */
export const PHYS = {
  gravity: 9.81,
  stepHz: 120,            // фиксированный шаг физики
  maxStepsPerFrame: 8,    // защита от «спирали смерти»
  // Аэродинамическое сопротивление: a = -(c1 + c2*|v|) * v
  dragC1: 0.08,
  dragC2: 0.018,
  // Угловое управление (PD на угловую скорость)
  inertia: 0.0026,        // кг·м² (масштабируется от массы)
  kpAng: 42,
  maxTorqueImpulse: 0.0045,
  // Моторы
  spoolTime: 0.18,        // сек, раскрутка пропеллеров
  // Аккумулятор 6S
  vbatFull: 25.2,
  vbatMin: 20.0,
  vbatSag: 1.3,           // просадка при полном газе
  flightMinutes: 4,       // ёмкость условной батареи
} as const;

/** Мир / полигон */
export const WORLD = {
  size: 320,          // размер ground-плейна
  fenceHalf: 145,     // граница игровой зоны
  rssiMaxDist: 260,
} as const;

/** Аварии и посадка */
export const CRASH = {
  dvThreshold: 6.0,   // резкая смена скорости за шаг = удар
  upsideDot: -0.15,   // переворот у земли
  resetDelay: 2.5,    // сек до авто-ресета
  landSpeed: 0.9,     // м/с — мягкая посадка
} as const;

/** Полезная нагрузка (условный учебный груз) */
export const PAYLOAD = {
  rearmSec: 8,
  blastRadius: 6.5,
  dragK: 0.02,
  scoreBullseye: 300, // < 2 м от центра зоны
  scoreGood: 150,     // < 4.5 м
  scoreHit: 50,       // внутри зоны
} as const;

/** Радиосигнал (имитация RSSI) */
export const SIGNAL = {
  distPenalty: 55,    // потеря на максимальной дистанции
  occludedPenalty: 45,// за препятствием
  noiseBelow: 35,     // ниже — шум на картинке
  lostBelow: 8,       // ниже — SIGNAL LOST
} as const;

/** Очки */
export const SCORE = {
  targetStatic: 100,
  targetMover: 150,
  gate: 50,
  missionComplete: 200,
  perSecondLeft: 2,
} as const;
