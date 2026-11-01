import { Quaternion, Vector3 } from 'three';
import { PHYS, type Settings } from '../config';
import { actualRate, clamp, DEG } from '../utils/MathUtils';

export interface FlightInput {
  roll: number;
  pitch: number;
  yaw: number;
  throttleStick: number; // -1..1
  armed: boolean;
  crashed: boolean;
}

/**
 * Собственная 6DOF-модель квадрокоптера.
 * Rapier отвечает за интеграцию позиции и столкновения; здесь считаются:
 *  - тяга 4 моторов с раскруткой (spool-up), кривая тяги, просадка батареи
 *  - гравитация, линейное + квадратичное сопротивление в осях корпуса
 *  - контур угловых скоростей (Acro / Horizon / Angle) с инерцией и ограничением акселерации
 */
export class FlightModel {
  motors = new Float32Array(4); // фактическая отдача 0..1
  motorCmd = new Float32Array(4);
  avgMotor = 0;
  thrustN = 0;
  throttleCmd = 0; // 0..1 для OSD
  batteryUsed = 0; // мАч
  voltage = PHYS.cells * 4.2;
  current = 0;
  rateCmd = new Vector3(); // рад/с (OSD/звук)
  private vInt = 0;

  // временные объекты (без аллокаций в горячем цикле)
  private qInv = new Quaternion();
  private wB = new Vector3();
  private vB = new Vector3();
  private fB = new Vector3();
  private up = new Vector3();
  private uB = new Vector3();
  private static Y = new Vector3(0, 1, 0);

  constructor(public s: Settings) {}

  get tmax() {
    return this.s.twr * this.s.mass * PHYS.gravity;
  }

  curve(m: number) {
    const k = PHYS.thrustExpo;
    return k * m * m + (1 - k) * m;
  }

  get hoverThrottle() {
    const k = PHYS.thrustExpo;
    const t = 1 / this.s.twr;
    return (-(1 - k) + Math.sqrt((1 - k) * (1 - k) + 4 * k * t)) / (2 * k);
  }

  get batteryPct() {
    return clamp(1 - this.batteryUsed / PHYS.batteryMah, 0, 1);
  }

  get batteryScale() {
    const vn = clamp((this.voltage - 12.4) / (16.8 - 12.4), 0, 1);
    return 0.45 + 0.55 * Math.sqrt(vn);
  }

  reset() {
    this.motors.fill(0);
    this.motorCmd.fill(0);
    this.batteryUsed = 0;
    this.voltage = PHYS.cells * 4.2;
    this.vInt = 0;
    this.thrustN = 0;
    this.avgMotor = 0;
  }

  /**
   * Один фиксированный шаг. Меняет vel (линейная скорость) и angvel (если возвращает true — угловую скорость нужно записать в тело).
   */
  step(dt: number, inp: FlightInput, q: Quaternion, vel: Vector3, angvel: Vector3): boolean {
    const s = this.s;
    const mass = s.mass;
    const g = PHYS.gravity;
    this.qInv.copy(q).invert();
    this.up.copy(FlightModel.Y).applyQuaternion(q);
    const tiltCos = clamp(this.up.y, 0.35, 1);

    // ---------- команда газа ----------
    const live = inp.armed && !inp.crashed;
    let thr = 0;
    if (live) {
      const maxThr = s.maxThrottle;
      if (s.throttleMode === 'assist') {
        // удержание вертикальной скорости: центр стика = висение
        const st = inp.throttleStick;
        const target = st > 0 ? st * 8 : st * 3.5;
        const err = target - vel.y;
        this.vInt = clamp(this.vInt + err * dt * 0.06, -0.12, 0.12);
        thr = (this.hoverThrottle / tiltCos) / this.batteryScale + 0.12 * err + this.vInt;
        thr = clamp(thr, PHYS.idle, maxThr);
      } else {
        const t = clamp((inp.throttleStick + 1) / 2, 0, 1);
        thr = t < 0.015 ? PHYS.idle : PHYS.idle + (maxThr - PHYS.idle) * t;
      }
    } else {
      this.vInt = 0;
    }
    this.throttleCmd = thr;

    // ---------- желаемые угловые скорости (рад/с) в осях корпуса ----------
    const rp = s.rpRates;
    const yr = s.yawRates;
    let cmdX = -actualRate(inp.pitch, rp.center, rp.max, rp.expo) * DEG;
    let cmdZ = -actualRate(inp.roll, rp.center, rp.max, rp.expo) * DEG;
    const cmdY = -actualRate(inp.yaw, yr.center, yr.max, yr.expo) * DEG;

    this.uB.copy(FlightModel.Y).applyQuaternion(this.qInv);
    const noseDown = Math.atan2(this.uB.z, this.uB.y);
    const rollRight = Math.atan2(-this.uB.x, this.uB.y);
    const lim = 420 * DEG;
    if (s.flightMode === 'angle') {
      cmdX = -clamp(PHYS.angleP * (inp.pitch * PHYS.angleMax - noseDown), -lim, lim);
      cmdZ = -clamp(PHYS.angleP * (inp.roll * PHYS.angleMax - rollRight), -lim, lim);
    } else if (s.flightMode === 'horizon') {
      const f = 1 - Math.max(Math.abs(inp.roll), Math.abs(inp.pitch));
      const f2 = f * f;
      cmdX += -clamp(PHYS.angleP * (0 - noseDown), -lim, lim) * f2;
      cmdZ += -clamp(PHYS.angleP * (0 - rollRight), -lim, lim) * f2;
    }
    if (!live) {
      cmdX = 0;
      cmdZ = 0;
    }
    this.rateCmd.set(cmdX, live ? cmdY : 0, cmdZ);

    // ---------- моторы ----------
    this.wB.copy(angvel).applyQuaternion(this.qInv);
    const ex = (this.rateCmd.x - this.wB.x) / 10;
    const ey = (this.rateCmd.y - this.wB.y) / 10;
    const ez = (this.rateCmd.z - this.wB.z) / 10;
    const mixK = 0.35;
    // 0: перед-лево, 1: перед-право, 2: зад-лево, 3: зад-право
    const base = thr;
    const mix = live
      ? [
          ex * mixK - ez * mixK + ey * 0.15,
          ex * mixK + ez * mixK - ey * 0.15,
          -ex * mixK - ez * mixK - ey * 0.15,
          -ex * mixK + ez * mixK + ey * 0.15,
        ]
      : [0, 0, 0, 0];
    let sum = 0;
    let thrust = 0;
    const bs = this.batteryScale;
    for (let i = 0; i < 4; i++) {
      const cmd = live ? clamp(base + mix[i] * Math.max(0.3, base), 0, 1) : 0;
      this.motorCmd[i] = cmd;
      const cur = this.motors[i];
      const tau = cmd > cur ? PHYS.motorTauUp : PHYS.motorTauDown;
      const m = cur + (cmd - cur) * (1 - Math.exp(-dt / tau));
      this.motors[i] = m;
      sum += m;
      thrust += (this.tmax / 4) * this.curve(m) * bs;
    }
    this.avgMotor = sum / 4;
    this.thrustN = thrust;

    // ---------- батарея ----------
    const am = this.avgMotor;
    this.current = 1.5 + 95 * Math.pow(am, 2.2);
    this.batteryUsed += (this.current * dt * 1000) / 3600;
    const u = clamp(this.batteryUsed / PHYS.batteryMah, 0, 1);
    this.voltage = Math.max(PHYS.cells * 2.9, 12.4 + 4.4 * Math.pow(1 - u, 0.6) - 0.012 * this.current);

    // ---------- линейная динамика ----------
    this.vB.copy(vel).applyQuaternion(this.qInv);
    const speed = this.vB.length();
    const dq = PHYS.dragQuad;
    this.fB.set(
      -(PHYS.dragLin * this.vB.x + dq[0] * speed * this.vB.x),
      thrust - (PHYS.dragLin * this.vB.y + dq[1] * speed * this.vB.y),
      -(PHYS.dragLin * this.vB.z + dq[2] * speed * this.vB.z),
    );
    this.fB.applyQuaternion(q).multiplyScalar(dt / mass);
    vel.add(this.fB);
    vel.y -= g * dt;

    // ---------- угловая динамика ----------
    if (!live) return false;
    const auth = 0.3 + 0.7 * clamp(this.avgMotor / 0.22, 0, 1);
    const massF = Math.sqrt(mass / 0.9);
    const maxA = PHYS.maxAngAccel * (s.twr / 5.5) * (0.9 / mass) * auth * dt;
    const axes: ('x' | 'y' | 'z')[] = ['x', 'y', 'z'];
    for (let i = 0; i < 3; i++) {
      const a = axes[i];
      const tau = (PHYS.angTau[i] * massF) / auth;
      let d = (this.rateCmd[a] - this.wB[a]) * (1 - Math.exp(-dt / tau));
      d = clamp(d, -maxA, maxA);
      this.wB[a] += d;
    }
    angvel.copy(this.wB).applyQuaternion(q);
    return true;
  }
}
