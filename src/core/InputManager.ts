import type { Settings } from '../config';
import { clamp, damp } from '../utils/MathUtils';
import { EventBus, type InputEvents } from './EventBus';

export interface Controls {
  roll: number; // -1..1 (+ вправо)
  pitch: number; // -1..1 (+ вперёд/нос вниз)
  yaw: number; // -1..1 (+ вправо)
  /** -1..1. В режиме hold: позиция стика газа (-1 — ноль), в assist: пружинящий стик */
  throttleStick: number;
}

/** Объединяет виртуальные стики, клавиатуру и Gamepad API (радиоаппаратура в режиме USB Joystick) */
export class InputManager {
  bus = new EventBus<InputEvents>();

  // Значения виртуальных стиков (пишет VirtualJoysticks)
  touch = { lx: 0, ly: 0, rx: 0, ry: 0, leftActive: false };
  /** Постоянное положение газа 0..1 для режима hold */
  holdThrottle = 0;

  padName = '';
  padActive = false;

  private keys = new Set<string>();
  private kb = { roll: 0, pitch: 0, yaw: 0, thr: 0 };
  private prevButtons: boolean[] = [];
  private prevAux = [false, false];
  private out: Controls = { roll: 0, pitch: 0, yaw: 0, throttleStick: -1 };

  constructor(private getSettings: () => Settings) {
    window.addEventListener('keydown', this.onKeyDown);
    window.addEventListener('keyup', (e) => this.keys.delete(e.code));
    window.addEventListener('blur', () => this.keys.clear());
  }

  private onKeyDown = (e: KeyboardEvent) => {
    const t = e.target as HTMLElement | null;
    if (t && (t.tagName === 'INPUT' || t.tagName === 'SELECT')) return;
    if (['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Space'].includes(e.code)) e.preventDefault();
    this.keys.add(e.code);
    if (e.repeat) return;
    switch (e.code) {
      case 'Space':
      case 'KeyG':
        this.bus.emit('arm', undefined);
        break;
      case 'KeyR':
        this.bus.emit('reset', undefined);
        break;
      case 'KeyF':
      case 'Enter':
        this.bus.emit('drop', undefined);
        break;
      case 'KeyE':
        this.bus.emit('tilt', 1);
        break;
      case 'KeyQ':
        this.bus.emit('tilt', -1);
        break;
      case 'Escape':
      case 'KeyP':
        this.bus.emit('pause', undefined);
        break;
      case 'KeyV':
        this.bus.emit('camera', undefined);
        break;
      case 'KeyM':
        this.bus.emit('mode', undefined);
        break;
    }
  };

  private axis(neg: string[], pos: string[]): number {
    let v = 0;
    for (const k of pos) if (this.keys.has(k)) v += 1;
    for (const k of neg) if (this.keys.has(k)) v -= 1;
    return v;
  }

  private dz(v: number, dz: number, sens: number): number {
    const a = Math.abs(v);
    if (a < dz) return 0;
    return clamp(Math.sign(v) * ((a - dz) / (1 - dz)) * sens, -1, 1);
  }

  resetThrottle() {
    this.holdThrottle = 0;
    this.kb.thr = 0;
  }

  /** Вызывается раз за кадр */
  sample(dt: number): Controls {
    const s = this.getSettings();

    // --- клавиатура с плавным нарастанием (имитация аналоговых стиков) ---
    const kRoll = this.axis(['ArrowLeft'], ['ArrowRight']);
    const kPitch = this.axis(['ArrowDown'], ['ArrowUp']);
    const kYaw = this.axis(['KeyA'], ['KeyD']);
    const kThr = this.axis(['KeyS'], ['KeyW']);
    const slew = (cur: number, target: number) => damp(cur, target, target === 0 ? 14 : 7, dt);
    this.kb.roll = slew(this.kb.roll, kRoll);
    this.kb.pitch = slew(this.kb.pitch, kPitch);
    this.kb.yaw = slew(this.kb.yaw, kYaw);

    // --- геймпад / радио ---
    let gRoll = 0,
      gPitch = 0,
      gYaw = 0,
      gThr = 0;
    let padThrAbs: number | null = null;
    this.padActive = false;
    const pads = navigator.getGamepads ? navigator.getGamepads() : [];
    for (const p of pads) {
      if (!p || !p.connected) continue;
      this.padName = p.id;
      this.padActive = true;
      const a = p.axes;
      const g = (i: number) => a[i] ?? 0;
      if (s.padMap === 'standard') {
        gYaw = g(0);
        gThr = -g(1);
        gRoll = g(2);
        gPitch = -g(3);
      } else if (s.padMap === 'aetr') {
        gRoll = g(0);
        gPitch = -g(1);
        padThrAbs = (g(2) + 1) / 2;
        gYaw = g(3);
      } else {
        padThrAbs = (g(0) + 1) / 2; // TAER
        gRoll = g(1);
        gPitch = -g(2);
        gYaw = g(3);
      }
      // кнопки (edge)
      const b = p.buttons.map((x) => x.pressed);
      const edge = (i: number) => !!b[i] && !this.prevButtons[i];
      if (edge(0)) this.bus.emit('arm', undefined);
      if (edge(1) || edge(5)) this.bus.emit('drop', undefined);
      if (edge(2)) this.bus.emit('reset', undefined);
      if (edge(3)) this.bus.emit('camera', undefined);
      if (edge(9)) this.bus.emit('pause', undefined);
      if (edge(12)) this.bus.emit('tilt', 1);
      if (edge(13)) this.bus.emit('tilt', -1);
      if (edge(4)) this.bus.emit('mode', undefined);
      this.prevButtons = b;
      // тумблеры радио на AUX-каналах
      if (s.padMap !== 'standard') {
        const aux = [g(4) > 0.5, g(5) > 0.5];
        if (aux[0] !== this.prevAux[0]) this.bus.emit('arm', undefined);
        if (aux[1] && !this.prevAux[1]) this.bus.emit('drop', undefined);
        this.prevAux = aux;
      }
      break;
    }

    // --- газ ---
    const hold = s.throttleMode === 'hold';
    let thrStick: number;
    if (hold) {
      if (this.touch.leftActive) this.holdThrottle = (this.touch.ly + 1) / 2;
      else if (padThrAbs !== null) this.holdThrottle = padThrAbs;
      else {
        this.holdThrottle = clamp(this.holdThrottle + (kThr * 0.55 + (Math.abs(gThr) > 0.1 ? gThr * 0.8 : 0)) * dt, 0, 1);
      }
      thrStick = this.holdThrottle * 2 - 1;
    } else {
      this.kb.thr = slew(this.kb.thr, kThr);
      let t = this.kb.thr + this.touch.ly + gThr;
      if (padThrAbs !== null) t += padThrAbs * 2 - 1;
      thrStick = clamp(t, -1, 1);
      this.holdThrottle = (thrStick + 1) / 2; // для отображения
    }

    const dzv = s.deadzone;
    const sens = s.stickSens;
    this.out.roll = this.dz(this.kb.roll + this.touch.rx + gRoll, dzv, sens);
    this.out.pitch = this.dz(this.kb.pitch + this.touch.ry + gPitch, dzv, sens);
    this.out.yaw = this.dz(this.kb.yaw + this.touch.lx + gYaw, dzv, sens);
    this.out.throttleStick = thrStick;
    return this.out;
  }
}
