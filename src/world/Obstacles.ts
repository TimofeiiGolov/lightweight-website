import {
  AdditiveBlending,
  BoxGeometry,
  Color,
  CylinderGeometry,
  DoubleSide,
  Group,
  IcosahedronGeometry,
  Mesh,
  MeshBasicMaterial,
  RingGeometry,
  CircleGeometry,
  TorusGeometry,
  Vector3,
} from 'three';
import type { GateDef, ZoneDef } from './Level';

const COL_PENDING = new Color(0xff8a1f);
const COL_NEXT = new Color(0x2dffd0);
const COL_DONE = new Color(0x55ff55);

/** Ворота для слалома: кольца с проверкой пролёта */
export class Gates {
  group = new Group();
  passed = 0;
  active = false;
  private meshes: Mesh[] = [];
  private mats: MeshBasicMaterial[] = [];

  constructor(private defs: GateDef[]) {
    const post = new BoxGeometry(0.16, 1, 0.16);
    for (const d of defs) {
      const mat = new MeshBasicMaterial({ color: COL_PENDING });
      const ring = new Mesh(new TorusGeometry(d.radius, 0.16, 8, 32), mat);
      ring.position.copy(d.pos);
      ring.lookAt(d.pos.clone().add(d.normal));
      this.group.add(ring);
      const p = new Mesh(post, new MeshBasicMaterial({ color: 0x333333 }));
      const h = Math.max(0.1, d.pos.y - d.radius);
      p.scale.y = h;
      p.position.set(d.pos.x, h / 2, d.pos.z);
      this.group.add(p);
      this.meshes.push(ring);
      this.mats.push(mat);
    }
    this.group.visible = false;
  }

  get total() {
    return this.defs.length;
  }

  setActive(on: boolean) {
    this.active = on;
    this.group.visible = on;
    this.reset();
  }

  reset() {
    this.passed = 0;
    this.refresh();
  }

  private refresh() {
    this.mats.forEach((m, i) => m.color.copy(i < this.passed ? COL_DONE : i === this.passed ? COL_NEXT : COL_PENDING));
  }

  get next(): GateDef | null {
    return this.passed < this.defs.length ? this.defs[this.passed] : null;
  }

  /** true — если очередные ворота только что пройдены */
  check(prev: Vector3, cur: Vector3): boolean {
    if (!this.active || this.passed >= this.defs.length) return false;
    const d = this.defs[this.passed];
    const sp = (prev.x - d.pos.x) * d.normal.x + (prev.z - d.pos.z) * d.normal.z;
    const sc = (cur.x - d.pos.x) * d.normal.x + (cur.z - d.pos.z) * d.normal.z;
    if (sp * sc > 0 || sp === sc) return false;
    const t = sp / (sp - sc);
    const x = prev.x + (cur.x - prev.x) * t;
    const y = prev.y + (cur.y - prev.y) * t;
    const z = prev.z + (cur.z - prev.z) * t;
    if (Math.hypot(x - d.pos.x, y - d.pos.y, z - d.pos.z) < d.radius) {
      this.passed++;
      this.refresh();
      return true;
    }
    return false;
  }

  pulse(t: number) {
    if (!this.active || this.passed >= this.meshes.length) return;
    const s = 1 + Math.sin(t * 6) * 0.04;
    this.meshes[this.passed].scale.setScalar(s);
  }
}

/** Круглые зоны на земле с маяком: зоны сброса и посадочные площадки */
export class ZoneMarkers {
  group = new Group();
  private items: { def: ZoneDef; g: Group; beam: MeshBasicMaterial }[] = [];

  constructor(defs: ZoneDef[], color: number, beaconH = 70) {
    for (const d of defs) {
      const g = new Group();
      const ring = new Mesh(new RingGeometry(d.radius - 0.5, d.radius, 48), new MeshBasicMaterial({ color, side: DoubleSide, transparent: true, opacity: 0.95 }));
      ring.rotation.x = -Math.PI / 2;
      ring.position.y = 0.2;
      const disc = new Mesh(new CircleGeometry(d.radius, 40), new MeshBasicMaterial({ color, transparent: true, opacity: 0.18, side: DoubleSide }));
      disc.rotation.x = -Math.PI / 2;
      disc.position.y = 0.18;
      const beamMat = new MeshBasicMaterial({ color, transparent: true, opacity: 0.2, blending: AdditiveBlending, depthWrite: false, side: DoubleSide, fog: false });
      const beam = new Mesh(new CylinderGeometry(d.radius * 0.35, d.radius * 0.35, beaconH, 14, 1, true), beamMat);
      beam.position.y = beaconH / 2;
      g.add(ring, disc, beam);
      g.position.set(d.pos.x, 0, d.pos.z);
      g.visible = false;
      this.group.add(g);
      this.items.push({ def: d, g, beam: beamMat });
    }
  }

  setActive(ids: string[]) {
    for (const it of this.items) it.g.visible = ids.includes(it.def.id);
  }

  update(t: number) {
    for (const it of this.items) if (it.g.visible) it.beam.opacity = 0.16 + Math.sin(t * 3) * 0.05;
  }
}

/** Точка для теста висения */
export class HoverMarker {
  mesh: Mesh;
  radius = 2;
  constructor(pos: Vector3) {
    this.mesh = new Mesh(new IcosahedronGeometry(this.radius, 1), new MeshBasicMaterial({ color: 0x2dffd0, wireframe: true, transparent: true, opacity: 0.8, fog: false }));
    this.mesh.position.copy(pos);
    this.mesh.visible = false;
  }
  setInside(inside: boolean) {
    (this.mesh.material as MeshBasicMaterial).color.setHex(inside ? 0x55ff55 : 0x2dffd0);
  }
}
