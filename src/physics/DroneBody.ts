import RAPIER from '@dimforge/rapier3d-compat';
import * as THREE from 'three';
import type { Settings } from '../types';

/** Rigid body дрона (компаунд-коллайдер: корпус + «пропеллеры») */
export class DroneBody {
  body!: RAPIER.RigidBody;

  create(world: RAPIER.World, pos: THREE.Vector3, yaw: number, settings: Settings): void {
    const desc = RAPIER.RigidBodyDesc.dynamic()
      .setTranslation(pos.x, pos.y, pos.z)
      .setCcdEnabled(true)
      .setLinearDamping(0)
      .setAngularDamping(0.6)
      .setCanSleep(false);
    const q = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), yaw);
    desc.setRotation({ x: q.x, y: q.y, z: q.z, w: q.w });
    this.body = world.createRigidBody(desc);

    // масса через плотность основного коллайдера
    const volume = 0.18 * 0.09 * 0.18; // м³
    const density = settings.massKg / volume;
    const hull = RAPIER.ColliderDesc.cuboid(0.09, 0.045, 0.09)
      .setDensity(density)
      .setFriction(0.5)
      .setRestitution(0.2);
    world.createCollider(hull, this.body);

    // «лучи» с пропеллерами — чтобы винты не проходили сквозь стены
    for (const [dx, dz] of [[1, 1], [1, -1], [-1, 1], [-1, -1]] as const) {
      const prop = RAPIER.ColliderDesc.cuboid(0.065, 0.012, 0.065)
        .setTranslation(dx * 0.115, 0.045, dz * 0.115)
        .setDensity(density * 0.05)
        .setFriction(0.4)
        .setRestitution(0.3);
      world.createCollider(prop, this.body);
    }
  }

  position(out: THREE.Vector3): THREE.Vector3 {
    const t = this.body.translation();
    return out.set(t.x, t.y, t.z);
  }

  quaternion(out: THREE.Quaternion): THREE.Quaternion {
    const r = this.body.rotation();
    return out.set(r.x, r.y, r.z, r.w);
  }

  velocity(out: THREE.Vector3): THREE.Vector3 {
    const v = this.body.linvel();
    return out.set(v.x, v.y, v.z);
  }

  angVel(out: THREE.Vector3): THREE.Vector3 {
    const v = this.body.angvel();
    return out.set(v.x, v.y, v.z);
  }

  /** Телепорт + обнуление скоростей */
  reset(pos: THREE.Vector3, yaw: number): void {
    const q = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), yaw);
    this.body.setTranslation({ x: pos.x, y: pos.y, z: pos.z }, true);
    this.body.setRotation({ x: q.x, y: q.y, z: q.z, w: q.w }, true);
    this.body.setLinvel({ x: 0, y: 0, z: 0 }, true);
    this.body.setAngvel({ x: 0, y: 0, z: 0 }, true);
  }
}
