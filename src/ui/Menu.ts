import { TITLE, VERSION } from '../config';
import { FREE_FLIGHT, MISSIONS, TRAININGS } from '../missions/MissionData';
import type { MissionDef, Settings } from '../types';
import { clearRecords, DEFAULT_SETTINGS, loadRecords } from '../utils/Storage';
import { formatTime } from '../utils/MathUtils';

export interface MenuHandlers {
  startMode(def: MissionDef): void;
  resume(): void;
  restart(): void;
  exitToMenu(): void;
  settingsChanged(s: Settings): void;
  restoreTargets(): void;
}

type Screen = 'main' | 'missions' | 'training' | 'settings' | 'pause' | 'results' | 'help';

/**
 * Все меню приложения на DOM. Один корень #menu-root,
 * экраны перерисовываются innerHTML, обработчики вешаются заново.
 */
export class Menu {
  private root = document.getElementById('menu-root') as HTMLElement;
  private settings: Settings;
  private handlers: MenuHandlers;
  private screen: Screen = 'main';
  private lastResult: { win: boolean; stars: number; score: number; timeUsed: number; def: MissionDef } | null = null;

  constructor(settings: Settings, handlers: MenuHandlers) {
    this.settings = settings;
    this.handlers = handlers;
  }

  isMainVisible(): boolean {
    return this.screen === 'main' || this.screen === 'missions' || this.screen === 'training' || this.screen === 'settings' || this.screen === 'help' || this.screen === 'results';
  }

  showMain(): void {
    this.screen = 'main';
    const records = loadRecords();
    const totalStars = Object.values(records).reduce((a, r) => a + r.stars, 0);
    const totalMax = MISSIONS.length + TRAININGS.length;
    this.root.innerHTML = '';
    const wrap = this.overlay();
    const panel = this.panel(`
      <div class="menu-title">${TITLE}</div>
      <div class="menu-subtitle">Симулятор учебно-боевого FPV-дрона · v${VERSION}</div>
      <div class="menu-col">
        <button class="menu-btn primary" data-act="missions">MISSIONS · МИССИИ</button>
        <button class="menu-btn" data-act="training">TRAINING · ТРЕНИРОВКИ</button>
        <button class="menu-btn" data-act="free">FREE FLIGHT · СВОБОДНЫЙ ПОЛЁТ</button>
        <button class="menu-btn" data-act="settings">НАСТРОЙКИ</button>
        <button class="menu-btn" data-act="help">УПРАВЛЕНИЕ / ПОМОЩЬ</button>
      </div>
      <div class="menu-subtitle" style="margin-top:14px">★ ${totalStars} / ${totalMax * 3}</div>
    `);
    wrap.appendChild(panel);
    this.root.appendChild(wrap);
    panel.querySelector('[data-act="missions"]')!.addEventListener('click', () => { this.click(); this.showMissions(); });
    panel.querySelector('[data-act="training"]')!.addEventListener('click', () => { this.click(); this.showTraining(); });
    panel.querySelector('[data-act="free"]')!.addEventListener('click', () => { this.click(); this.handlers.startMode(FREE_FLIGHT); });
    panel.querySelector('[data-act="settings"]')!.addEventListener('click', () => { this.click(); this.showSettings('main'); });
    panel.querySelector('[data-act="help"]')!.addEventListener('click', () => { this.click(); this.showHelp(); });
  }

  private cardList(defs: MissionDef[], back: () => void, heading: string): void {
    const records = loadRecords();
    this.root.innerHTML = '';
    const wrap = this.overlay();
    const cards = defs.map((def) => {
      const r = records[def.id];
      const stars = r ? '★'.repeat(r.stars) + '☆'.repeat(3 - r.stars) : '☆☆☆';
      const best = r
        ? (r.bestTime > 0 ? `⏱ ${formatTime(r.bestTime)}<br/>` : '') + `${r.bestScore} очк.`
        : '—';
      return `
        <div class="mission-card" data-id="${def.id}">
          <div class="mc-icon">${def.icon}</div>
          <div class="mc-body">
            <div class="mc-title">${def.title}</div>
            <div class="mc-desc">${def.desc}${def.timeLimit > 0 ? ` · ${formatTime(def.timeLimit)}` : ''}</div>
          </div>
          <div>
            <div class="mc-stars">${stars}</div>
            <div class="mc-best">${best}</div>
          </div>
        </div>`;
    }).join('');
    const panel = this.panel(`
      <div class="menu-h2">${heading}</div>
      <div class="menu-cards">${cards}</div>
      <div class="menu-col"><button class="menu-btn ghost" data-act="back">← НАЗАД</button></div>
    `);
    wrap.appendChild(panel);
    this.root.appendChild(wrap);
    for (const el of Array.from(panel.querySelectorAll('.mission-card'))) {
      el.addEventListener('click', () => {
        const id = (el as HTMLElement).dataset.id;
        const def = defs.find((d) => d.id === id);
        if (def) {
          this.click();
          this.handlers.startMode(def);
        }
      });
    }
    panel.querySelector('[data-act="back"]')!.addEventListener('click', () => { this.click(); back(); });
  }

  showMissions(): void {
    this.screen = 'missions';
    this.cardList(MISSIONS, () => this.showMain(), 'MISSIONS · МИССИИ');
  }

  showTraining(): void {
    this.screen = 'training';
    this.cardList(TRAININGS, () => this.showMain(), 'TRAINING · ТРЕНИРОВКИ');
  }

  showPause(): void {
    this.screen = 'pause';
    this.root.innerHTML = '';
    const wrap = this.overlay();
    const panel = this.panel(`
      <div class="menu-h2" style="text-align:center">ПАУЗА</div>
      <div class="menu-col">
        <button class="menu-btn primary" data-act="resume">ПРОДОЛЖИТЬ</button>
        <button class="menu-btn" data-act="restart">ЗАНОВО</button>
        <button class="menu-btn" data-act="restore">ВОССТАНОВИТЬ МИШЕНИ</button>
        <button class="menu-btn" data-act="settings">НАСТРОЙКИ</button>
        <button class="menu-btn ghost" data-act="exit">ВЫХОД В МЕНЮ</button>
      </div>
    `);
    wrap.appendChild(panel);
    this.root.appendChild(wrap);
    panel.querySelector('[data-act="resume"]')!.addEventListener('click', () => { this.click(); this.handlers.resume(); });
    panel.querySelector('[data-act="restart"]')!.addEventListener('click', () => { this.click(); this.handlers.restart(); });
    panel.querySelector('[data-act="restore"]')!.addEventListener('click', () => { this.click(); this.handlers.restoreTargets(); this.handlers.resume(); });
    panel.querySelector('[data-act="settings"]')!.addEventListener('click', () => { this.click(); this.showSettings('pause'); });
    panel.querySelector('[data-act="exit"]')!.addEventListener('click', () => { this.click(); this.handlers.exitToMenu(); });
  }

  showResults(result: { win: boolean; stars: number; score: number; timeUsed: number; def: MissionDef }, hasNext: boolean): void {
    this.screen = 'results';
    this.lastResult = result;
    const starsHtml = result.win
      ? `<span class="on">${'★'.repeat(result.stars)}</span><span class="off">${'☆'.repeat(3 - result.stars)}</span>`
      : `<span class="off">☆☆☆</span>`;
    const records = loadRecords();
    const rec = records[result.def.id];
    this.root.innerHTML = '';
    const wrap = this.overlay();
    const panel = this.panel(`
      <div class="results-title ${result.win ? 'win' : 'fail'}">${result.win ? 'МИССИЯ ВЫПОЛНЕНА' : 'ПРОВАЛ'}</div>
      <div class="results-stars">${starsHtml}</div>
      <div class="results-grid">
        <div class="results-cell"><div class="rc-val">${result.score}</div><div class="rc-lbl">ОЧКИ</div></div>
        <div class="results-cell"><div class="rc-val">${formatTime(result.timeUsed)}</div><div class="rc-lbl">ВРЕМЯ</div></div>
        <div class="results-cell"><div class="rc-val">${rec ? rec.bestScore : '—'}</div><div class="rc-lbl">РЕКОРД</div></div>
      </div>
      <div class="menu-subtitle">${result.def.title}</div>
      <div class="menu-col menu-row">
        <button class="menu-btn primary" data-act="retry">ЕЩЁ РАЗ</button>
        ${hasNext ? '<button class="menu-btn" data-act="next">ДАЛЕЕ →</button>' : ''}
      </div>
      <div class="menu-col"><button class="menu-btn ghost" data-act="menu">В МЕНЮ</button></div>
    `);
    wrap.appendChild(panel);
    this.root.appendChild(wrap);
    panel.querySelector('[data-act="retry"]')!.addEventListener('click', () => { this.click(); this.handlers.startMode(result.def); });
    const nextBtn = panel.querySelector('[data-act="next"]');
    if (nextBtn) {
      nextBtn.addEventListener('click', () => {
        this.click();
        const all = [...MISSIONS, ...TRAININGS];
        const i = all.findIndex((d) => d.id === result.def.id);
        this.handlers.startMode(all[(i + 1) % all.length]);
      });
    }
    panel.querySelector('[data-act="menu"]')!.addEventListener('click', () => { this.click(); this.showMain(); });
  }

  showSettings(back: 'main' | 'pause'): void {
    const prevScreen = this.screen;
    this.screen = 'settings';
    const s = this.settings;
    this.root.innerHTML = '';
    const wrap = this.overlay();

    const slider = (id: string, label: string, sub: string, min: number, max: number, step: number, val: number, fmt: (v: number) => string) => `
      <div class="setting-row">
        <div class="setting-label">${label}<small>${sub}</small></div>
        <input type="range" id="set-${id}" min="${min}" max="${max}" step="${step}" value="${val}" />
        <div class="setting-value" id="val-${id}">${fmt(val)}</div>
      </div>`;

    const panel = this.panel(`
      <div class="menu-h2">НАСТРОЙКИ</div>
      <div class="settings-list">
        <div class="setting-row">
          <div class="setting-label">Качество<small>адаптивное по умолчанию</small></div>
          <select id="set-quality">
            <option value="auto" ${s.quality === 'auto' ? 'selected' : ''}>Авто</option>
            <option value="low" ${s.quality === 'low' ? 'selected' : ''}>Низкое</option>
            <option value="medium" ${s.quality === 'medium' ? 'selected' : ''}>Среднее</option>
            <option value="high" ${s.quality === 'high' ? 'selected' : ''}>Высокое</option>
          </select>
        </div>
        <div class="setting-row">
          <div class="setting-label">Освещение<small>день / сумерки</small></div>
          <select id="set-lighting">
            <option value="day" ${s.lighting === 'day' ? 'selected' : ''}>День</option>
            <option value="dusk" ${s.lighting === 'dusk' ? 'selected' : ''}>Сумерки</option>
          </select>
        </div>
        <div class="setting-row">
          <div class="setting-label">Стиль OSD<small>Betaflight-аналог / цифра</small></div>
          <select id="set-osd">
            <option value="analog" ${s.osdStyle === 'analog' ? 'selected' : ''}>Аналог</option>
            <option value="digital" ${s.osdStyle === 'digital' ? 'selected' : ''}>Цифровой</option>
          </select>
        </div>
        ${slider('rcRate', 'RC Rate', 'отклик стиков', 0.6, 1.6, 0.05, s.rcRate, (v) => v.toFixed(2))}
        ${slider('superRate', 'Super Rate', 'скорость на краях', 0.3, 0.95, 0.05, s.superRate, (v) => v.toFixed(2))}
        ${slider('expo', 'Expo', 'сглаживание центра', 0, 0.6, 0.05, s.expo, (v) => v.toFixed(2))}
        ${slider('stickSens', 'Чувствительность стиков', '', 0.5, 1.5, 0.05, s.stickSens, (v) => v.toFixed(2))}
        ${slider('maxThrottle', 'Макс. газ', '%', 60, 120, 5, s.maxThrottle, (v) => `${v}%`)}
        ${slider('camTilt', 'Наклон камеры', 'град вверх', 0, 45, 5, s.camTilt, (v) => `${v}°`)}
        ${slider('fov', 'FOV', 'угол обзора', 80, 130, 5, s.fov, (v) => `${v}°`)}
        ${slider('twr', 'Тяговооружённость', 'TWR', 1.5, 4, 0.1, s.twr, (v) => v.toFixed(1))}
        ${slider('massKg', 'Масса дрона', 'кг', 0.4, 1.2, 0.02, s.massKg, (v) => `${v.toFixed(2)} кг`)}
        ${slider('volume', 'Громкость', '', 0, 1, 0.05, s.volume, (v) => `${Math.round(v * 100)}%`)}
        ${slider('shake', 'Тряска камеры', '', 0, 1, 0.05, s.shake, (v) => v.toFixed(2))}
        ${slider('stickScale', 'Размер стиков', '', 0.7, 1.4, 0.05, s.stickScale, (v) => v.toFixed(2))}
        <div class="setting-row">
          <div class="setting-label">Показывать FPS</div>
          <input type="checkbox" id="set-showFps" ${s.showFps ? 'checked' : ''} />
        </div>
      </div>
      <div class="menu-col menu-row">
        <button class="menu-btn ghost" data-act="reset-records">СБРОС РЕКОРДОВ</button>
        <button class="menu-btn ghost" data-act="reset-default">СБРОС НАСТРОЕК</button>
      </div>
      <div class="menu-col"><button class="menu-btn primary" data-act="back">← НАЗАД</button></div>
    `);
    wrap.appendChild(panel);
    this.root.appendChild(wrap);

    const emit = () => this.handlers.settingsChanged({ ...this.settings });

    const bindSlider = (id: string, key: keyof Settings, fmt: (v: number) => string) => {
      const input = panel.querySelector(`#set-${id}`) as HTMLInputElement;
      const val = panel.querySelector(`#val-${id}`) as HTMLElement;
      input.addEventListener('input', () => {
        const v = parseFloat(input.value);
        (this.settings as unknown as Record<string, unknown>)[key] = v;
        val.textContent = fmt(v);
        emit();
      });
    };

    bindSlider('rcRate', 'rcRate', (v) => v.toFixed(2));
    bindSlider('superRate', 'superRate', (v) => v.toFixed(2));
    bindSlider('expo', 'expo', (v) => v.toFixed(2));
    bindSlider('stickSens', 'stickSens', (v) => v.toFixed(2));
    bindSlider('maxThrottle', 'maxThrottle', (v) => `${v}%`);
    bindSlider('camTilt', 'camTilt', (v) => `${v}°`);
    bindSlider('fov', 'fov', (v) => `${v}°`);
    bindSlider('twr', 'twr', (v) => v.toFixed(1));
    bindSlider('massKg', 'massKg', (v) => `${v.toFixed(2)} кг`);
    bindSlider('volume', 'volume', (v) => `${Math.round(v * 100)}%`);
    bindSlider('shake', 'shake', (v) => v.toFixed(2));
    bindSlider('stickScale', 'stickScale', (v) => v.toFixed(2));

    (panel.querySelector('#set-quality') as HTMLSelectElement).addEventListener('change', (e) => {
      this.settings.quality = (e.target as HTMLSelectElement).value as Settings['quality'];
      emit();
    });
    (panel.querySelector('#set-lighting') as HTMLSelectElement).addEventListener('change', (e) => {
      this.settings.lighting = (e.target as HTMLSelectElement).value as Settings['lighting'];
      emit();
    });
    (panel.querySelector('#set-osd') as HTMLSelectElement).addEventListener('change', (e) => {
      this.settings.osdStyle = (e.target as HTMLSelectElement).value as Settings['osdStyle'];
      emit();
    });
    (panel.querySelector('#set-showFps') as HTMLInputElement).addEventListener('change', (e) => {
      this.settings.showFps = (e.target as HTMLInputElement).checked;
      emit();
    });

    panel.querySelector('[data-act="reset-records"]')!.addEventListener('click', () => {
      this.click();
      clearRecords();
      this.showSettings(back);
    });
    panel.querySelector('[data-act="reset-default"]')!.addEventListener('click', () => {
      this.click();
      Object.assign(this.settings, DEFAULT_SETTINGS);
      emit();
      this.showSettings(back);
    });
    panel.querySelector('[data-act="back"]')!.addEventListener('click', () => {
      this.click();
      if (back === 'main') this.showMain();
      else this.showPause();
    });
    void prevScreen;
  }

  showHelp(): void {
    this.screen = 'help';
    this.root.innerHTML = '';
    const wrap = this.overlay();
    const panel = this.panel(`
      <div class="menu-h2">УПРАВЛЕНИЕ</div>
      <table class="help-table">
        <tr><td>Левый стик</td><td>вверх/вниз — газ (не пружинит), влево/вправо — рыскание</td></tr>
        <tr><td>Правый стик</td><td>тангаж (вперёд/назад) + крен (влево/вправо)</td></tr>
        <tr><td>ARM</td><td>включение моторов (обязательно перед полётом)</td></tr>
        <tr><td>DROP</td><td>сброс условного учебного груза</td></tr>
        <tr><td>T+/T−</td><td>наклон FPV-камеры</td></tr>
        <tr><td>RST</td><td>ресет дрона на старт</td></tr>
        <tr><td>Клавиатура</td><td>W/S — газ, A/D — рыскание, стрелки — тангаж/крен, ЛКМ — тангаж/крен мышью</td></tr>
        <tr><td>Клавиши</td><td>Space — ARM, F — сброс, R — ресет, Q/E — камера, P/Esc — пауза</td></tr>
        <tr><td>Геймпад</td><td>Mode 2: левый стик газ/рыскание, правый тангаж/крен, A — ARM, B — сброс, X — ресет, Start — пауза</td></tr>
      </table>
      <div class="help-note">
        Совет: в режиме ACRO дрон не самовыравнивается — держи газ ~55% для висения и двигай
        стики короткими импульсами. Для новичков есть режим ANGLE (авто-стабилизация) —
        переключение клавишей M на клавиатуре. Все параметры физики (rates, TWR, масса)
        настраиваются в разделе «Настройки».
      </div>
      <div class="menu-col"><button class="menu-btn primary" data-act="back">← НАЗАД</button></div>
    `);
    wrap.appendChild(panel);
    this.root.appendChild(wrap);
    panel.querySelector('[data-act="back"]')!.addEventListener('click', () => { this.click(); this.showMain(); });
  }

  hide(): void {
    this.root.innerHTML = '';
    this.screen = 'main';
  }

  hideIfModal(): boolean {
    return false;
  }

  private overlay(): HTMLElement {
    const el = document.createElement('div');
    el.className = 'menu-overlay';
    return el;
  }

  private panel(html: string): HTMLElement {
    const el = document.createElement('div');
    el.className = 'menu-panel';
    el.innerHTML = html;
    return el;
  }

  private click(): void {
    // щелчок через AudioBus сделает Game; здесь — только тактильный отклик
    if (navigator.vibrate) navigator.vibrate(8);
  }

  get currentScreen(): Screen {
    return this.screen;
  }

  get result(): typeof this.lastResult {
    return this.lastResult;
  }
}
