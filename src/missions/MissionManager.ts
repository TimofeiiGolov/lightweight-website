import { Vector3 } from 'three';
import type { Level } from '../world/Level';
import type { MissionDef } from './MissionData';

export interface ObjectiveState {
  label: string;
  progress: number;
  target: number;
  done: boolean;
  type: string;
}

export interface MissionResult {
  success: boolean;
  reason: string;
  time: number;
  score: number;
  stars: number;
  kills: number;
  crashes: number;
  accuracy: number;
}

export interface MissionCtx {
  pos: Vector3;
  speed: number;
  agl: number;
  armed: boolean;
  upright: boolean;
  payloadsInFlight: number;
  payloadsLeft: number;
}

/** Логика целей, очков, таймера и звёзд */
export class MissionManager {
  def: MissionDef | null = null;
  state: 'idle' | 'running' | 'done' = 'idle';
  elapsed = 0;
  score = 0;
  kills = 0;
  crashes = 0;
  drops = 0;
  hits = 0;
  objectives: ObjectiveState[] = [];
  result: MissionResult | null = null;
  hoverInside = false;
  onEvent: (text: string, kind: 'ok' | 'warn' | 'info') => void = () => {};
  onFinish: (r: MissionResult) => void = () => {};

  constructor(private level: Level) {}

  get timeLeft() {
    return this.def && this.def.timeLimit > 0 ? Math.max(0, this.def.timeLimit - this.elapsed) : 0;
  }

  start(def: MissionDef) {
    this.def = def;
    this.state = 'running';
    this.elapsed = 0;
    this.score = 0;
    this.kills = 0;
    this.crashes = 0;
    this.drops = 0;
    this.hits = 0;
    this.result = null;
    this.hoverInside = false;
    this.objectives = def.objectives.map((o) => ({
      label: o.label,
      type: o.type,
      progress: 0,
      done: false,
      target: o.type === 'destroy' || o.type === 'gates' ? (o.count ?? 1) : o.type === 'hover' ? (o.seconds ?? 10) : o.type === 'altitude' ? (o.altitude ?? 10) : 1,
    }));
  }

  private active(i: number) {
    if (!this.def?.sequential) return true;
    for (let k = 0; k < i; k++) if (!this.objectives[k].done) return false;
    return true;
  }

  private add(points: number) {
    this.score += points;
  }

  targetsDestroyed(count: number, points: number) {
    if (this.state !== 'running' || count <= 0) return;
    this.kills += count;
    this.hits++;
    this.add(points + (count > 1 ? 50 * (count - 1) : 0));
    this.def!.objectives.forEach((o, i) => {
      if (o.type === 'destroy' && !this.objectives[i].done) {
        const s = this.objectives[i];
        s.progress = Math.min(s.target, s.progress + count);
        if (s.progress >= s.target) this.complete(i);
      }
    });
    this.onEvent(count > 1 ? `ПОРАЖЕНО ЦЕЛЕЙ: ${count}  +${points + 50 * (count - 1)}` : `ЦЕЛЬ ПОРАЖЕНА  +${points}`, 'ok');
  }

  payloadImpact(pos: Vector3) {
    if (this.state !== 'running') return;
    this.def!.objectives.forEach((o, i) => {
      if (o.type !== 'drop' || this.objectives[i].done) return;
      const z = this.level.zones.find((q) => q.id === o.zone);
      if (!z) return;
      const d = Math.hypot(pos.x - z.pos.x, pos.z - z.pos.z);
      if (d <= z.radius) {
        const bonus = Math.round((1 - d / z.radius) * 200);
        this.add(300 + bonus);
        this.hits++;
        this.objectives[i].progress = 1;
        this.complete(i);
        this.onEvent(`ГРУЗ ДОСТАВЛЕН  +${300 + bonus}`, 'ok');
      }
    });
  }

  gatePassed(n: number, speed: number) {
    if (this.state !== 'running') return;
    this.add(50 + Math.round(Math.min(speed, 25) * 2));
    this.def!.objectives.forEach((o, i) => {
      if (o.type === 'gates' && !this.objectives[i].done) {
        this.objectives[i].progress = n;
        if (n >= this.objectives[i].target) this.complete(i);
      }
    });
  }

  crashed() {
    if (this.state !== 'running') return;
    this.crashes++;
    this.add(-100);
    this.onEvent('КРАШ  -100', 'warn');
  }

  private complete(i: number) {
    this.objectives[i].done = true;
    if (this.objectives.every((o) => o.done)) this.finish(true, 'Все цели выполнены');
  }

  update(dt: number, ctx: MissionCtx) {
    if (this.state !== 'running' || !this.def) return;
    this.elapsed += dt;
    this.hoverInside = false;
    this.def.objectives.forEach((o, i) => {
      const s = this.objectives[i];
      if (s.done || !this.active(i)) return;
      if (o.type === 'hover') {
        const hp = this.level.hoverPoint;
        const inside = ctx.pos.distanceTo(hp) < 2 && ctx.speed < 2 && ctx.armed;
        this.hoverInside = inside;
        if (inside) {
          s.progress += dt;
          this.add(0);
          if (s.progress >= s.target) {
            s.progress = s.target;
            this.add(300);
            this.complete(i);
          }
        } else s.progress = Math.max(0, s.progress - dt * 0.5);
      } else if (o.type === 'altitude') {
        s.progress = Math.max(s.progress, Math.min(s.target, ctx.agl));
        if (ctx.agl >= s.target) {
          this.add(100);
          this.complete(i);
          this.onEvent('ВЫСОТА ДОСТИГНУТА  +100', 'ok');
        }
      } else if (o.type === 'land') {
        const pad = this.level.pads.find((p) => p.id === o.pad);
        if (pad && ctx.agl < 0.5 && ctx.speed < 0.7 && ctx.upright && Math.hypot(ctx.pos.x - pad.pos.x, ctx.pos.z - pad.pos.z) < pad.radius) {
          s.progress = 1;
          this.add(300);
          this.complete(i);
          this.onEvent('ПОСАДКА ЗАЧТЕНА  +300', 'ok');
        }
      }
    });
    if (this.state !== 'running') return;

    if (this.def.timeLimit > 0 && this.elapsed >= this.def.timeLimit) {
      this.finish(false, 'Время вышло');
      return;
    }
    // нагрузка исчерпана, а цели «на поражение/доставку» не выполнены
    const needPayload = this.def.objectives.some((o, i) => (o.type === 'destroy' || o.type === 'drop') && !this.objectives[i].done);
    if (needPayload && this.def.payloads >= 0 && ctx.payloadsLeft <= 0 && ctx.payloadsInFlight === 0) {
      this.finish(false, 'Нагрузка исчерпана');
    }
  }

  private finish(success: boolean, reason: string) {
    if (!this.def || this.state !== 'running') return;
    this.state = 'done';
    const d = this.def;
    let stars = 0;
    if (success) {
      const left = d.timeLimit > 0 ? Math.max(0, d.timeLimit - this.elapsed) : 0;
      this.add(Math.round(left * 3));
      stars = this.elapsed <= d.parTime ? 3 : this.elapsed <= d.parTime * 1.5 ? 2 : 1;
      if (this.crashes >= 2) stars = Math.max(1, stars - 1);
    }
    const shots = Math.max(1, this.drops);
    this.result = {
      success,
      reason,
      time: this.elapsed,
      score: Math.max(0, Math.round(this.score)),
      stars,
      kills: this.kills,
      crashes: this.crashes,
      accuracy: Math.round((Math.min(this.hits, shots) / shots) * 100),
    };
    this.onFinish(this.result);
  }
}
