import * as THREE from 'three';
import { clamp, damp, deg2rad } from '../utils/MathUtils';

/**
 * FPV-камера: жёстко привязана к дрону, наклон (tilt) вверх,
 * широкий FOV, тряска от вибрации моторов и ударов.
 */
export class CameraFPV {
  readonly camera: THREE.PerspectiveCamera;
  tiltDeg = 25;
  fov = 110;
  shakeAmount = 0.6;

  private impact = 0;
  private shakeT = 0;
  private qTilt = new THREE.Quaternion();
  private qShake = new THREE.Quaternion();
  private vPos = new THREE.Vector3();
  private vFwd = new THREE.Vector3();
  private axis = new THREE.Vector3();

  constructor(aspect: number) {
    this.camera = new THREE.PerspectiveCamera(this.fov, aspect, 0.05, 500);
  }

  setFov(fov: number): void {
    if (fov !== this.fov) {
      this.fov = fov;
      this.camera.fov = fov;
      this.camera.updateProjectionMatrix();
    }
  }

  setTilt(deg: number): void {
    this.tiltDeg = clamp(deg, 0, 45);
  }

  /** Внешний импульс тряски (удар, взрыв рядом) */
  addImpact(strength: number): void {
    this.impact = Math.min(1.5, this.impact + strength);
  }

  update(dt: number, dronePos: THREE.Vector3, droneQuat: THREE.Quaternion, spool: number, throttle: number): void {
    // позиция: чуть выше и впереди центра корпуса
    this.vFwd.set(0, 0.05, -0.07).applyQuaternion(droneQuat);
    this.camera.position.copy(dronePos).add(this.vPos.copy(this.vFwd));

    // ориентация: кватернион дрона * наклон камеры
    this.qTilt.setFromAxisAngle(X_AXIS, deg2rad(this.tiltDeg));
    this.camera.quaternion.copy(droneQuat).multiply(this.qTilt);

    // тряска: вибрация моторов + затухающие удары
    this.shakeT += dt * 47;
    this.impact = damp(this.impact, 0, 6, dt);
    const vibAmp = (0.0012 + 0.004 * spool * (0.4 + throttle)) * this.shakeAmount + this.impact * 0.02 * this.shakeAmount;
    if (vibAmp > 1e-5) {
      const t = this.shakeT;
      this.axis.set(Math.sin(t * 1.7), Math.sin(t * 2.3 + 1.4), Math.sin(t * 1.1 + 3.1)).normalize();
      this.qShake.setFromAxisAngle(this.axis, vibAmp * (0.6 + 0.4 * Math.sin(t * 5.3)));
      this.camera.quaternion.multiply(this.qShake);
      // микросдвиг позиции
      this.camera.position.x += Math.sin(t * 3.1) * vibAmp * 0.35;
      this.camera.position.y += Math.sin(t * 4.3 + 2) * vibAmp * 0.35;
    }
  }

  handleResize(aspect: number): void {
    this.camera.aspect = aspect;
    this.camera.updateProjectionMatrix();
  }
}

const X_AXIS = new THREE.Vector3(1, 0, 0);
