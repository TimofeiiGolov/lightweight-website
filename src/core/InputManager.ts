import type { FlightInput } from '../types';
import { VirtualJoysticks } from '../ui/VirtualJoysticks';
import { clamp } from '../utils/MathUtils';

export interface InputEvents {
  onArmToggle: () => void;
  onReset: () => void;
  onDrop: () => void;
  onTilt: (delta: number) => void;
  onPause: () => void;
}

/**
 * Агрегатор ввода: виртуальные стики + клавиатура + мышь + Gamepad API.
 * Итоговая команда — сумма источников с ограничением.
 */
export class InputManager {
  sticks: VirtualJoysticks;
  /** дрожание сигнала (SIGNAL LOST) */
  jitter = 0;

  private keys = new Set<string>();
  private keyThrottle = 0;
  private mouseSteer = false;
  private mouseVX = 0;
  private mouseVY = 0;
  private gamepadPrev = new Set<number>();
  private events: InputEvents;
  private tiltHoldTimer: ReturnType<typeof setInterval> | null = null;

  constructor(events: InputEvents) {
    this.events = events;
    this.sticks = new VirtualJoysticks();
    this.bindKeyboard();
    this.bindMouse();
  }

  private bindKeyboard(): void {
    window.addEventListener('keydown', (e) => {
      if (e.repeat) return;
      this.keys.add(e.code);
      switch (e.code) {
        case 'Space':
          this.events.onArmToggle();
          e.preventDefault();
          break;
        case 'KeyR':
          this.events.onReset();
          break;
        case 'KeyF':
          this.events.onDrop();
          break;
        case 'KeyQ':
          this.events.onTilt(-5);
          break;
        case 'KeyE':
          this.events.onTilt(5);
          break;
        case 'KeyP':
        case 'Escape':
          this.events.onPause();
          break;
      }
    });
    window.addEventListener('keyup', (e) => this.keys.delete(e.code));
    window.addEventListener('blur', () => this.keys.clear());
  }

  private bindMouse(): void {
    const canvas = document.getElementById('app');
    if (!canvas) return;
    canvas.addEventListener('contextmenu', (e) => e.preventDefault());
    canvas.addEventListener('pointerdown', (e) => {
      if (e.pointerType === 'mouse' && e.button === 0) {
        this.mouseSteer = true;
      }
    });
    window.addEventListener('pointerup', (e) => {
      if (e.pointerType === 'mouse') {
        this.mouseSteer = false;
        this.mouseVX = 0;
        this.mouseVY = 0;
      }
    });
    window.addEventListener('mousemove', (e) => {
      if (!this.mouseSteer) return;
      this.mouseVX = clamp(this.mouseVX + e.movementX * 0.012, -1, 1);
      this.mouseVY = clamp(this.mouseVY - e.movementY * 0.012, -1, 1);
    });
  }

  /** Удержание кнопок наклона камеры (HUD) */
  bindHoldButton(btn: HTMLElement, delta: number): void {
    const start = (e: Event) => {
      e.preventDefault();
      this.events.onTilt(delta);
      this.tiltHoldTimer = setInterval(() => this.events.onTilt(delta), 180);
    };
    const stop = () => {
      if (this.tiltHoldTimer) {
        clearInterval(this.tiltHoldTimer);
        this.tiltHoldTimer = null;
      }
    };
    btn.addEventListener('pointerdown', start);
    btn.addEventListener('pointerup', stop);
    btn.addEventListener('pointercancel', stop);
    btn.addEventListener('pointerleave', stop);
  }

  update(dt: number): void {
    // клавиатура: газ — виртуальный ползунок
    const rate = 0.9 * dt;
    if (this.keys.has('KeyW')) this.keyThrottle = clamp(this.keyThrottle + rate, 0, 1);
    if (this.keys.has('KeyS')) this.keyThrottle = clamp(this.keyThrottle - rate, 0, 1);
  }

  /** Опрос геймпада + события кнопок */
  pollGamepad(): void {
    const pads = navigator.getGamepads?.() ?? [];
    let padIdx = 0;
    for (const pad of pads) {
      if (!pad) continue;
      const dz = (v: number) => (Math.abs(v) < 0.08 ? 0 : v);
      // Mode 2: левый стик — газ/рыскание, правый — тангаж/крен
      this.padThrottle = pad.axes[1] !== undefined ? clamp(-pad.axes[1], 0, 1) : 0;
      this.padYaw = dz(pad.axes[0] ?? 0);
      this.padPitch = dz(pad.axes[3] ?? 0);
      this.padRoll = dz(pad.axes[2] ?? 0);

      const justPressed = (idx: number): boolean => {
        const pressed = pad.buttons[idx]?.pressed ?? false;
        const key = padIdx * 32 + idx;
        const was = this.gamepadPrev.has(key);
        if (pressed) this.gamepadPrev.add(key);
        else this.gamepadPrev.delete(key);
        return pressed && !was;
      };
      if (justPressed(0)) this.events.onArmToggle();     // A
      if (justPressed(1)) this.events.onDrop();          // B
      if (justPressed(2)) this.events.onReset();         // X
      if (justPressed(3)) this.events.onTilt(5);         // Y
      if (justPressed(4)) this.events.onTilt(-5);        // LB
      if (justPressed(9)) this.events.onPause();         // Start
      padIdx++;
    }
  }

  private padThrottle = 0;
  private padYaw = 0;
  private padPitch = 0;
  private padRoll = 0;

  /** Итоговая команда для модели полёта */
  getCommand(sens: number): FlightInput {
    const j = () => (Math.random() - 0.5) * this.jitter;
    const merge = (a: number, b: number, c = 0) =>
      clamp(a + b + c + j(), -1, 1);

    const L = this.sticks.left.values;
    const R = this.sticks.right.values;

    const throttle = clamp(
      Math.max(L.y > 0 ? L.y : 0, this.keyThrottle, this.padThrottle) * sens,
      0, 1
    );

    return {
      throttle,
      yaw: merge(L.x, this.padYaw),
      pitch: merge(-R.y * sens, this.padPitch, this.mouseVY * sens),
      roll: merge(R.x * sens, this.padRoll, this.mouseVX * sens),
    };
  }

  resetThrottle(): void {
    this.keyThrottle = 0;
  }

  resetSticks(): void {
    this.sticks.left.values.x = 0;
    this.sticks.left.values.y = 0;
    this.sticks.right.values.x = 0;
    this.sticks.right.values.y = 0;
    this.mouseVX = 0;
    this.mouseVY = 0;
    this.padThrottle = 0;
    this.padYaw = 0;
    this.padPitch = 0;
    this.padRoll = 0;
  }
}
