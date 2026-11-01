import RAPIER from '@dimforge/rapier3d-compat';
import { Quaternion, Vector3 } from 'three';
import { PHYS } from '../config';

/** Обёртка над Rapier: статический мир, рейкасты, тело дрона */
export class WorldPhysics {
  world!: RAPIER.World;
  drone!: RAPIER.RigidBody;
  private droneColliders: RAPIER.Collider[] = [];
  private ray!: RAPIER.Ray;

  static async create(): Promise<WorldPhysics> {
    await RAPIER.init();
    const w = new WorldPhysics();
    w.world = new RAPIER.World({ x: 0, y: 0, z: 0 }); // гравитацию считает FlightModel
    w.ray = new RAPIER.Ray({ x: 0, y: 0, z: 0 }, { x: 0, y: -1, z: 0 });
    w.createDrone();
    return w;
  }

  setHz(hz: number) {
    this.world.timestep = 1 / hz;
  }

  private createDrone() {
    const desc = RAPIER.RigidBodyDesc.dynamic()
      .setTranslation(0, 0.1, 0)
      .setCcdEnabled(true)
      .setCanSleep(false)
      .setAngularDamping(0);
    this.drone = this.world.createRigidBody(desc);
    const add = (d: RAPIER.ColliderDesc) => {
      d.setMass(0.18).setFriction(0.8).setRestitution(0.18);
      this.droneColliders.push(this.world.createCollider(d, this.drone));
    };
    // корпус
    add(RAPIER.ColliderDesc.cuboid(0.055, 0.03, 0.1));
    // опоры/моторы и диски винтов (7")
    for (const sx of [-1, 1]) {
      for (const sz of [-1, 1]) {
        add(RAPIER.ColliderDesc.ball(0.03).setTranslation(sx * 0.12, -0.0, sz * 0.13));
        add(RAPIER.ColliderDesc.cylinder(0.008, PHYS.armRadius).setTranslation(sx * 0.12, 0.045, sz * 0.13));
      }
    }
  }

  setDroneDamping(passive: boolean) {
    this.drone.setAngularDamping(passive ? 2.5 : 0);
    this.drone.setLinearDamping(0);
  }

  teleportDrone(pos: Vector3, quat: Quaternion) {
    this.drone.setTranslation(pos, true);
    this.drone.setRotation(quat, true);
    this.drone.setLinvel({ x: 0, y: 0, z: 0 }, true);
    this.drone.setAngvel({ x: 0, y: 0, z: 0 }, true);
  }

  readDrone(pos: Vector3, quat: Quaternion, vel: Vector3, ang: Vector3) {
    const t = this.drone.translation();
    const r = this.drone.rotation();
    const v = this.drone.linvel();
    const a = this.drone.angvel();
    pos.set(t.x, t.y, t.z);
    quat.set(r.x, r.y, r.z, r.w);
    vel.set(v.x, v.y, v.z);
    ang.set(a.x, a.y, a.z);
  }

  writeDrone(vel: Vector3, ang: Vector3 | null) {
    this.drone.setLinvel(vel, true);
    if (ang) this.drone.setAngvel(ang, true);
  }

  step() {
    this.world.step();
  }

  // ---------- статический мир ----------
  addBox(x: number, y: number, z: number, hx: number, hy: number, hz: number, rotY = 0): RAPIER.Collider {
    const d = RAPIER.ColliderDesc.cuboid(hx, hy, hz)
      .setTranslation(x, y, z)
      .setRotation({ x: 0, y: Math.sin(rotY / 2), z: 0, w: Math.cos(rotY / 2) })
      .setFriction(0.9)
      .setRestitution(0.1);
    return this.world.createCollider(d);
  }

  addDesc(d: RAPIER.ColliderDesc): RAPIER.Collider {
    d.setFriction(0.9).setRestitution(0.1);
    return this.world.createCollider(d);
  }

  addTrimesh(vertices: Float32Array, indices: Uint32Array) {
    return this.world.createCollider(RAPIER.ColliderDesc.trimesh(vertices, indices).setFriction(0.9));
  }

  addConvex(points: Float32Array): RAPIER.Collider | null {
    const d = RAPIER.ColliderDesc.convexHull(points);
    return d ? this.addDesc(d) : null;
  }

  createKinematic(x: number, y: number, z: number): RAPIER.RigidBody {
    return this.world.createRigidBody(RAPIER.RigidBodyDesc.kinematicPositionBased().setTranslation(x, y, z));
  }

  removeCollider(c: RAPIER.Collider) {
    this.world.removeCollider(c, true);
  }

  removeBody(b: RAPIER.RigidBody) {
    this.world.removeRigidBody(b);
  }

  static get R() {
    return RAPIER;
  }

  /** Луч в мир (без дрона). Возвращает расстояние до первого препятствия или -1 */
  raycast(o: Vector3, dir: Vector3, maxDist: number): number {
    this.ray.origin.x = o.x;
    this.ray.origin.y = o.y;
    this.ray.origin.z = o.z;
    this.ray.dir.x = dir.x;
    this.ray.dir.y = dir.y;
    this.ray.dir.z = dir.z;
    const hit = this.world.castRay(this.ray, maxDist, true, undefined, undefined, undefined, this.drone);
    return hit ? hit.timeOfImpact : -1;
  }
}
