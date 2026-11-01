import type { TimeOfDay } from '../config';
import type { TargetGroup } from '../world/Level';

export type Category = 'mission' | 'training' | 'free';

export interface ObjectiveDef {
  type: 'destroy' | 'gates' | 'drop' | 'hover' | 'land' | 'altitude';
  label: string;
  count?: number; // destroy / gates
  zone?: string; // drop
  pad?: string; // land
  seconds?: number; // hover
  altitude?: number; // altitude
}

export interface MissionDef {
  id: string;
  category: Category;
  title: string;
  brief: string;
  timeLimit: number; // сек, 0 — без ограничения
  parTime: number; // сек для 3 звёзд
  payloads: number; // -1 — без ограничения
  groups: TargetGroup[];
  gates: boolean;
  zones: string[];
  pads: string[];
  hover: boolean;
  tod: TimeOfDay | null;
  objectives: ObjectiveDef[];
  sequential?: boolean;
}

const base = { groups: [] as TargetGroup[], gates: false, zones: [] as string[], pads: [] as string[], hover: false, tod: null as TimeOfDay | null, payloads: 0 };

export const MISSIONS: MissionDef[] = [
  {
    ...base,
    id: 'm1',
    category: 'mission',
    title: 'Первый вылет',
    brief: 'Тир на западе. Поразите 4 щита учебной нагрузкой. Метка CCIP на экране показывает точку падения.',
    timeLimit: 180,
    parTime: 100,
    payloads: 8,
    groups: ['range'],
    objectives: [{ type: 'destroy', count: 4, label: 'Поразить цели на тире' }],
  },
  {
    ...base,
    id: 'm2',
    category: 'mission',
    title: 'Доставка груза',
    brief: 'Доставьте груз в две зоны: A (северо-запад) и B (восток). Ориентируйтесь по световым маякам.',
    timeLimit: 240,
    parTime: 150,
    payloads: 4,
    zones: ['A', 'B'],
    objectives: [
      { type: 'drop', zone: 'A', label: 'Сбросить груз в зону A' },
      { type: 'drop', zone: 'B', label: 'Сбросить груз в зону B' },
    ],
  },
  {
    ...base,
    id: 'm3',
    category: 'mission',
    title: 'Зачистка деревни',
    brief: 'В деревне на северо-востоке — цели в зданиях и на улицах. Поразите 6 целей. Пролетайте через окна.',
    timeLimit: 300,
    parTime: 190,
    payloads: 9,
    groups: ['village'],
    objectives: [{ type: 'destroy', count: 6, label: 'Поразить цели в деревне' }],
  },
  {
    ...base,
    id: 'm4',
    category: 'mission',
    title: 'Колонна',
    brief: 'Колонна техники движется по главной дороге. Поразите 3 движущиеся цели — упреждайте.',
    timeLimit: 200,
    parTime: 120,
    payloads: 8,
    groups: ['convoy'],
    objectives: [{ type: 'destroy', count: 3, label: 'Остановить колонну' }],
  },
  {
    ...base,
    id: 'm5',
    category: 'mission',
    title: 'Операция «Ночь»',
    brief: 'Ночная операция: деревня и патруль у окопов. Поразите 8 целей. Камера работает на усилении — шума больше.',
    timeLimit: 360,
    parTime: 240,
    payloads: 12,
    groups: ['village', 'patrol'],
    tod: 'night',
    objectives: [{ type: 'destroy', count: 8, label: 'Поразить цели' }],
  },
  {
    ...base,
    id: 't1',
    category: 'training',
    title: 'Точность',
    brief: 'Поразите все 6 щитов тира за минимальное время.',
    timeLimit: 150,
    parTime: 60,
    payloads: 12,
    groups: ['range'],
    objectives: [{ type: 'destroy', count: 6, label: 'Поразить щиты' }],
  },
  {
    ...base,
    id: 't2',
    category: 'training',
    title: 'Слалом',
    brief: 'Пролетите 10 ворот по порядку. Следующие ворота подсвечены бирюзовым.',
    timeLimit: 120,
    parTime: 55,
    gates: true,
    objectives: [{ type: 'gates', count: 10, label: 'Пройти ворота' }],
  },
  {
    ...base,
    id: 't3',
    category: 'training',
    title: 'Hover-тест',
    brief: 'Удерживайте дрон в сфере 15 секунд (скорость < 2 м/с).',
    timeLimit: 90,
    parTime: 30,
    hover: true,
    objectives: [{ type: 'hover', seconds: 15, label: 'Удерживать позицию' }],
  },
  {
    ...base,
    id: 't4',
    category: 'training',
    title: 'Посадка',
    brief: 'Поднимитесь на 20 м и мягко сядьте на площадку 2 (оранжевая, юго-восток).',
    timeLimit: 150,
    parTime: 70,
    pads: ['L2'],
    sequential: true,
    objectives: [
      { type: 'altitude', altitude: 20, label: 'Набрать высоту 20 м' },
      { type: 'land', pad: 'L2', label: 'Посадка на площадку 2' },
    ],
  },
];

export const FREE: MissionDef = {
  ...base,
  id: 'free',
  category: 'free',
  title: 'Свободный полёт',
  brief: 'Открытый полигон без ограничений.',
  timeLimit: 0,
  parTime: 0,
  payloads: -1,
  groups: ['range', 'village', 'convoy', 'patrol'],
  objectives: [],
};
