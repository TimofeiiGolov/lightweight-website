import type { Settings } from '../config';
import type { InputManager } from '../core/InputManager';
import { clamp } from '../utils/MathUtils';

/** Один виртуальный стик с поддержкой multitouch (отслеживание pointerId) */
class Stick {
  zone = document.createElement('div');
  base = document.createElement('div');
  knob = document.createElement('div');
  x = 0;
  y = 0;
  pid: number | null = null;
  R = 60;

  constructor(
    parent: HTMLElement,
    cls: string,
    private onMove: (x: number, y: number, active: boolean) => void,
  ) {
    this.zone.className = `stick-zone ${cls}`;
    this.base.className = 'stick-base';
    this.knob.className = 'stick-knob';
    this.base.innerHTML = '<i></i><b></b>';
    this.base.appendChild(this.knob);
    this.zone.appendChild(this.base);
    parent.appendChild(this.zone);

    const z = this.zone;
    z.addEventListener('pointerdown', (e) => {
      if (this.pid !== null) return;
      this.pid = e.pointerId;
      z.setPointerCapture(e.pointerId);
      this.base.classList.add('active');
      this.update(e);
      e.preventDefault();
    });
    z.addEventListener('pointermove', (e) => {
      if (e.pointerId === this.pid) this.update(e);
    });
    const end = (e: PointerEvent) => {
      if (e.pointerId !== this.pid) return;
      this.pid = null;
      this.base.classList.remove('active');
      this.onMove(this.x, this.y, false);
    };
    z.addEventListener('pointerup', end);
    z.addEventListener('pointercancel', end);
    z.addEventListener('lostpointercapture', end);
  }

  private update(e: PointerEvent) {
    const r = this.base.getBoundingClientRect();
    const cx = r.left + r.width / 2;
    const cy = r.top + r.height / 2;
    this.R = r.width / 2;
    let dx = (e.clientX - cx) / this.R;
    let dy = (e.clientY - cy) / this.R;
    const m = Math.hypot(dx, dy);
    if (m > 1) {
      dx /= m;
      dy /= m;
    }
    this.x = dx;
    this.y = -dy;
    this.onMove(this.x, this.y, true);
  }

  /** Установка положения программно (пружина / удержание газа) */
  setPos(x: number, y: number) {
    this.x = x;
    this.y = y;
  }

  draw() {
    const k = this.R * 0.72;
    this.knob.style.transform = `translate(${this.x * k}px, ${-this.y * k}px)`;
  }
}

export class VirtualJoysticks {
  root = document.createElement('div');
  left: Stick;
  right: Stick;

  constructor(
    parent: HTMLElement,
    private input: InputManager,
    private getSettings: () => Settings,
  ) {
    this.root.className = 'sticks';
    parent.appendChild(this.root);
    this.left = new Stick(this.root, 'left', (x, y, active) => {
      input.touch.lx = x;
      input.touch.leftActive = active;
      if (getSettings().throttleMode === 'assist' || active) input.touch.ly = active ? y : 0;
      if (!active) input.touch.lx = 0;
    });
    this.right = new Stick(this.root, 'right', (x, y, active) => {
      input.touch.rx = active ? x : 0;
      input.touch.ry = active ? y : 0;
    });
    this.layout();
    window.addEventListener('resize', () => this.layout());
  }

  isTouchDevice() {
    return 'ontouchstart' in window || navigator.maxTouchPoints > 0;
  }

  layout() {
    const s = this.getSettings();
    const show = s.touchUi === 'on' || (s.touchUi === 'auto' && this.isTouchDevice());
    this.root.style.display = show ? 'block' : 'none';
    document.documentElement.dataset.touch = show ? '1' : '0';
    const size = clamp(Math.min(window.innerWidth, window.innerHeight) * 0.34 * s.stickSize, 90, 240);
    document.documentElement.style.setProperty('--stick', `${size}px`);
    document.documentElement.style.setProperty('--stick-margin', `${s.stickMargin}px`);
    document.documentElement.style.setProperty('--stick-bottom', `${s.stickBottom}px`);
  }

  /** Вызывается каждый кадр: отрисовка и «пружина» */
  update() {
    const s = this.getSettings();
    const l = this.left;
    if (l.pid === null) {
      if (s.throttleMode === 'hold') l.setPos(0, this.input.holdThrottle * 2 - 1);
      else l.setPos(0, 0);
    }
    if (this.right.pid === null) this.right.setPos(0, 0);
    this.left.draw();
    this.right.draw();
  }
}
