import { clamp } from '../utils/MathUtils';

export interface StickValues {
  x: number; // -1..1
  y: number; // -1..1 (вверх +)
}

interface StickState {
  zone: HTMLElement;
  base: HTMLElement;
  knob: HTMLElement;
  pointerId: number | null;
  cx: number;
  cy: number;
  R: number;
  values: StickValues;
  sticky: boolean; // throttle: не пружинит к центру
}

/**
 * Два виртуальных стика (Mode 2): левый = газ (вертикаль, без пружины) +
 * рыскание, правый = тангаж + крен. Мультитач через Pointer Events,
 * зона захвата больше видимого стика, визуальная подсветка.
 */
export class VirtualJoysticks {
  left: StickState;
  right: StickState;
  scale = 1.0;
  sens = 1.0;

  constructor() {
    this.left = this.makeStick('stick-zone-left', 'Газ / Рыскание', true);
    this.right = this.makeStick('stick-zone-right', 'Тангаж / Крен', false);
  }

  private makeStick(zoneId: string, hint: string, sticky: boolean): StickState {
    const zone = document.getElementById(zoneId) as HTMLElement;
    const base = document.createElement('div');
    base.className = 'stick-base';
    const knob = document.createElement('div');
    knob.className = 'stick-knob';
    base.appendChild(knob);
    if (hint) {
      const h = document.createElement('div');
      h.className = 'stick-hint';
      h.textContent = hint;
      base.appendChild(h);
    }
    zone.appendChild(base);

    const st: StickState = {
      zone, base, knob,
      pointerId: null,
      cx: 0, cy: 0, R: 60,
      values: { x: 0, y: 0 },
      sticky,
    };

    zone.addEventListener('pointerdown', (e) => {
      if (st.pointerId !== null) return;
      st.pointerId = e.pointerId;
      zone.setPointerCapture(e.pointerId);
      zone.classList.add('active');
      this.recenter(st);
      this.move(st, e.clientX, e.clientY);
      e.preventDefault();
    });
    zone.addEventListener('pointermove', (e) => {
      if (st.pointerId !== e.pointerId) return;
      this.move(st, e.clientX, e.clientY);
    });
    const release = (e: PointerEvent) => {
      if (st.pointerId !== e.pointerId) return;
      st.pointerId = null;
      zone.classList.remove('active');
      if (!st.sticky) {
        st.values.x = 0;
        st.values.y = 0;
      }
      this.render(st);
    };
    zone.addEventListener('pointerup', release);
    zone.addEventListener('pointercancel', release);
    return st;
  }

  private recenter(st: StickState): void {
    const rect = st.base.getBoundingClientRect();
    st.cx = rect.left + rect.width / 2;
    st.cy = rect.top + rect.height / 2;
    st.R = rect.width * 0.4;
  }

  private move(st: StickState, px: number, py: number): void {
    let dx = (px - st.cx) / st.R;
    let dy = -(py - st.cy) / st.R; // вверх = +
    dx = clamp(dx, -1, 1) * this.sens;
    dy = clamp(dy, -1, 1) * this.sens;
    // мёртвая зона в центре
    const dead = 0.06;
    const mag = Math.hypot(dx, dy);
    if (mag < dead) {
      dx = 0;
      dy = 0;
    } else {
      const k = (mag - dead) / (1 - dead) / mag;
      dx *= k;
      dy *= k;
    }
    st.values.x = clamp(dx, -1, 1);
    st.values.y = clamp(dy, -1, 1);
    this.render(st);
  }

  private render(st: StickState): void {
    const kx = st.values.x * st.R / this.sens;
    const ky = -st.values.y * st.R / this.sens;
    st.knob.style.transform = `translate(calc(-50% + ${kx.toFixed(1)}px), calc(-50% + ${ky.toFixed(1)}px))`;
  }

  applyScale(): void {
    document.documentElement.style.setProperty('--stick-scale', String(this.scale));
  }

  /** Вызывается после ресайза */
  refreshCenters(): void {
    this.recenter(this.left);
    this.recenter(this.right);
  }
}
