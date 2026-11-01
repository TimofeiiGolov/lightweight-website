import RAPIER from '@dimforge/rapier3d-compat';
import * as THREE from 'three';
import type { FlightInput, Settings } from '../types';
import { PHYS } from '../config';
import { clamp, damp, deg2rad } from '../utils/MathUtils';

const UP_AXIS = new THREE.Vector3(0, 1, 0);
const RIGHT_AXIS = new THREE.Vector3(1, 0, 0);
const FWD_AXIS = new THREE.Vector3(0, 0, 1);

/**
 * Собственная аэродинамическая модель 6DOF.
 * Каждый фиксированный шаг:
 *  - тяга: throttle → spool-up → thrust вдоль оси корпуса
 *  - угловое управление: Acro (rate) / Angle (самовыравнивание), PD-моменты
 *  - линейное + квадратичное сопротивление
 *  - имитация батареи (просадка напряжения)
 * Импульсы прикладываются к Rapier rigid body.
 */
export class FlightModel {
  /** фактические обороты моторов 0..1 (с учётом spool-up) */
  spool = 0;
  /** напряжение батареи, В */
  vbat: number = PHYS.vbatFull;
  /** наработка батареи, сек */
  flightT = 0;

  // переиспользуемые временные объекты (без аллокаций в горячем цикле)
  private q = new THREE.Quaternion();
  private qConj = new THREE.Quaternion();
  private qTarget = new THREE.Quaternion();
  private qYaw = new THREE.Quaternion();
  private qPitch = new THREE.Quaternion();
  private qRoll = new THREE.Quaternion();
  private vUp = new THREE.Vector3();
  private vTmp = new THREE.Vector3();
  private vDes = new THREE.Vector3();
  private vCur = new THREE.Vector3();

  reset(): void {
    this.spool = 0;
    this.vbat = PHYS.vbatFull;
    this.flightT = 0;
  }

  /**
   * Кривая rates в стиле Betaflight "Rates" (RC Rate / Super Rate / Expo).
   * Возвращает угловую скорость в рад/с для отклонения стика x (-1..1).
   */
  rateCurve(x: number, s: Settings): number {
    if (Math.abs(x) < 1e-4) return 0;
    // expo-форма стика
    const shaped = x * x * x * x * s.expo + x * (1 - s.expo);
    // super rate: рост к краям
    const superFactor = 1 / (1 - Math.min(0.995, Math.abs(shaped)) * s.superRate);
    const degPerSec = 200 * s.rcRate * shaped * superFactor;
    return deg2rad(clamp(degPerSec, -2000, 2000));
  }

  /** Один физический шаг. Возвращает фактическую тягу (Н). */
  step(input: FlightInput, body: RAPIER.RigidBody, dt: number, s: Settings, mode: 'ACRO' | 'ANGLE'): number {
    // --- Моторы: spool-up ---
    const thrCmd = clamp(input.throttle * (s.maxThrottle / 100), 0, 1);
    this.spool = damp(this.spool, thrCmd, 1 / PHYS.spoolTime, dt);

    // --- Батарея ---
    this.flightT += dt * (0.25 + 0.75 * this.spool);
    this.vbat = clamp(
      PHYS.vbatFull - 3.4 * (this.flightT / (PHYS.flightMinutes * 60)) - PHYS.vbatSag * this.spool,
      PHYS.vbatMin,
      PHYS.vbatFull
    );

    // --- Тяга ---
    const vFactor = clamp(this.vbat / PHYS.vbatFull, 0.85, 1);
    const mass = s.massKg;
    const maxThrust = s.twr * mass * PHYS.gravity * vFactor;
    const thrust = maxThrust * (0.3 * this.spool + 0.7 * this.spool * this.spool);

    const rot = body.rotation();
    this.q.set(rot.x, rot.y, rot.z, rot.w);
    this.vUp.set(0, 1, 0).applyQuaternion(this.q);
    this.vTmp.copy(this.vUp).multiplyScalar(thrust * dt);
    body.applyImpulse(this.vTmp, true);

    // --- Сопротивление: a = -(c1 + c2*|v|) * v ---
    const lv = body.linvel();
    this.vCur.set(lv.x, lv.y, lv.z);
    const speed = this.vCur.length();
    if (speed > 0.01) {
      const k = (PHYS.dragC1 + PHYS.dragC2 * speed) * mass * dt;
      this.vTmp.copy(this.vCur).multiplyScalar(-k);
      body.applyImpulse(this.vTmp, true);
    }

    // --- Угловое управление ---
    const av = body.angvel();
    this.vCur.set(av.x, av.y, av.z); // текущая ω (мировая СК)

    const inertia = PHYS.inertia * (mass / 0.68);
    const maxTorqueImp = PHYS.maxTorqueImpulse * (mass / 0.68);
    const yawRateDes = this.rateCurve(-input.yaw, s);

    if (mode === 'ACRO') {
      // желаемая угловая скорость в СК корпуса → в мировую
      this.vDes.set(
        this.rateCurve(input.pitch, s),  // X — тангаж
        yawRateDes,                      // Y — рыскание
        this.rateCurve(-input.roll, s)   // Z — крен
      ).applyQuaternion(this.q);
    } else {
      // ANGLE: целевой наклон пропорционален стику, рыскание по скорости
      const yaw = Math.atan2(2 * (this.q.w * this.q.y + this.q.x * this.q.z),
                             1 - 2 * (this.q.y * this.q.y + this.q.x * this.q.x));
      this.qYaw.setFromAxisAngle(UP_AXIS, yaw);
      this.qPitch.setFromAxisAngle(RIGHT_AXIS, input.pitch * deg2rad(35));
      this.qRoll.setFromAxisAngle(FWD_AXIS, -input.roll * deg2rad(35));
      this.qTarget.copy(this.qYaw).multiply(this.qPitch).multiply(this.qRoll);

      // qErr = qTarget * qCurrent⁻¹ (мировая СК)
      this.qConj.copy(this.q).conjugate();
      this.qTarget.multiply(this.qConj).normalize();

      const ang = 2 * Math.acos(clamp(this.qTarget.w, -1, 1));
      const sinHalf = Math.sqrt(Math.max(0, 1 - this.qTarget.w * this.qTarget.w));
      if (sinHalf > 1e-5 && ang > 1e-4) {
        const k = (ang * 10) / sinHalf;
        this.vDes.set(this.qTarget.x * k, yawRateDes, this.qTarget.z * k);
      } else {
        this.vDes.set(0, yawRateDes, 0);
      }
    }

    // PD: ошибка угловой скорости → момент
    this.vDes.sub(this.vCur);
    this.vDes.multiplyScalar(inertia * PHYS.kpAng * dt);
    const cl = maxTorqueImp;
    body.applyTorqueImpulse(
      { x: clamp(this.vDes.x, -cl, cl), y: clamp(this.vDes.y, -cl * 0.55, cl * 0.55), z: clamp(this.vDes.z, -cl, cl) },
      true
    );

    return thrust;
  }
}
