import type { Settings } from '../config';
import { FREE, MISSIONS, type Category, type MissionDef } from '../missions/MissionData';
import type { MissionResult } from '../missions/MissionManager';
import { loadRecords } from '../utils/Storage';

export interface MenuCallbacks {
  start(def: MissionDef): void;
  resume(): void;
  restart(): void;
  toMenu(): void;
  changed(path: string): void;
  preset(name: 'beginner' | 'pilot' | 'pro'): void;
}

type Ctl =
  | { path: string; label: string; type: 'range'; min: number; max: number; step: number; unit?: string; scale?: number }
  | { path: string; label: string; type: 'select'; options: [string, string][] }
  | { path: string; label: string; type: 'toggle' };

interface Section {
  title: string;
  ctls: Ctl[];
}

const SECTIONS: Section[] = [
  {
    title: 'Полёт',
    ctls: [
      { path: 'flightMode', label: 'Режим полёта', type: 'select', options: [['angle', 'Angle (новичок)'], ['horizon', 'Horizon'], ['acro', 'Acro (ручной)']] },
      { path: 'throttleMode', label: 'Газ', type: 'select', options: [['assist', 'Помощь: центр = висение'], ['hold', 'Как на пульте (удержание)']] },
      { path: 'maxThrottle', label: 'Макс. газ', type: 'range', min: 0.5, max: 1, step: 0.01, unit: '%', scale: 100 },
    ],
  },
  {
    title: 'Rates — крен/тангаж (Actual Rates)',
    ctls: [
      { path: 'rpRates.center', label: 'Center sens', type: 'range', min: 20, max: 300, step: 5, unit: '°/с' },
      { path: 'rpRates.max', label: 'Max rate', type: 'range', min: 200, max: 1000, step: 10, unit: '°/с' },
      { path: 'rpRates.expo', label: 'Expo', type: 'range', min: 0, max: 0.8, step: 0.01 },
    ],
  },
  {
    title: 'Rates — рысканье',
    ctls: [
      { path: 'yawRates.center', label: 'Center sens', type: 'range', min: 20, max: 300, step: 5, unit: '°/с' },
      { path: 'yawRates.max', label: 'Max rate', type: 'range', min: 100, max: 800, step: 10, unit: '°/с' },
      { path: 'yawRates.expo', label: 'Expo', type: 'range', min: 0, max: 0.8, step: 0.01 },
    ],
  },
  {
    title: 'Дрон',
    ctls: [
      { path: 'mass', label: 'Масса (с грузом)', type: 'range', min: 0.5, max: 1.6, step: 0.05, unit: ' кг' },
      { path: 'twr', label: 'Тяговооружённость (TWR)', type: 'range', min: 3, max: 10, step: 0.1 },
    ],
  },
  {
    title: 'Управление',
    ctls: [
      { path: 'stickSens', label: 'Чувствительность стиков', type: 'range', min: 0.5, max: 1.5, step: 0.05 },
      { path: 'deadzone', label: 'Мёртвая зона', type: 'range', min: 0, max: 0.25, step: 0.01 },
      { path: 'touchUi', label: 'Сенсорные стики', type: 'select', options: [['auto', 'Авто'], ['on', 'Всегда'], ['off', 'Выкл']] },
      { path: 'stickSize', label: 'Размер стиков', type: 'range', min: 0.6, max: 1.5, step: 0.05 },
      { path: 'stickMargin', label: 'Отступ от края', type: 'range', min: 0, max: 200, step: 2, unit: ' px' },
      { path: 'stickBottom', label: 'Отступ снизу', type: 'range', min: 0, max: 200, step: 2, unit: ' px' },
      { path: 'padMap', label: 'Геймпад / радио', type: 'select', options: [['standard', 'Геймпад (Xbox/PS)'], ['aetr', 'Радио AETR'], ['taer', 'Радио TAER']] },
    ],
  },
  {
    title: 'Камера и экран',
    ctls: [
      { path: 'fov', label: 'FOV (по горизонтали)', type: 'range', min: 80, max: 140, step: 1, unit: '°' },
      { path: 'camTilt', label: 'Наклон камеры', type: 'range', min: 0, max: 60, step: 1, unit: '°' },
      { path: 'osdStyle', label: 'Стиль OSD', type: 'select', options: [['analog', 'Аналоговый'], ['digital', 'Цифровой']] },
      { path: 'fpvFx', label: 'FPV-эффекты (шум, помехи)', type: 'range', min: 0, max: 1, step: 0.05 },
      { path: 'pipper', label: 'Метка точки падения', type: 'toggle' },
      { path: 'quality', label: 'Качество графики', type: 'select', options: [['auto', 'Авто'], ['low', 'Низкое'], ['medium', 'Среднее'], ['high', 'Высокое']] },
    ],
  },
  {
    title: 'Звук и отклик',
    ctls: [
      { path: 'volume', label: 'Громкость', type: 'range', min: 0, max: 1, step: 0.05 },
      { path: 'haptics', label: 'Вибрация при крэше', type: 'toggle' },
    ],
  },
  {
    title: 'Полигон (свободный полёт)',
    ctls: [
      { path: 'timeOfDay', label: 'Время суток', type: 'select', options: [['day', 'День'], ['dusk', 'Сумерки'], ['night', 'Ночь']] },
      { path: 'freeTargets', label: 'Мишени включены', type: 'toggle' },
    ],
  },
];

function getPath(o: unknown, path: string): unknown {
  return path.split('.').reduce((a, k) => (a as { [k: string]: unknown })[k], o);
}
function setPath(o: unknown, path: string, v: unknown) {
  const ks = path.split('.');
  const last = ks.pop()!;
  const t = ks.reduce((a, k) => (a as { [k: string]: unknown })[k], o) as { [k: string]: unknown };
  t[last] = v;
}

const stars = (n: number) => '★'.repeat(n) + '☆'.repeat(3 - n);
const fmt = (t: number) => `${Math.floor(t / 60)}:${String(Math.floor(t % 60)).padStart(2, '0')}`;

export class Menu {
  root = document.createElement('div');
  private from: 'main' | 'pause' = 'main';
  private cat: Category = 'mission';
  private lastDef: MissionDef | null = null;

  constructor(
    parent: HTMLElement,
    private getSettings: () => Settings,
    private cb: MenuCallbacks,
    private getPad: () => string,
  ) {
    this.root.className = 'menu';
    parent.appendChild(this.root);
    this.root.addEventListener('click', (e) => this.onClick(e));
    this.root.addEventListener('input', (e) => this.onInput(e));
    this.root.addEventListener('change', (e) => this.onInput(e));
    this.showLoading('Загрузка физики…');
  }

  hide() {
    this.root.style.display = 'none';
  }
  private show(html: string) {
    this.root.style.display = 'flex';
    this.root.innerHTML = `<div class="panel">${html}</div>`;
    this.root.scrollTop = 0;
  }
  get visible() {
    return this.root.style.display !== 'none';
  }

  showLoading(text: string) {
    this.show(`<h1>FPV<span>·</span>TACTICAL</h1><p class="sub">${text}</p>`);
  }

  showMain() {
    const pad = this.getPad();
    this.show(`
      <h1>FPV<span>·</span>TACTICAL</h1>
      <p class="sub">Учебно-боевой FPV-симулятор · военный полигон</p>
      <div class="col">
        <button class="big" data-act="list" data-cat="mission">▶ Миссии</button>
        <button class="big" data-act="list" data-cat="training">◎ Тренировки</button>
        <button class="big" data-act="free">✈ Свободный полёт</button>
        <button class="big alt" data-act="settings">⚙ Настройки</button>
        <button class="big alt" data-act="help">? Как управлять</button>
      </div>
      <p class="note">${pad ? `🎮 Подключён контроллер: ${pad.slice(0, 40)}` : 'Подключите геймпад или радиоаппаратуру (USB Joystick) — определится автоматически.'}</p>
      <p class="note">Только игровая симуляция: учебная нагрузка условна, эффекты стилизованы.</p>`);
  }

  showList(cat: Category) {
    this.cat = cat;
    const rec = loadRecords();
    const items = MISSIONS.filter((m) => m.category === cat)
      .map((m) => {
        const r = rec[m.id];
        const goal = m.objectives.map((o) => o.label).join(' · ');
        return `<button class="card" data-act="start" data-id="${m.id}">
          <div class="ct"><b>${m.title}</b><span class="st">${stars(r?.stars ?? 0)}</span></div>
          <div class="cd">${m.brief}</div>
          <div class="cm">${goal} · лимит ${fmt(m.timeLimit)}${m.tod === 'night' ? ' · ночь' : ''}</div>
          <div class="cm dim">${r ? `Рекорд: ${r.bestScore} очк.${r.bestTime ? ` · ${fmt(r.bestTime)}` : ''} · попыток ${r.attempts}` : 'Нет результатов'}</div>
        </button>`;
      })
      .join('');
    this.show(`<h2>${cat === 'mission' ? 'Миссии' : 'Тренировочные испытания'}</h2><div class="cards">${items}</div>
      <button class="back" data-act="main">← Назад</button>`);
  }

  showHelp() {
    this.show(`<h2>Управление</h2>
      <div class="help">
        <p><b>Сенсорный экран.</b> Левый стик: вертикаль — газ, горизонталь — рысканье (Mode 2). Правый: тангаж + крен. Кнопки ARM / DROP / CAM / VIEW / MODE — по краям.</p>
        <p><b>Взлёт:</b> нажмите ARM, затем потяните левый стик вверх. В режиме «помощь» центр стика = висение; в режиме «как на пульте» стик газа не возвращается.</p>
        <p><b>Сброс нагрузки:</b> метка-кружок на экране показывает точку падения. Поместите её на цель и нажмите DROP.</p>
        <p><b>Клавиатура:</b> W/S газ · A/D рысканье · стрелки тангаж/крен · Space ARM · F сброс · R reset · V вид · M режим · Q/E камера · Esc пауза.</p>
        <p><b>Геймпад:</b> A — ARM, B/RB — сброс, X — reset, Y — вид, LB — режим, D-pad ↑↓ — наклон камеры, Start — пауза. Для радио: AUX1 (ось 5) — ARM, AUX2 — сброс.</p>
        <p><b>Режимы:</b> Angle — самовыравнивание, Horizon — смешанный, Acro — ручное управление скоростями вращения. Rates настраиваются в меню (Betaflight Actual Rates).</p>
        <p><b>Сигнал:</b> при удалении и за препятствиями картинка зашумляется; потеря сигнала → failsafe и возврат на площадку.</p>
      </div>
      <button class="back" data-act="main">← Назад</button>`);
  }

  showSettings(from: 'main' | 'pause') {
    this.from = from;
    const s = this.getSettings();
    const rows = SECTIONS.map((sec) => {
      const ctl = sec.ctls
        .map((c) => {
          const v = getPath(s, c.path);
          if (c.type === 'range') {
            const sc = c.scale ?? 1;
            const shown = (Number(v) * sc).toFixed(c.step < 0.1 && sc === 1 ? 2 : c.step < 1 && sc === 1 ? 1 : 0);
            return `<label class="row"><span>${c.label}</span><em data-val="${c.path}">${shown}${c.unit ?? ''}</em>
              <input type="range" data-path="${c.path}" min="${c.min}" max="${c.max}" step="${c.step}" value="${v}"></label>`;
          }
          if (c.type === 'select') {
            return `<label class="row"><span>${c.label}</span><select data-path="${c.path}">${c.options
              .map(([val, name]) => `<option value="${val}" ${val === v ? 'selected' : ''}>${name}</option>`)
              .join('')}</select></label>`;
          }
          return `<label class="row"><span>${c.label}</span><input type="checkbox" data-path="${c.path}" ${v ? 'checked' : ''}></label>`;
        })
        .join('');
      return `<section><h3>${sec.title}</h3>${ctl}</section>`;
    }).join('');
    this.show(`<h2>Настройки</h2>
      <div class="presets">
        <button data-act="preset" data-p="beginner">Новичок<br><small>Angle + помощь</small></button>
        <button data-act="preset" data-p="pilot">Пилот<br><small>Horizon</small></button>
        <button data-act="preset" data-p="pro">Про<br><small>Acro</small></button>
      </div>
      ${rows}
      <p class="note">Масса и TWR применяются мгновенно. Настройки сохраняются автоматически.</p>
      <button class="back" data-act="${from === 'pause' ? 'pause' : 'main'}">← Назад</button>`);
  }

  showPause() {
    this.show(`<h2>Пауза</h2>
      <div class="col">
        <button class="big" data-act="resume">▶ Продолжить</button>
        <button class="big alt" data-act="restart">⟲ Начать заново</button>
        <button class="big alt" data-act="settings-pause">⚙ Настройки</button>
        <button class="big alt" data-act="tomenu">⌂ В главное меню</button>
      </div>`);
  }

  showResult(r: MissionResult, def: MissionDef) {
    this.lastDef = def;
    const idx = MISSIONS.findIndex((m) => m.id === def.id);
    const next = r.success && idx >= 0 && MISSIONS[idx + 1] && MISSIONS[idx + 1].category === def.category ? MISSIONS[idx + 1] : null;
    this.show(`<h2 class="${r.success ? 'ok' : 'fail'}">${r.success ? 'ЗАДАНИЕ ВЫПОЛНЕНО' : 'ЗАДАНИЕ ПРОВАЛЕНО'}</h2>
      <p class="sub">${def.title} — ${r.reason}</p>
      <div class="stars">${stars(r.stars)}</div>
      <table class="stats">
        <tr><td>Очки</td><td>${r.score}</td></tr>
        <tr><td>Время</td><td>${fmt(r.time)}</td></tr>
        <tr><td>Поражено целей</td><td>${r.kills}</td></tr>
        <tr><td>Точность сброса</td><td>${r.accuracy}%</td></tr>
        <tr><td>Крашей</td><td>${r.crashes}</td></tr>
      </table>
      <div class="col">
        <button class="big" data-act="retry">⟲ Повторить</button>
        ${next ? `<button class="big" data-act="start" data-id="${next.id}">▶ Далее: ${next.title}</button>` : ''}
        <button class="big alt" data-act="list" data-cat="${def.category}">☰ К списку</button>
        <button class="big alt" data-act="tomenu">⌂ Главное меню</button>
      </div>`);
  }

  private onClick(e: Event) {
    const t = (e.target as HTMLElement).closest('[data-act]') as HTMLElement | null;
    if (!t) return;
    const act = t.dataset.act!;
    switch (act) {
      case 'main':
        return this.showMain();
      case 'list':
        return this.showList((t.dataset.cat as Category) ?? this.cat);
      case 'help':
        return this.showHelp();
      case 'settings':
        return this.showSettings('main');
      case 'settings-pause':
        return this.showSettings('pause');
      case 'pause':
        return this.showPause();
      case 'free':
        return this.cb.start(FREE);
      case 'start': {
        const d = MISSIONS.find((m) => m.id === t.dataset.id);
        if (d) this.cb.start(d);
        return;
      }
      case 'retry':
        if (this.lastDef) this.cb.start(this.lastDef);
        return;
      case 'resume':
        return this.cb.resume();
      case 'restart':
        return this.cb.restart();
      case 'tomenu':
        return this.cb.toMenu();
      case 'preset':
        this.cb.preset(t.dataset.p as 'beginner');
        return this.showSettings(this.from);
    }
  }

  private onInput(e: Event) {
    const el = e.target as HTMLInputElement | HTMLSelectElement;
    const path = el.dataset?.path;
    if (!path) return;
    const s = this.getSettings();
    let v: unknown;
    if (el instanceof HTMLInputElement && el.type === 'checkbox') v = el.checked;
    else if (el instanceof HTMLInputElement && el.type === 'range') v = Number(el.value);
    else v = el.value;
    setPath(s, path, v);
    if (el instanceof HTMLInputElement && el.type === 'range') {
      const c = SECTIONS.flatMap((x) => x.ctls).find((x) => x.path === path);
      const label = this.root.querySelector(`[data-val="${path}"]`);
      if (label && c && c.type === 'range') {
        const sc = c.scale ?? 1;
        label.textContent = `${(Number(v) * sc).toFixed(c.step < 0.1 && sc === 1 ? 2 : c.step < 1 && sc === 1 ? 1 : 0)}${c.unit ?? ''}`;
      }
    }
    this.cb.changed(path);
  }
}
