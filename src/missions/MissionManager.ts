import type { EventBus } from '../core/EventBus';
import { SCORE } from '../config';
import { PAYLOAD } from '../config';
import type { MissionDef } from '../types';
import { clamp } from '../utils/MathUtils';
import { loadRecords, saveRecord } from '../utils/Storage';

export interface MissionEndResult {
  win: boolean;
  stars: number;
  score: number;
  timeUsed: number;
  def: MissionDef;
}

interface ObjectiveState {
  done: boolean;
  progress: number;
  total: number;
}

/**
 * Прогресс миссии: последовательные цели, таймер, очки, звёзды.
 * Слушает игровые события (попадания, ворота, сброс) через EventBus.
 */
export class MissionManager {
  current: MissionDef | null = null;
  running = false;
  timeLeft = 0;
  elapsed = 0;
  score = 0;
  objIndex = 0;
  objStates: ObjectiveState[] = [];

  private bus: EventBus;
  private offs: Array<() => void> = [];
  private destroyedIds = new Set<number>();
  private landedZones = new Set<number>();
  private hoverT = 0;
  private lowBatTimer = 0;
  private onEnd: (r: MissionEndResult) => void;

  constructor(bus: EventBus, onEnd: (r: MissionEndResult) => void) {
    this.bus = bus;
    this.onEnd = onEnd;
  }

  load(def: MissionDef, restoreTargets: () => void): void {
    this.clear();
    this.current = def;
    this.running = true;
    this.timeLeft = def.timeLimit;
    this.elapsed = 0;
    this.score = 0;
    this.objIndex = 0;
    this.destroyedIds.clear();
    this.landedZones.clear();
    this.hoverT = 0;
    this.objStates = def.objectives.map((o) => ({
      done: false,
      progress: 0,
      total: o.type === 'destroy' || o.type === 'gates' || o.type === 'payload'
        ? (o.ids?.length ?? 0)
        : o.type === 'hover' ? (o.seconds ?? 1) : 1,
    }));

    restoreTargets();
    this.highlightActive();

    this.offs.push(
      this.bus.on('targetDestroyed', (...a) => {
        const id = a[0] as number;
        this.destroyedIds.add(id);
        this.bus.emit('score', a[1] as number);
      }),
      this.bus.on('gatePassed', (...a) => {
        const idx = a[0] as number;
        if (this.currentObjective()?.type === 'gates') {
          this.bus.emit('score', SCORE.gate);
          void idx;
        }
      }),
      this.bus.on('payloadLanded', (...a) => {
        const dist = a[1] as number;
        const inZone = a[2] as boolean;
        if (inZone) {
          const pts = dist < 2 ? PAYLOAD.scoreBullseye : dist < 4.5 ? PAYLOAD.scoreGood : PAYLOAD.scoreHit;
          this.bus.emit('score', pts);
        }
      }),
    );
  }

  clear(): void {
    for (const off of this.offs) off();
    this.offs = [];
    this.current = null;
    this.running = false;
  }

  currentObjective() {
    return this.current?.objectives[this.objIndex] ?? null;
  }

  private highlightActive(): void {
    if (!this.current) return;
    const o = this.currentObjective();
    if (!o) return;
    if (o.type === 'destroy') {
      const need = (o.ids ?? []).filter((id) => !this.destroyedIds.has(id));
      this.bus.emit('highlightTargets', need);
    } else {
      this.bus.emit('highlightTargets', []);
    }
  }

  /** Обновление каждый кадр (только в полёте) */
  update(dt: number, dronePos: { x: number; y: number; z: number }, droneSpeed: number, droneY: number): void {
    if (!this.running || !this.current) return;
    this.elapsed += dt;
    if (this.current.timeLimit > 0) {
      this.timeLeft -= dt;
      if (this.timeLeft <= 0) {
        this.timeLeft = 0;
        this.finish(false);
        return;
      }
    }
    this.checkObjectives(dt, dronePos, droneSpeed, droneY);
    this.checkBatteryWarn();
  }

  private checkObjectives(dt: number, dronePos: { x: number; y: number; z: number }, droneSpeed: number, droneY: number): void {
    if (!this.current) return;
    // свободный полёт: целей нет — миссия не завершается
    if (this.current.objectives.length === 0) return;
    // проверяем ВСЕ цели по порядку — переход, когда текущая выполнена
    let guard = 0;
    while (this.objIndex < this.current.objectives.length && guard++ < 8) {
      const o = this.current.objectives[this.objIndex];
      const st = this.objStates[this.objIndex];
      if (!st || st.done) break;

      switch (o.type) {
        case 'destroy': {
          const ids = o.ids ?? [];
          let killed = 0;
          for (const id of ids) if (this.destroyedIds.has(id)) killed++;
          st.progress = killed;
          break;
        }
        case 'gates': {
          // прогресс ведёт Game через onGatePassed
          break;
        }
        case 'payload': {
          // прогресс ведёт Game через onPayloadLanded
          break;
        }
        case 'hover': {
          const a = o.anchor ?? [0, 0, 0];
          const d = Math.hypot(dronePos.x - a[0], dronePos.y - a[1], dronePos.z - a[2]);
          if (d < (o.radius ?? 2.5) && droneSpeed < 3) {
            this.hoverT += dt;
          } else {
            this.hoverT = Math.max(0, this.hoverT - dt * 2);
          }
          st.progress = Math.min(this.hoverT, st.total);
          break;
        }
        case 'land': {
          // определяет Game через onLanded
          break;
        }
      }

      if (st.progress >= st.total) {
        st.done = true;
        this.objIndex++;
        this.hoverT = 0;
        this.bus.emit('objectiveDone');
        this.highlightActive();
        continue;
      }
      break;
    }

    if (this.objIndex >= this.current.objectives.length) {
      this.finish(true);
    }
  }

  private checkBatteryWarn(): void {
    void this.running;
  }

  /** Вызывается Game при пролёте ворот */
  onGatePassed(idx: number, expectedNext: boolean): void {
    const o = this.currentObjective();
    if (!o || o.type !== 'gates' || !this.running) return;
    const ids = o.ids ?? [];
    const expected = ids[this.objStates[this.objIndex].progress];
    if (expectedNext && idx === expected) {
      this.objStates[this.objIndex].progress++;
      this.bus.emit('objectiveProgress');
    }
  }

  /** Вызывается Game при падении груза */
  onPayloadLanded(zoneIdx: number, inZone: boolean): void {
    const o = this.currentObjective();
    if (!o || o.type !== 'payload' || !this.running || !inZone) return;
    const ids = o.ids ?? [];
    if (ids.includes(zoneIdx) && !this.landedZones.has(zoneIdx)) {
      this.landedZones.add(zoneIdx);
      this.objStates[this.objIndex].progress++;
      this.bus.emit('objectiveProgress');
    }
  }

  /** Вызывается Game при посадке */
  onLanded(inZone: boolean): void {
    const o = this.currentObjective();
    if (!o || o.type !== 'land' || !this.running) return;
    if (inZone) {
      this.objStates[this.objIndex].progress = 1;
    }
  }

  private finish(win: boolean): void {
    if (!this.running || !this.current) return;
    this.running = false;
    let stars = 0;
    if (win) {
      if (this.current.starTimes) {
        const [t3, t2] = this.current.starTimes;
        stars = this.elapsed <= t3 ? 3 : this.elapsed <= t2 ? 2 : 1;
      } else if (this.current.timeLimit > 0) {
        const ratio = this.timeLeft / this.current.timeLimit;
        stars = ratio > 0.5 ? 3 : ratio > 0.2 ? 2 : 1;
      } else {
        stars = 1;
      }
      if (this.current.timeLimit > 0) {
        this.score += SCORE.missionComplete + Math.round(this.timeLeft * SCORE.perSecondLeft);
      } else {
        this.score += SCORE.missionComplete;
      }
    }
    const result: MissionEndResult = {
      win,
      stars,
      score: this.score,
      timeUsed: this.elapsed,
      def: this.current,
    };
    if (win) {
      saveRecord(this.current.id, {
        stars,
        bestScore: this.score,
        bestTime: this.current.timeLimit > 0 || this.current.starTimes ? Math.round(this.elapsed) : 0,
      });
    }
    this.onEnd(result);
  }

  objectiveText(): string {
    const o = this.currentObjective();
    if (!this.current || !o) return this.current?.mode === 'free' ? 'Свободный полёт' : '';
    const st = this.objStates[this.objIndex];
    const base = o.desc.replace(/(\d+)\/(\d+)|(\d+) (с|целей|щитов|зон|ворот)?.*$/, '').trim();
    void base;
    if (o.type === 'hover') return `${o.desc} · ${Math.floor(st.progress)}/${st.total}с`;
    if (st.total > 1) return `${o.desc.replace(/:?\s*\d+\/\d+/, '')} · ${st.progress}/${st.total}`;
    return o.desc;
  }

  progressSummary(): string {
    if (!this.current) return '';
    return this.objStates
      .map((s, i) => `${i + 1}: ${s.done ? '✓' : `${s.progress}/${s.total}`}`)
      .join('  ');
  }

  timeLeftClamped(): number {
    return clamp(this.timeLeft, 0, 9999);
  }
}
