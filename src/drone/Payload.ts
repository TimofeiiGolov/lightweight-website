import { ConeGeometry, CylinderGeometry, Group, Mesh, MeshLambertMaterial, Vector3 } from 'three';
import { PHYS } from '../config';
import type { WorldPhysics } from '../physics/WorldPhysics';
import { terrainHeight } from '../utils/MathUtils';
import type { Target, Targets } from '../world/Targets';

export interface PayloadImpact {
  pos: Vector3;
  direct: Target | null;
}

interface Item {
  mesh: Group;
  pos: Vector3;
  vel: Vector3;
  age: number;
}

/**
 * Условная «полезная нагрузка» (учебный макет): лёгкий баллистический снаряд.
 * Никаких реальных характеристик — только игровая механика: падение, контакт, визуальный эффект и очки.
 */
export class PayloadSystem {
  group = new Group();
  private items: Item[] = [];
  private pool: Group[] = [];
  private dir = new Vector3();
  private prev = new Vector3();

  constructor(
    private phys: WorldPhysics,
    private targets: Targets,
    private onImpact: (i: PayloadImpact) => void,
  ) {
    const mat = new MeshLambertMaterial({ color: 0x59633f });
    const red = new MeshLambertMaterial({ color: 0xb8302a });
    for (let i = 0; i < 6; i++) {
      const g = new Group();
      const body = new Mesh(new CylinderGeometry(0.05, 0.05, 0.24, 10), mat);
      const nose = new Mesh(new ConeGeometry(0.05, 0.08, 10), red);
      nose.position.y = 0.16;
      g.add(body, nose);
      g.visible = false;
      this.group.add(g);
      this.pool.push(g);
    }
  }

  get pending() {
    return this.items.length;
  }

  drop(pos: Vector3, vel: Vector3) {
    const mesh = this.pool.find((g) => !g.visible);
    if (!mesh) return;
    mesh.visible = true;
    this.items.push({ mesh, pos: pos.clone(), vel: vel.clone(), age: 0 });
  }

  clear() {
    for (const it of this.items) it.mesh.visible = false;
    this.items.length = 0;
  }

  update(dt: number) {
    const h = 1 / 120;
    let n = Math.max(1, Math.round(dt / h));
    n = Math.min(n, 6);
    for (let k = this.items.length - 1; k >= 0; k--) {
      const it = this.items[k];
      let done = false;
      for (let s = 0; s < n && !done; s++) {
        this.prev.copy(it.pos);
        it.vel.y -= PHYS.gravity * h;
        it.vel.multiplyScalar(1 - 0.04 * h);
        it.pos.addScaledVector(it.vel, h);
        // прямое попадание в цель
        const t = this.targets.segmentHit(this.prev, it.pos);
        if (t) {
          this.finish(it, k, it.pos, t);
          done = true;
          break;
        }
        // мир (здания, деревья, земля)
        this.dir.copy(it.pos).sub(this.prev);
        const len = this.dir.length();
        if (len > 1e-5) {
          this.dir.divideScalar(len);
          const d = this.phys.raycast(this.prev, this.dir, len + 0.05);
          if (d >= 0) {
            it.pos.copy(this.prev).addScaledVector(this.dir, d);
            this.finish(it, k, it.pos, null);
            done = true;
            break;
          }
        }
        if (it.pos.y <= terrainHeight(it.pos.x, it.pos.z) + 0.05) {
          it.pos.y = terrainHeight(it.pos.x, it.pos.z) + 0.1;
          this.finish(it, k, it.pos, null);
          done = true;
          break;
        }
      }
      if (done) continue;
      it.age += dt;
      it.mesh.position.copy(it.pos);
      this.dir.copy(it.vel).normalize();
      it.mesh.quaternion.setFromUnitVectors(new Vector3(0, 1, 0), this.dir);
      if (it.age > 20) {
        it.mesh.visible = false;
        this.items.splice(k, 1);
      }
    }
  }

  private finish(it: Item, idx: number, pos: Vector3, direct: Target | null) {
    it.mesh.visible = false;
    this.items.splice(idx, 1);
    this.onImpact({ pos: pos.clone(), direct });
  }

  /** Прогноз точки падения (для прицельной метки CCIP-стиля) */
  predict(pos: Vector3, vel: Vector3, out: Vector3): boolean {
    let x = pos.x,
      y = pos.y,
      z = pos.z,
      vx = vel.x,
      vy = vel.y,
      vz = vel.z;
    const h = 0.05;
    for (let i = 0; i < 160; i++) {
      vy -= PHYS.gravity * h;
      x += vx * h;
      y += vy * h;
      z += vz * h;
      if (y <= terrainHeight(x, z)) {
        out.set(x, terrainHeight(x, z), z);
        return true;
      }
    }
    return false;
  }
}
