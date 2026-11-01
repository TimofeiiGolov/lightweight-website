import * as THREE from 'three';
import { SCORE } from '../config';

export interface TargetDef {
  kind: 'board' | 'mannequin' | 'barrel' | 'car' | 'walker';
  pos: [number, number];      // x, z
  yaw?: number;
  waypoints?: Array<[number, number]>;
  speed?: number;
}

interface TargetState {
  id: number;
  kind: TargetDef['kind'];
  group: THREE.Group;
  basePos: THREE.Vector3;
  radius: number;
  alive: boolean;
  points: number;
  // движение
  waypoints: THREE.Vector3[];
  wpIndex: number;
  speed: number;
  // анимация разрушения
  dying: number; // 0..1
  highlight: boolean;
  mats: THREE.MeshStandardMaterial[];
}

/**
 * Мишени полигона: щиты, манекены, бочки (статичные) и машины/пехота
 * на маршрутах (движущиеся). Разрушение — падение + затемнение,
 * восстановление через restoreAll().
 */
export class Targets {
  readonly group = new THREE.Group();
  list: TargetState[] = [];
  private charred: THREE.MeshStandardMaterial;
  private disposables: Array<{ dispose(): void }> = [];

  constructor() {
    this.charred = new THREE.MeshStandardMaterial({ color: 0x1a1a16, roughness: 1 });
    this.disposables.push(this.charred);
  }

  spawn(defs: TargetDef[]): void {
    for (const def of defs) {
      const g = new THREE.Group();
      const mats: THREE.MeshStandardMaterial[] = [];
      let radius = 1.1;
      let points: number = SCORE.targetStatic;

      if (def.kind === 'board') {
        const post = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.09, 1.6, 6), this.mkMat(mats, 0x5a4632));
        post.position.y = 0.8;
        const faceGeo = new THREE.CircleGeometry(0.85, 24);
        const faceMat = this.mkMat(mats, 0xd8d2c0);
        const face = new THREE.Mesh(faceGeo, faceMat);
        face.position.y = 2.0;
        // кольца
        const ring1 = new THREE.Mesh(new THREE.RingGeometry(0.5, 0.62, 24), this.mkMat(mats, 0xc23b2e));
        ring1.position.y = 2.0;
        ring1.position.z = 0.005;
        const ring2 = new THREE.Mesh(new THREE.RingGeometry(0.2, 0.3, 20), this.mkMat(mats, 0xc23b2e));
        ring2.position.y = 2.0;
        ring2.position.z = 0.006;
        g.add(post, face, ring1, ring2);
        g.position.set(def.pos[0], 0, def.pos[1]);
        g.rotation.y = def.yaw ?? 0;
        radius = 1.0;
      } else if (def.kind === 'mannequin') {
        const body = new THREE.Mesh(new THREE.CapsuleGeometry(0.32, 0.85, 4, 10), this.mkMat(mats, 0xd07a28));
        body.position.y = 1.1;
        const head = new THREE.Mesh(new THREE.SphereGeometry(0.22, 10, 8), this.mkMat(mats, 0xd07a28));
        head.position.y = 1.85;
        const legs = new THREE.Mesh(new THREE.CapsuleGeometry(0.18, 0.6, 4, 8), this.mkMat(mats, 0x5a4632));
        legs.position.y = 0.35;
        g.add(body, head, legs);
        g.position.set(def.pos[0], 0, def.pos[1]);
        radius = 0.9;
      } else if (def.kind === 'barrel') {
        const b = new THREE.Mesh(new THREE.CylinderGeometry(0.42, 0.42, 1.0, 12), this.mkMat(mats, 0xa83226));
        b.position.y = 0.5;
        const stripe = new THREE.Mesh(new THREE.CylinderGeometry(0.43, 0.43, 0.18, 12), this.mkMat(mats, 0xd8d2c0));
        stripe.position.y = 0.55;
        g.add(b, stripe);
        g.position.set(def.pos[0], 0, def.pos[1]);
        radius = 0.7;
      } else if (def.kind === 'car') {
        const hull = new THREE.Mesh(new THREE.BoxGeometry(4.2, 1.2, 1.9), this.mkMat(mats, 0x46584a));
        hull.position.y = 0.9;
        const cab = new THREE.Mesh(new THREE.BoxGeometry(2.0, 0.9, 1.7), this.mkMat(mats, 0x3a4a3e));
        cab.position.set(-0.2, 1.85, 0);
        g.add(hull, cab);
        g.position.set(def.pos[0], 0, def.pos[1]);
        radius = 2.2;
        points = SCORE.targetMover;
      } else {
        // walker — пехотинец
        const body = new THREE.Mesh(new THREE.CapsuleGeometry(0.3, 0.8, 4, 10), this.mkMat(mats, 0x9a7a3a));
        body.position.y = 1.05;
        const head = new THREE.Mesh(new THREE.SphereGeometry(0.2, 10, 8), this.mkMat(mats, 0xc2a06a));
        head.position.y = 1.75;
        g.add(body, head);
        g.position.set(def.pos[0], 0, def.pos[1]);
        radius = 0.8;
        points = SCORE.targetMover;
      }

      const wps: THREE.Vector3[] = [];
      if (def.waypoints) {
        for (const [x, z] of def.waypoints) wps.push(new THREE.Vector3(x, 0, z));
      }

      const st: TargetState = {
        id: this.list.length,
        kind: def.kind,
        group: g,
        basePos: g.position.clone(),
        radius,
        alive: true,
        points,
        waypoints: wps,
        wpIndex: 0,
        speed: def.speed ?? 0,
        dying: 0,
        highlight: false,
        mats,
      };
      this.list.push(st);
      this.group.add(g);
    }
  }

  private mkMat(mats: THREE.MeshStandardMaterial[], color: number): THREE.MeshStandardMaterial {
    const m = new THREE.MeshStandardMaterial({ color, roughness: 0.85 });
    mats.push(m);
    this.disposables.push(m);
    return m;
  }

  /** Движущиеся мишени */
  update(dt: number): void {
    const t = performance.now() / 1000;
    for (const st of this.list) {
      if (!st.alive) {
        if (st.dying > 0 && st.dying < 1) {
          st.dying = Math.min(1, st.dying + dt * 2.2);
          st.group.rotation.z = (st.kind === 'barrel' ? 0.4 : 1.45) * st.dying;
        }
        continue;
      }
      if (st.highlight) {
        const pulse = 0.6 + 0.4 * Math.sin(t * 5);
        for (const m of st.mats) m.emissive.setRGB(0.55 * pulse, 0.28 * pulse, 0.05 * pulse);
      } else {
        for (const m of st.mats) if (m.emissive.r !== 0) m.emissive.setRGB(0, 0, 0);
      }
      if (st.waypoints.length >= 2) {
        const target = st.waypoints[st.wpIndex];
        const cur = st.group.position;
        const dx = target.x - cur.x;
        const dz = target.z - cur.z;
        const dist = Math.hypot(dx, dz);
        if (dist < 0.4) {
          st.wpIndex = (st.wpIndex + 1) % st.waypoints.length;
        } else {
          const step = Math.min(dist, st.speed * dt);
          cur.x += (dx / dist) * step;
          cur.z += (dz / dist) * step;
          st.group.rotation.y = Math.atan2(dx, dz);
          // лёгкое покачивание пехоты
          if (st.kind === 'walker') st.group.position.y = Math.abs(Math.sin(t * 7)) * 0.06;
        }
      }
    }
  }

  /**
   * Урон по радиусу (взрыв груза). Возвращает разрушенные цели.
   */
  damageRadius(center: THREE.Vector3, radius: number): TargetState[] {
    const destroyed: TargetState[] = [];
    for (const st of this.list) {
      if (!st.alive) continue;
      const d = Math.hypot(center.x - st.group.position.x, center.z - st.group.position.z);
      const dy = Math.abs(center.y - (st.group.position.y + 1));
      if (d < radius + st.radius && dy < radius + 2.5) {
        this.destroy(st);
        destroyed.push(st);
      }
    }
    return destroyed;
  }

  destroy(st: TargetState): void {
    st.alive = false;
    st.dying = 0.001;
    st.highlight = false;
    for (const m of st.mats) {
      m.color.multiplyScalar(0.25);
      m.emissive.setRGB(0, 0, 0);
    }
  }

  setHighlight(ids: Iterable<number>): void {
    for (const st of this.list) st.highlight = false;
    for (const id of ids) {
      const st = this.list[id];
      if (st && st.alive) st.highlight = true;
    }
  }

  restoreAll(): void {
    for (const st of this.list) {
      st.alive = true;
      st.dying = 0;
      st.highlight = false;
      st.group.rotation.z = 0;
      st.group.position.copy(st.basePos);
      if (st.waypoints.length >= 2) st.wpIndex = 0;
      // цвет восстановить нельзя дёшево (умножали) — пересоздаём цвет из kind
      this.restoreColors(st);
    }
  }

  private restoreColors(st: TargetState): void {
    // цвета совпадают с порядком создания в spawn()
    const palettes: Record<TargetDef['kind'], number[]> = {
      board: [0x5a4632, 0xd8d2c0, 0xc23b2e, 0xc23b2e],
      mannequin: [0xd07a28, 0xd07a28, 0x5a4632],
      barrel: [0xa83226, 0xd8d2c0],
      car: [0x46584a, 0x3a4a3e],
      walker: [0x9a7a3a, 0xc2a06a],
    };
    const pal = palettes[st.kind];
    st.mats.forEach((m, i) => {
      if (i < pal.length) m.color.setHex(pal[i]);
    });
  }

  aliveCount(): number {
    return this.list.filter((t) => t.alive).length;
  }

  dispose(scene: THREE.Scene): void {
    scene.remove(this.group);
    this.group.traverse((o) => {
      const m = o as THREE.Mesh;
      if (m.isMesh) m.geometry.dispose();
    });
    for (const d of this.disposables) d.dispose();
  }
}

/** Расстановка мишеней полигона */
export function defaultTargets(): TargetDef[] {
  return [
    // восточный стрелковый тракт (щиты) — 0..5
    { kind: 'board', pos: [34, -64], yaw: 0.15 },
    { kind: 'board', pos: [46, -70], yaw: 0.1 },
    { kind: 'board', pos: [58, -63], yaw: 0 },
    { kind: 'board', pos: [70, -72], yaw: -0.1 },
    { kind: 'board', pos: [82, -64], yaw: 0 },
    { kind: 'board', pos: [92, -58], yaw: 0.2 },
    // манекены у зданий — 6..9
    { kind: 'mannequin', pos: [63, -20] },
    { kind: 'mannequin', pos: [88, 16] },
    { kind: 'mannequin', pos: [-102, 44] },
    { kind: 'mannequin', pos: [-80, 28] },
    // бочки у бункера и разрушенных — 10..13
    { kind: 'barrel', pos: [90, -68] },
    { kind: 'barrel', pos: [99, -66] },
    { kind: 'barrel', pos: [-88, -20] },
    { kind: 'barrel', pos: [-70, 27] },
    // движущиеся: 2 машины на маршруте по южной дороге — 14..15
    {
      kind: 'car', pos: [-90, -80], speed: 7,
      waypoints: [[-110, -80], [90, -80], [90, -58], [-110, -58]],
    },
    {
      kind: 'car', pos: [60, -70], speed: 6,
      waypoints: [[90, -70], [-100, -70], [-100, -92], [90, -92]],
    },
    // пехота на маршрутах — 16..18
    {
      kind: 'walker', pos: [-95, 52], speed: 1.3,
      waypoints: [[-108, 52], [-84, 52], [-84, 66], [-108, 66]],
    },
    {
      kind: 'walker', pos: [100, -60], speed: 1.1,
      waypoints: [[88, -60], [104, -60], [104, -84], [88, -84]],
    },
    {
      kind: 'walker', pos: [20, -82], speed: 1.2,
      waypoints: [[-40, -82], [20, -82], [20, -94], [-40, -94]],
    },
  ];
}
