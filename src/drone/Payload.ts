import * as THREE from 'three';
import { PAYLOAD } from '../config';
import { segmentHitsAABB } from '../utils/MathUtils';

export interface PayloadDropResult {
  point: THREE.Vector3;
  onGround: boolean;
}

/**
 * Условный учебный груз: баллистический снаряд.
 * Интегрируется вручную (гравитация + сопротивление), коллизии —
 * отрезок шага против AABB зданий и земли. Взрыв обрабатывает Game.
 */
export class Payload {
  active = false;      // летит
  ready = true;        // доступен для сброса
  rearmT = 0;

  readonly mesh: THREE.Group;
  private pos = new THREE.Vector3();
  private vel = new THREE.Vector3();
  private prev = new THREE.Vector3();
  private matBody: THREE.MeshStandardMaterial;

  constructor() {
    this.matBody = new THREE.MeshStandardMaterial({ color: 0x2f3a22, roughness: 0.8 });
    this.mesh = new THREE.Group();
    const body = new THREE.Mesh(new THREE.CapsuleGeometry(0.05, 0.14, 4, 10), this.matBody);
    this.mesh.add(body);
    for (const a of [0, Math.PI / 2, Math.PI, (3 * Math.PI) / 2]) {
      const fin = new THREE.Mesh(new THREE.BoxGeometry(0.01, 0.07, 0.04), this.matBody);
      fin.position.set(Math.sin(a) * 0.04, -0.09, Math.cos(a) * 0.04);
      fin.rotation.y = a;
      this.mesh.add(fin);
    }
    this.mesh.visible = false;
  }

  drop(fromPos: THREE.Vector3, fromVel: THREE.Vector3, droneQuat: THREE.Quaternion): boolean {
    if (!this.ready || this.active) return false;
    this.active = true;
    this.ready = false;
    this.pos.copy(fromPos);
    this.pos.y -= 0.12;
    this.vel.copy(fromVel);
    this.vel.y -= 1.0;
    this.prev.copy(this.pos);
    this.mesh.position.copy(this.pos);
    this.mesh.quaternion.copy(droneQuat);
    this.mesh.visible = true;
    return true;
  }

  /**
   * Шаг интегрирования. Возвращает точку взрыва или null.
   * boxes — AABB зданий/техники (уже расширенные на радиус груза).
   */
  update(dt: number, boxes: THREE.Box3[]): PayloadDropResult | null {
    if (!this.active) return null;
    this.prev.copy(this.pos);
    this.vel.y -= 9.81 * dt;
    this.vel.multiplyScalar(1 - PAYLOAD.dragK * dt * 60 * dt); // лёгкое сопротивление
    this.pos.addScaledVector(this.vel, dt);

    // ориентация по скорости
    if (this.vel.lengthSq() > 0.5) {
      const targetQ = new THREE.Quaternion().setFromUnitVectors(
        new THREE.Vector3(0, 1, 0),
        this.vel.clone().normalize()
      );
      this.mesh.quaternion.slerp(targetQ, Math.min(1, dt * 6));
    }
    this.mesh.position.copy(this.pos);

    // земля
    if (this.pos.y <= 0.1) {
      this.pos.y = 0.1;
      return this.explode(true);
    }
    // здания
    const dx = this.pos.x - this.prev.x;
    const dy = this.pos.y - this.prev.y;
    const dz = this.pos.z - this.prev.z;
    const len = Math.sqrt(dx * dx + dy * dy + dz * dz);
    if (len > 1e-6) {
      for (const b of boxes) {
        if (segmentHitsAABB(this.prev.x, this.prev.y, this.prev.z, dx, dy, dz, len, b)) {
          return this.explode(false);
        }
      }
    }
    // страховка по времени
    if (this.pos.y < -5 || Math.abs(this.pos.x) > 400 || Math.abs(this.pos.z) > 400) {
      return this.explode(false);
    }
    return null;
  }

  private explode(onGround: boolean): PayloadDropResult {
    this.active = false;
    this.mesh.visible = false;
    this.rearmT = PAYLOAD.rearmSec;
    return { point: this.pos.clone(), onGround };
  }

  /** перезарядка */
  tick(dt: number): void {
    if (!this.ready && !this.active) {
      this.rearmT -= dt;
      if (this.rearmT <= 0) this.ready = true;
    }
  }
}
