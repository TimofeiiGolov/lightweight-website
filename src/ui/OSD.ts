import type { OSDStyle } from '../types';
import { clamp, formatTime } from '../utils/MathUtils';

export interface OSDState {
  armed: boolean;
  mode: 'ACRO' | 'ANGLE';
  throttle: number;      // 0..1
  vbat: number;
  speedKmh: number;
  altM: number;
  rssi: number;
  clock: number;         // полётное время, сек
  missionTime: number;   // сек (лимит) или -1
  score: number;
  targetsLeft: number;   // -1 если не показывать
  objective: string;
  payloadReady: boolean;
  payloadSec: number;
  crash: boolean;
  signalLost: boolean;
  lowBattery: boolean;
  hitMarkerT: number;    // сек до скрытия маркера
  style: OSDStyle;
  showFps: boolean;
  fps: number;
  message: string;       // крупное сообщение по центру
  messageT: number;
  popups: Array<{ text: string; t: number }>;
}

/**
 * Канвас-OSD в стиле Betaflight/DJI: телеметрия, горизонт,
 * прицел, маркеры попаданий, всплывающие очки, предупреждения.
 * Перерисовка ~30 Гц для экономии CPU.
 */
export class OSD {
  private canvas: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D;
  private w = 0;
  private h = 0;
  private dpr = 1;
  private acc = 0;
  private lastNoise = 0;

  constructor() {
    this.canvas = document.getElementById('osd') as HTMLCanvasElement;
    const ctx = this.canvas.getContext('2d');
    if (!ctx) throw new Error('OSD: 2d context недоступен');
    this.ctx = ctx;
    this.resize();
    window.addEventListener('resize', () => this.resize());
  }

  resize(): void {
    this.dpr = Math.min(window.devicePixelRatio || 1, 2);
    this.w = window.innerWidth;
    this.h = window.innerHeight;
    this.canvas.width = Math.round(this.w * this.dpr);
    this.canvas.height = Math.round(this.h * this.dpr);
  }

  update(dt: number, s: OSDState): void {
    this.lastNoise = s.signalLost ? 1 : clamp((35 - s.rssi) / 35, 0, 0.85);
    this.acc += dt;
    if (this.acc < 1 / 30) return;
    this.acc = 0;
    this.draw(s);
  }

  get noiseLevel(): number {
    return this.lastNoise;
  }

  private draw(s: OSDState): void {
    const ctx = this.ctx;
    ctx.save();
    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    ctx.clearRect(0, 0, this.w, this.h);

    const color = s.style === 'analog' ? '#d6ffd9' : '#9ef7ee';
    const warn = '#ffb347';
    const danger = '#ff5a4d';
    ctx.font = 'bold 14px "Courier New", monospace';
    ctx.textBaseline = 'middle';
    ctx.lineJoin = 'round';

    const text = (str: string, x: number, y: number, align: CanvasTextAlign = 'left', col: string = color, size = 14) => {
      ctx.font = `bold ${size}px "Courier New", monospace`;
      ctx.textAlign = align;
      ctx.strokeStyle = 'rgba(0,0,0,0.9)';
      ctx.lineWidth = 3;
      ctx.strokeText(str, x, y);
      ctx.fillStyle = col;
      ctx.fillText(str, x, y);
    };

    const mx = this.w / 2;
    const my = this.h / 2;
    const pad = 18;

    // --- прицел ---
    ctx.strokeStyle = color;
    ctx.globalAlpha = 0.85;
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(mx - 16, my);
    ctx.lineTo(mx - 5, my);
    ctx.moveTo(mx + 5, my);
    ctx.lineTo(mx + 16, my);
    ctx.moveTo(mx, my - 12);
    ctx.lineTo(mx, my - 4);
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(mx, my, 2, 0, Math.PI * 2);
    ctx.fillStyle = color;
    ctx.fill();
    ctx.globalAlpha = 1;

    // --- горизонт (простая линия) ---
    // без крена/тангажа из state — упрощённый вариант: рисуем, если данных нет
    // (в Game передаётся фиктивный уровень)

    // --- левый верх: ARM, режим, батарея ---
    const armedStr = s.armed ? 'ARMED' : 'DISARMED';
    text(armedStr, pad, pad + 8, 'left', s.armed ? color : danger);
    text(s.mode, pad, pad + 28, 'left', color, 12);
    // батарея
    const vColor = s.lowBattery ? danger : s.vbat < 22.5 ? warn : color;
    text(`${s.vbat.toFixed(1)}V`, pad, pad + 50, 'left', vColor, 16);
    const battPct = Math.round(((s.vbat - 20) / 5.2) * 100);
    text(`${battPct}%`, pad, pad + 70, 'left', vColor, 12);
    // полоска батареи
    ctx.fillStyle = 'rgba(0,0,0,0.4)';
    ctx.fillRect(pad, pad + 82, 60, 6);
    ctx.fillStyle = vColor;
    ctx.fillRect(pad, pad + 82, 60 * clamp(battPct / 100, 0, 1), 6);

    // --- правый верх: RSSI, таймер миссии, FPS ---
    const rssiStr = s.rssi >= 60 ? 'RSSI OK' : s.rssi >= 35 ? 'RSSI LOW' : s.signalLost ? 'SIGNAL LOST' : 'RSSI CRIT';
    text(rssiStr, this.w - pad, pad + 8, 'right', s.signalLost ? danger : s.rssi < 35 ? warn : color, 13);
    if (s.missionTime >= 0) {
      const tCol = s.missionTime < 20 ? danger : color;
      text(formatTime(s.missionTime), this.w - pad, pad + 30, 'right', tCol, 18);
    } else {
      text(formatTime(s.clock), this.w - pad, pad + 30, 'right', color, 16);
    }
    if (s.showFps) text(`${Math.round(s.fps)} FPS`, this.w - pad, pad + 52, 'right', color, 12);

    // --- левый низ: газ ---
    const thr = Math.round(s.throttle * 100);
    text(`THR ${String(thr).padStart(3, ' ')}%`, pad, this.h - pad - 26, 'left', color, 15);
    ctx.fillStyle = 'rgba(0,0,0,0.4)';
    ctx.fillRect(pad, this.h - pad - 8, 80, 6);
    ctx.fillStyle = color;
    ctx.fillRect(pad, this.h - pad - 8, 80 * s.throttle, 6);

    // --- правый низ: груз ---
    if (s.payloadReady) {
      text('PAYLOAD RDY', this.w - pad, this.h - pad - 8, 'right', color, 13);
    } else {
      text(`PAYLOAD ${Math.ceil(s.payloadSec)}s`, this.w - pad, this.h - pad - 8, 'right', warn, 13);
    }

    // --- низ центр: скорость + высота ---
    text(`${Math.round(s.speedKmh)} KM/H`, mx, this.h - pad - 26, 'center', color, 15);
    text(`ALT ${s.altM.toFixed(1)}M`, mx, this.h - pad - 8, 'center', color, 15);

    // --- верх центр: очки / цель ---
    if (s.objective) {
      text(s.objective, mx, pad + 8, 'center', warn, 14);
    }
    if (s.targetsLeft >= 0) {
      text(`TARGETS ${s.targetsLeft}`, mx, pad + 30, 'center', color, 14);
    }
    if (s.score > 0) {
      text(`${s.score}`, mx, pad + 54, 'center', color, 18);
    }

    // --- всплывающие очки ---
    let py = my - 60;
    for (const p of s.popups) {
      ctx.globalAlpha = clamp(p.t / 1.6, 0, 1);
      text(p.text, mx + 130, py, 'left', '#ffd97a', 16);
      py -= 22;
    }
    ctx.globalAlpha = 1;

    // --- маркер попадания ---
    if (s.hitMarkerT > 0) {
      ctx.strokeStyle = '#ffd97a';
      ctx.lineWidth = 2.5;
      const r1 = 12;
      const r2 = 22;
      ctx.beginPath();
      for (const [sx, sy] of [[1, 1], [1, -1], [-1, 1], [-1, -1]]) {
        ctx.moveTo(mx + sx * r1, my + sy * r1);
        ctx.lineTo(mx + sx * r2, my + sy * r2);
      }
      ctx.stroke();
    }

    // --- предупреждения ---
    if (s.lowBattery && Math.floor(performance.now() / 600) % 2 === 0) {
      text('LOW VOLTAGE', mx, my + 90, 'center', danger, 16);
    }
    if (s.crash) {
      text('CRASH', mx, my - 70, 'center', danger, 26);
    }
    if (s.signalLost) {
      text('SIGNAL LOST', mx, my - 120, 'center', danger, 20);
    }
    if (s.message && s.messageT > 0) {
      ctx.globalAlpha = clamp(s.messageT, 0, 1);
      text(s.message, mx, my - 40, 'center', warn, 22);
      ctx.globalAlpha = 1;
    }

    ctx.restore();
  }
}
