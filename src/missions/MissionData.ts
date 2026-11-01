import type { MissionDef } from '../types';

/**
 * Каталог режимов: 6 миссий, 4 тренировки, свободный полёт.
 * ids целей соответствуют порядку в defaultTargets():
 *  0..5 — щиты восточного тракта, 6..9 — манекены, 10..13 — бочки,
 *  14..15 — машины, 16..18 — пехота.
 * Ворота 0..7, зоны сброса 0..2.
 */
export const MISSIONS: MissionDef[] = [
  {
    id: 'm1',
    title: 'Первый вылет',
    desc: 'Уничтожь 4 щита на восточном тракте',
    icon: '🎯',
    mode: 'mission',
    timeLimit: 150,
    spawn: { pos: [0, 1.6, 6], yaw: 0 },
    objectives: [
      { type: 'destroy', ids: [0, 1, 2, 3], desc: 'Уничтожить щиты: 4' },
    ],
  },
  {
    id: 'm2',
    title: 'Лесной коридор',
    desc: 'Пройди 8 ворот по порядку на север',
    icon: '🚪',
    mode: 'mission',
    timeLimit: 150,
    spawn: { pos: [0, 2.0, 6], yaw: 0 },
    objectives: [
      { type: 'gates', ids: [0, 1, 2, 3, 4, 5, 6, 7], desc: 'Пройти ворота 1-8' },
    ],
  },
  {
    id: 'm3',
    title: 'Точный сброс',
    desc: 'Доставь груз в 3 зоны сброса',
    icon: '📦',
    mode: 'mission',
    timeLimit: 180,
    spawn: { pos: [0, 1.6, 6], yaw: 0 },
    objectives: [
      { type: 'payload', ids: [0, 1, 2], desc: 'Сброс в зоны: 0/3' },
    ],
  },
  {
    id: 'm4',
    title: 'Разведка огнём',
    desc: 'Уничтожь 3 движущиеся цели',
    icon: '🚙',
    mode: 'mission',
    timeLimit: 150,
    spawn: { pos: [0, 1.6, 6], yaw: 0 },
    objectives: [
      { type: 'destroy', ids: [14, 15, 16], desc: 'Движущиеся цели: 0/3' },
    ],
  },
  {
    id: 'm5',
    title: 'Штурм бункера',
    desc: 'Зачисти бункер: 2 манекена, 2 бочки',
    icon: '🛡️',
    mode: 'mission',
    timeLimit: 180,
    spawn: { pos: [60, 1.6, 6], yaw: 0 },
    objectives: [
      { type: 'destroy', ids: [10, 11, 8, 9], desc: 'Цели у бункера: 0/4' },
    ],
  },
  {
    id: 'm6',
    title: 'Мастер полигона',
    desc: 'Ворота 1-4 → 3 цели → сброс в зону',
    icon: '🏅',
    mode: 'mission',
    timeLimit: 240,
    spawn: { pos: [0, 2.0, 6], yaw: 0 },
    objectives: [
      { type: 'gates', ids: [0, 1, 2, 3], desc: 'Этап 1: ворота 1-4' },
      { type: 'destroy', ids: [0, 4, 12], desc: 'Этап 2: 3 цели' },
      { type: 'payload', ids: [0], desc: 'Этап 3: сброс в зону' },
    ],
  },
];

export const TRAININGS: MissionDef[] = [
  {
    id: 't1',
    title: 'Точность',
    desc: '10 статичных целей — как можно быстрее',
    icon: '⏱️',
    mode: 'training',
    timeLimit: 0,
    spawn: { pos: [0, 1.6, 6], yaw: 0 },
    starTimes: [100, 150],
    objectives: [
      { type: 'destroy', ids: [0, 1, 2, 3, 4, 5, 6, 7, 10, 12], desc: 'Цели: 0/10' },
    ],
  },
  {
    id: 't2',
    title: 'Слалом',
    desc: 'Курс из 8 ворот на время',
    icon: '🏁',
    mode: 'training',
    timeLimit: 0,
    spawn: { pos: [0, 2.0, 6], yaw: 0 },
    starTimes: [90, 130],
    objectives: [
      { type: 'gates', ids: [0, 1, 2, 3, 4, 5, 6, 7], desc: 'Ворота: 0/8' },
    ],
  },
  {
    id: 't3',
    title: 'Висение',
    desc: 'Удержись в кольце 15 секунд',
    icon: '🎈',
    mode: 'training',
    timeLimit: 0,
    spawn: { pos: [0, 1.6, 6], yaw: 0 },
    objectives: [
      { type: 'hover', anchor: [20, 8, 60], radius: 2.5, seconds: 15, desc: 'Висение: 0/15 с' },
    ],
  },
  {
    id: 't4',
    title: 'Посадка',
    desc: 'Мягко сядь на стартовый пад',
    icon: '🛬',
    mode: 'training',
    timeLimit: 0,
    spawn: { pos: [0, 12, 40], yaw: 0 },
    starTimes: [25, 45],
    objectives: [
      { type: 'land', radius: 3.4, desc: 'Приземлиться на пад' },
    ],
  },
];

export const FREE_FLIGHT: MissionDef = {
  id: 'free',
  title: 'Свободный полёт',
  desc: 'Открытый полигон без ограничений',
  icon: '🛸',
  mode: 'free',
  timeLimit: 0,
  spawn: { pos: [0, 1.6, 6], yaw: 0 },
  objectives: [],
};
