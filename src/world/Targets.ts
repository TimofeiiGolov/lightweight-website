import type { Collider, RigidBody } from '@dimforge/rapier3d-compat';
import {
  BoxGeometry,
  BufferGeometry,
  CanvasTexture,
  CylinderGeometry,
  Group,
  InstancedMesh,
  Matrix4,
  Mesh,
  MeshBasicMaterial,
  MeshLambertMaterial,
  OctahedronGeometry,
  PlaneGeometry,
  Quaternion,
  SphereGeometry,
  SRGBColorSpace,
  Vector3,
} from 'three';
import { WorldPhysics } from '../physics/WorldPhysics';
import { damp } from '../utils/MathUtils';
import type { TargetDef, TargetGroup, TargetKind } from './Level';

const KIND = {
  shield: { radius: 1.3, points: 100, cy: 1.4, half: [0.7, 0.9, 0.1] as const, label: 'ЩИТ' },
  mannequin: { radius: 1.1, points: 100, cy: 1.0, half: [0.3, 1.0, 0.25] as const, label: 'ЦЕЛЬ' },
  barrel: { radius: 1.0, points: 80, cy: 0.5, half: [0.3, 0.5, 0.3] as const, label: 'БОЧКА' },
  truck: { radius: 3.2, points: 200, cy: 1.2, half: [3.0, 1.2, 1.25] as const, label: 'ГРУЗОВИК' },
  cart: { radius: 2.2, points: 250, cy: 0.9, half: [1.6, 0.9, 0.95] as const, label: 'ТЕХНИКА' },
  infantry: { radius: 1.1, points: 150, cy: 1.0, half: [0.3, 1.0, 0.25] as const, label: 'ПЕХОТА' },
};

function ringTexture(): CanvasTexture {
  const c = document.createElement('canvas');
  c.width = c.height = 128;
  const g = c.getContext('2d')!;
  g.fillStyle = '#e9e4d2';
  g.fillRect(0, 0, 128, 128);
  const cols = ['#c0392b', '#e9e4d2', '#c0392b', '#e9e4d2', '#222'];
  cols.forEach((col, i) => {
    g.fillStyle = col;
    g.beginPath();
    g.arc(64, 64, 60 - i * 12, 0, Math.PI * 2);
    g.fill();
  });
  const t = new CanvasTexture(c);
  t.colorSpace = SRGBColorSpace;
  return t;
}

// общие геометрии и материалы (минимум draw-call'ов и памяти)
const G = {
  box: new BoxGeometry(1, 1, 1),
  cyl: new CylinderGeometry(1, 1, 1, 10),
  sph: new SphereGeometry(1, 10, 8),
  plane: new PlaneGeometry(1, 1),
};
const M = {
  khaki: new MeshLambertMaterial({ color: 0x8c8460 }),
  vest: new MeshLambertMaterial({ color: 0xb04a2e }),
  wood: new MeshLambertMaterial({ color: 0x77593a }),
  red: new MeshLambertMaterial({ color: 0xb5342a }),
  yellow: new MeshLambertMaterial({ color: 0xd9b52b }),
  olive: new MeshLambertMaterial({ color: 0x5b6540 }),
  oliveD: new MeshLambertMaterial({ color: 0x3c4430 }),
  metal: new MeshLambertMaterial({ color: 0x4a5057 }),
  orange: new MeshLambertMaterial({ color: 0xd9792b }),
  char: new MeshLambertMaterial({ color: 0x151515 }),
};
let ringMat: MeshLambertMaterial | null = null;

function part(parent: Group, geo: BufferGeometry, mat: MeshLambertMaterial, x: number, y: number, z: number, sx: number, sy: number, sz: number) {
  const m = new Mesh(geo, mat);
  m.position.set(x, y, z);
  m.scale.set(sx, sy, sz);
  m.castShadow = true;
  parent.add(m);
  return m;
}

function buildMesh(kind: TargetKind): Group {
  const g = new Group();
  switch (kind) {
    case 'shield': {
      ringMat ??= new MeshLambertMaterial({ map: ringTexture() });
      part(g, G.box, M.wood, 0, 1.4, 0, 1.4, 1.8, 0.08);
      const face = new Mesh(G.plane, ringMat);
      face.scale.set(1.3, 1.7, 1);
      face.position.set(0, 1.4, 0.05);
      g.add(face);
      part(g, G.box, M.wood, -0.5, 0.25, 0, 0.1, 0.6, 0.1);
      part(g, G.box, M.wood, 0.5, 0.25, 0, 0.1, 0.6, 0.1);
      break;
    }
    case 'mannequin':
    case 'infantry': {
      part(g, G.box, M.khaki, -0.12, 0.45, 0, 0.18, 0.9, 0.2); // ноги
      part(g, G.box, M.khaki, 0.12, 0.45, 0, 0.18, 0.9, 0.2);
      part(g, G.box, M.vest, 0, 1.25, 0, 0.5, 0.7, 0.3); // торс
      part(g, G.box, M.khaki, -0.34, 1.2, 0, 0.14, 0.6, 0.16);
      part(g, G.box, M.khaki, 0.34, 1.2, 0, 0.14, 0.6, 0.16);
      part(g, G.sph, M.khaki, 0, 1.78, 0, 0.17, 0.2, 0.17);
      if (kind === 'infantry') part(g, G.box, M.metal, 0, 0.04, 0, 1.0, 0.08, 0.8);
      break;
    }
    case 'barrel':
      part(g, G.cyl, M.red, 0, 0.45, 0, 0.3, 0.9, 0.3);
      part(g, G.cyl, M.yellow, 0, 0.45, 0, 0.31, 0.12, 0.31);
      break;
    case 'truck':
      part(g, G.box, M.metal, 0, 0.55, 0, 6.2, 0.4, 2.3);
      part(g, G.box, M.olive, -1.2, 1.5, 0, 3.8, 1.8, 2.3);
      part(g, G.box, M.olive, 2.2, 1.3, 0, 1.8, 1.7, 2.3);
      part(g, G.box, M.orange, -1.2, 2.45, 0, 3.0, 0.08, 1.8);
      part(g, G.box, M.metal, 3.1, 1.8, 0, 0.1, 0.7, 2.0);
      for (const sx of [-2, 2.2]) for (const sz of [-1.2, 1.2]) {
        const w = part(g, G.cyl, M.char, sx, 0.55, sz, 0.55, 0.45, 0.55);
        w.rotation.x = Math.PI / 2;
      }
      break;
    case 'cart':
      part(g, G.box, M.olive, 0, 0.7, 0, 3.2, 0.8, 1.6);
      part(g, G.box, M.oliveD, 0, 0.35, -0.9, 3.4, 0.7, 0.45);
      part(g, G.box, M.oliveD, 0, 0.35, 0.9, 3.4, 0.7, 0.45);
      part(g, G.box, M.olive, -0.2, 1.3, 0, 1.4, 0.6, 1.2);
      part(g, G.box, M.metal, 1.2, 1.35, 0, 1.6, 0.12, 0.12);
      part(g, G.box, M.orange, -0.2, 1.62, 0, 0.8, 0.05, 0.8);
      break;
  }
  return g;
}

export class Target {
  readonly radius: number;
  readonly points: number;
  readonly label: string;
  readonly mesh: Group;
  alive = true;
  active = false;
  pos = new Vector3();
  smoke = 0;
  private collider: Collider | null = null;
  private body: RigidBody | null = null;
  private pathLen = 0;
  private yaw = 0;
  private fall = 0;
  private baseY = 0;

  constructor(
    public def: TargetDef,
    phys: WorldPhysics,
    private readonly rot0: number,
  ) {
    const k = KIND[def.kind];
    this.radius = k.radius;
    this.points = k.points;
    this.label = k.label;
    this.mesh = buildMesh(def.kind);
    this.mesh.visible = false;
    this.yaw = rot0;
    this.mesh.rotation.y = rot0;
    this.mesh.position.set(def.x, 0, def.z);
    this.pos.set(def.x, k.cy, def.z);
    this.baseY = k.cy;
    const R = WorldPhysics.R;
    const desc = R.ColliderDesc.cuboid(k.half[0], k.half[1], k.half[2]).setFriction(0.8);
    if (def.path) {
      const [a, b] = def.path;
      this.pathLen = Math.hypot(b[0] - a[0], b[1] - a[1]);
      this.body = phys.createKinematic(def.x, k.cy, def.z);
      this.collider = phys.world.createCollider(desc, this.body);
    } else {
      desc.setTranslation(def.x, k.cy, def.z).setRotation({ x: 0, y: Math.sin(rot0 / 2), z: 0, w: Math.cos(rot0 / 2) });
      this.collider = phys.world.createCollider(desc);
    }
    this.collider.setEnabled(false);
  }

  get moving() {
    return !!this.def.path;
  }

  setActive(on: boolean) {
    this.active = on;
    this.mesh.visible = on;
    this.collider?.setEnabled(on && this.alive);
  }

  reset() {
    this.alive = true;
    this.smoke = 0;
    this.fall = 0;
    this.mesh.rotation.set(0, this.rot0, 0);
    this.mesh.position.y = 0;
    this.mesh.traverse((o) => {
      const m = o as Mesh;
      if (m.isMesh && m.userData.orig) m.material = m.userData.orig;
    });
    this.collider?.setEnabled(this.active);
  }

  destroy() {
    if (!this.alive) return;
    this.alive = false;
    this.smoke = 14;
    this.collider?.setEnabled(false);
    this.mesh.traverse((o) => {
      const m = o as Mesh;
      if (m.isMesh) {
        m.userData.orig ??= m.material;
        m.material = M.char;
      }
    });
  }

  /** Фиксированный шаг: движение по маршруту (кинематическое тело) */
  step(time: number) {
    if (!this.def.path || !this.alive || !this.active) return;
    const [a, b] = this.def.path;
    const L = this.pathLen;
    const speed = this.def.speed ?? 3;
    const d = (((this.def.phase ?? 0) * 2 * L + time * speed) % (2 * L) + 2 * L) % (2 * L);
    const fwd = d < L;
    const s = (fwd ? d : 2 * L - d) / L;
    const x = a[0] + (b[0] - a[0]) * s;
    const z = a[1] + (b[1] - a[1]) * s;
    this.pos.set(x, this.baseY, z);
    const dirx = (b[0] - a[0]) * (fwd ? 1 : -1);
    const dirz = (b[1] - a[1]) * (fwd ? 1 : -1);
    this.targetYaw = Math.atan2(-dirz, dirx);
    this.body?.setNextKinematicTranslation({ x, y: this.baseY, z });
  }
  private targetYaw = 0;

  render(dt: number) {
    if (!this.active) return;
    if (this.moving) {
      let dy = this.targetYaw - this.yaw;
      dy = Math.atan2(Math.sin(dy), Math.cos(dy));
      this.yaw += dy * Math.min(1, dt * 5);
      this.mesh.rotation.y = this.yaw;
      this.mesh.position.set(this.pos.x, 0, this.pos.z);
    }
    if (!this.alive) {
      this.fall = damp(this.fall, 1, 6, dt);
      const m = this.def.kind === 'mannequin' || this.def.kind === 'infantry';
      this.mesh.rotation.x = this.fall * (m ? -1.4 : -0.12);
      this.mesh.rotation.z = this.fall * (m ? 0 : 0.1);
      this.mesh.position.y = this.fall * (m ? 0.2 : -0.1);
    }
  }
}

export class Targets {
  group = new Group();
  list: Target[] = [];
  private markers: InstancedMesh;
  private time = 0;
  private m4 = new Matrix4();
  private q = new Quaternion();
  private v = new Vector3();
  private s = new Vector3();

  constructor(defs: TargetDef[], phys: WorldPhysics) {
    for (const d of defs) {
      const t = new Target(d, phys, d.rot);
      this.list.push(t);
      this.group.add(t.mesh);
    }
    this.markers = new InstancedMesh(
      new OctahedronGeometry(0.7, 0),
      new MeshBasicMaterial({ color: 0xff7a1a, fog: false }),
      this.list.length,
    );
    this.markers.frustumCulled = false;
    this.markers.count = 0;
    this.group.add(this.markers);
  }

  setActiveGroups(groups: TargetGroup[]) {
    for (const t of this.list) t.setActive(groups.includes(t.def.group));
  }

  reset() {
    this.time = 0;
    for (const t of this.list) t.reset();
  }

  /** Фиксированный шаг физики */
  step(dt: number) {
    this.time += dt;
    for (const t of this.list) if (t.moving) t.step(this.time);
  }

  render(dt: number, clock: number) {
    let n = 0;
    for (const t of this.list) {
      t.render(dt);
      if (t.active && t.alive) {
        const bob = Math.sin(clock * 2.5 + n) * 0.25;
        this.v.set(t.pos.x, t.pos.y + t.radius + 1.6 + bob, t.pos.z);
        this.q.setFromAxisAngle(this.s.set(0, 1, 0), clock * 2 + n);
        this.s.set(0.8, 1.3, 0.8);
        this.m4.compose(this.v, this.q, this.s);
        this.markers.setMatrixAt(n++, this.m4);
      }
    }
    this.markers.count = n;
    this.markers.instanceMatrix.needsUpdate = true;
  }

  activeAlive(): Target[] {
    return this.list.filter((t) => t.active && t.alive);
  }

  /** Подрыв условной нагрузки: поражает цели в радиусе (расстояние до центра минус размер цели) */
  blast(center: Vector3, radius: number): Target[] {
    const hit: Target[] = [];
    for (const t of this.list) {
      if (!t.active || !t.alive) continue;
      if (t.pos.distanceTo(center) - t.radius * 0.6 <= radius) {
        t.destroy();
        hit.push(t);
      }
    }
    return hit;
  }

  /** Прямое попадание: отрезок a->b пересекает сферу цели */
  segmentHit(a: Vector3, b: Vector3): Target | null {
    const ab = this.v.copy(b).sub(a);
    const len2 = ab.lengthSq();
    let best: Target | null = null;
    let bestT = 2;
    for (const t of this.list) {
      if (!t.active || !t.alive) continue;
      const s = this.s.copy(t.pos).sub(a);
      const k = len2 > 0 ? Math.max(0, Math.min(1, s.dot(ab) / len2)) : 0;
      const dx = a.x + ab.x * k - t.pos.x;
      const dy = a.y + ab.y * k - t.pos.y;
      const dz = a.z + ab.z * k - t.pos.z;
      if (dx * dx + dy * dy + dz * dz < t.radius * t.radius && k < bestT) {
        best = t;
        bestT = k;
      }
    }
    return best;
  }

  nearest(p: Vector3): Target | null {
    let best: Target | null = null;
    let bd = Infinity;
    for (const t of this.list) {
      if (!t.active || !t.alive) continue;
      const d = t.pos.distanceToSquared(p);
      if (d < bd) {
        bd = d;
        best = t;
      }
    }
    return best;
  }
}
