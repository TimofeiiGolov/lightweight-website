import RAPIER from '@dimforge/rapier3d-compat';
import * as THREE from 'three';
import { PHYS } from '../config';

/** Обёртка над физическим миром Rapier */
export class WorldPhysics {
  world!: RAPIER.World;
  ready = false;

  async init(): Promise<void> {
    await RAPIER.init();
    this.world = new RAPIER.World({ x: 0, y: -PHYS.gravity, z: 0 });
    this.world.timestep = 1 / PHYS.stepHz;
    this.ready = true;
  }

  step(): void {
    this.world.step();
  }

  /** Статичный AABB-коллайдер (здания, техника, бункер) */
  addStaticBox(x: number, y: number, z: number, hx: number, hy: number, hz: number, yaw = 0): void {
    const body = this.world.createRigidBody(RAPIER.RigidBodyDesc.fixed());
    const q = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), yaw);
    const col = RAPIER.ColliderDesc.cuboid(hx, hy, hz)
      .setTranslation(x, y, z)
      .setRotation({ x: q.x, y: q.y, z: q.z, w: q.w })
      .setFriction(0.9)
      .setRestitution(0.1);
    this.world.createCollider(col, body);
  }

  /** Статичный цилиндр (стволы, столбы) — аппроксимация боксом */
  addStaticCylinder(x: number, y: number, z: number, radius: number, halfHeight: number): void {
    this.addStaticBox(x, y, z, radius, halfHeight, radius, 0);
  }

  /** Земля — один большой бокс */
  addGround(halfSize: number): void {
    const body = this.world.createRigidBody(RAPIER.RigidBodyDesc.fixed());
    const col = RAPIER.ColliderDesc.cuboid(halfSize, 0.5, halfSize)
      .setTranslation(0, -0.5, 0)
      .setFriction(0.95)
      .setRestitution(0.05);
    this.world.createCollider(col, body);
  }
}
