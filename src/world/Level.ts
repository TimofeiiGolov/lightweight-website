import {
  AdditiveBlending,
  CanvasTexture,
  Color,
  ConeGeometry,
  CylinderGeometry,
  DodecahedronGeometry,
  DoubleSide,
  Float32BufferAttribute,
  Group,
  IcosahedronGeometry,
  InstancedMesh,
  Matrix4,
  Mesh,
  MeshBasicMaterial,
  MeshLambertMaterial,
  PlaneGeometry,
  Quaternion,
  Vector3,
  CircleGeometry,
  SphereGeometry,
} from 'three';
import { WorldPhysics } from '../physics/WorldPhysics';
import { FLAT_RADIUS, fbm, rng, smoothstep, terrainHeight, WORLD_SIZE, lerp } from '../utils/MathUtils';
import { Builder, makeDetailTexture } from './Builder';

export type TargetKind = 'shield' | 'mannequin' | 'barrel' | 'truck' | 'cart' | 'infantry';
export type TargetGroup = 'range' | 'village' | 'convoy' | 'patrol';

export interface TargetDef {
  kind: TargetKind;
  group: TargetGroup;
  x: number;
  z: number;
  rot: number;
  path?: [number, number][];
  speed?: number;
  phase?: number; // 0..1 стартовая позиция вдоль пути
}
export interface GateDef {
  pos: Vector3;
  normal: Vector3;
  radius: number;
}
export interface ZoneDef {
  id: string;
  label: string;
  pos: Vector3;
  radius: number;
}

// Палитра: приглушённые военные тона
const C = {
  concrete: 0x8d8f8a,
  concreteD: 0x6d6f6c,
  plaster: 0xb3a58a,
  plaster2: 0x9ba58f,
  plaster3: 0xa89a86,
  brick: 0x9a5b45,
  olive: 0x56603f,
  oliveD: 0x434b30,
  sand: 0xb59f6c,
  earth: 0x6b573d,
  earthD: 0x3d3326,
  asphalt: 0x37393c,
  line: 0xcdbb55,
  wood: 0x6e5237,
  metal: 0x4a5057,
  rust: 0x7a4a33,
  bag: 0xa8996b,
  white: 0xdddddd,
  orange: 0xd9792b,
  roof: 0x6a4338,
};

export class Level {
  group = new Group();
  lamps = new Group(); // лучи прожекторов (ночь/сумерки)
  gates: GateDef[] = [];
  zones: ZoneDef[] = [];
  pads: ZoneDef[] = [];
  hoverPoint = new Vector3(0, 10, -45);
  targetDefs: TargetDef[] = [];
  spawn = new Vector3(0, 0.2, 0);
  detail: CanvasTexture;
  private b: Builder;
  private rand = rng(1337);

  constructor(private phys: WorldPhysics) {
    this.detail = makeDetailTexture();
    this.b = new Builder(phys, this.rand);
    this.buildTerrain();
    this.buildBase();
    this.buildRoads();
    this.buildRange();
    this.buildVillage();
    this.buildTrenches();
    this.buildFortifications();
    this.buildVehicles();
    this.buildLamps();
    this.buildDefs();
    this.group.add(this.b.build(this.detail));
    this.buildVegetation();
    this.group.add(this.lamps);
  }

  // ------------------------------------------------------------------ рельеф
  private buildTerrain() {
    const seg = 96;
    const geo = new PlaneGeometry(WORLD_SIZE, WORLD_SIZE, seg, seg);
    geo.rotateX(-Math.PI / 2);
    const pos = geo.getAttribute('position');
    const col = new Float32Array(pos.count * 3);
    const grass = new Color(0x5a6a3a);
    const grass2 = new Color(0x7b7b46);
    const dirt = new Color(0x6e5d40);
    const rock = new Color(0x6d6b64);
    const tmp = new Color();
    for (let i = 0; i < pos.count; i++) {
      const x = pos.getX(i);
      const z = pos.getZ(i);
      const h = terrainHeight(x, z);
      pos.setY(i, h);
      const n = fbm(x * 0.03, z * 0.03, 3);
      tmp.copy(grass).lerp(grass2, n * 1.3);
      tmp.lerp(dirt, smoothstep(0.55, 0.7, fbm(x * 0.02 + 40, z * 0.02, 3)) * 0.8);
      tmp.lerp(rock, smoothstep(14, 45, h));
      const k = 0.9 + this.rand() * 0.14;
      col[i * 3] = tmp.r * k;
      col[i * 3 + 1] = tmp.g * k;
      col[i * 3 + 2] = tmp.b * k;
    }
    geo.setAttribute('color', new Float32BufferAttribute(col, 3));
    geo.computeVertexNormals();
    const tex = this.detail.clone();
    tex.repeat.set(WORLD_SIZE / 5, WORLD_SIZE / 5);
    tex.needsUpdate = true;
    const mesh = new Mesh(geo, new MeshLambertMaterial({ vertexColors: true, map: tex }));
    mesh.receiveShadow = true;
    this.group.add(mesh);

    // физика: плоский пол + trimesh холмов
    this.phys.addBox(0, -5, 0, FLAT_RADIUS + 20, 5, FLAT_RADIUS + 20);
    const idx = geo.getIndex()!;
    this.phys.addTrimesh(new Float32Array(pos.array), new Uint32Array(idx.array));
  }

  // ------------------------------------------------------------------ база и стартовая площадка
  private buildBase() {
    const b = this.b;
    // стартовая площадка (L1)
    b.box(0, 0, 0, 10, 0.12, 10, C.concrete);
    b.box(-1.6, 0.12, 0, 0.45, 0.02, 3.4, C.white, 0, false, 0);
    b.box(1.6, 0.12, 0, 0.45, 0.02, 3.4, C.white, 0, false, 0);
    b.box(0, 0.12, 0, 3.2, 0.02, 0.45, C.white, 0, false, 0);
    // палатки
    for (const [x, z, r] of [[-20, 20, 0.2], [-30, 28, -0.1], [-12, 34, 0.35]] as const) {
      b.push(x, z, r);
      b.box(0, 0, 0, 5, 1.6, 8, C.oliveD, 0, true, 0.04);
      b.frustum(0, 1.6, 0, 3.6, 0.15, 1.5, C.olive, 4, false, Math.PI / 4);
      b.pop();
    }
    // контейнеры
    b.box(22, 0, 22, 6.1, 2.6, 2.4, C.rust, 0.1);
    b.box(22.4, 0, 25.4, 6.1, 2.6, 2.4, C.olive, -0.05);
    b.box(22.2, 2.6, 23.6, 6.1, 2.6, 2.4, C.metal, 0.05);
    // навес
    b.push(-8, 46, 0);
    for (const sx of [-4, 4]) for (const sz of [-3, 3]) b.box(sx, 0, sz, 0.3, 3.2, 0.3, C.wood);
    b.box(0, 3.2, 0, 10, 0.25, 8, C.metal);
    b.box(0, 0, 0, 3, 1.1, 1.1, C.olive, 0.2);
    b.pop();
    // бочки
    for (let i = 0; i < 6; i++) b.frustum(14 + (i % 3) * 1.1, 0, 12 + Math.floor(i / 3) * 1.1, 0.35, 0.35, 0.95, i % 2 ? C.rust : C.oliveD, 8);
    // дорожные блоки у площадки
    for (let i = 0; i < 6; i++) b.box(-9, 0, -4 + i * 2.6, 0.7, 0.9, 2.4, C.concreteD, 0.03 * i);
    // посадочная площадка L2
    b.box(45, 0, 40, 12, 0.12, 12, C.concrete);
    b.box(45, 0.12, 40, 9, 0.02, 9, C.orange, 0, false, 0);
    b.box(45, 0.14, 40, 6.4, 0.02, 6.4, C.concrete, 0, false, 0);
    b.box(43.8, 0.16, 40, 0.5, 0.02, 3.4, C.white, 0, false, 0);
    b.box(46.2, 0.16, 40, 0.5, 0.02, 3.4, C.white, 0, false, 0);
    b.box(45, 0.16, 40, 2.6, 0.02, 0.5, C.white, 0, false, 0);
    // ветроуказатель
    b.box(-14, 0, -8, 0.12, 6, 0.12, C.metal);
    b.box(-13.4, 5.6, -8, 1.2, 0.35, 0.05, C.orange, 0, false);
    this.pads.push({ id: 'L1', label: 'ПЛОЩАДКА 1', pos: new Vector3(0, 0, 0), radius: 5 });
    this.pads.push({ id: 'L2', label: 'ПЛОЩАДКА 2', pos: new Vector3(45, 0, 40), radius: 5 });
    this.zones.push(
      { id: 'A', label: 'ЗОНА A', pos: new Vector3(-120, 0, -190), radius: 8 },
      { id: 'B', label: 'ЗОНА B', pos: new Vector3(165, 0, -60), radius: 8 },
      { id: 'C', label: 'ЗОНА C', pos: new Vector3(30, 0, -228), radius: 8 },
    );
  }

  // ------------------------------------------------------------------ дороги
  private buildRoads() {
    const b = this.b;
    b.box(0, 0, -130, 8, 0.05, 330, C.asphalt, 0, false, 0.03);
    b.box(0, 0, -150, 420, 0.04, 8, C.asphalt, 0, false, 0.03);
    b.box(0, 0, 0, 10, 0.05, 60, C.asphalt, 0, false, 0.03);
    b.box(100, 0, -60, 90, 0.04, 6, C.asphalt, 0, false, 0.03);
    for (let z = 20; z > -290; z -= 7) b.box(0, 0.05, z, 0.25, 0.01, 3, C.line, 0, false, 0);
    for (let x = -200; x < 200; x += 7) if (Math.abs(x) > 5) b.box(x, 0.04, -150, 3, 0.01, 0.25, C.line, 0, false, 0);
  }

  // ------------------------------------------------------------------ тир
  private buildRange() {
    const b = this.b;
    // задний вал
    b.box(-102, 0, -75, 5, 4, 100, C.earth, 0, true, 0.04);
    b.box(-99, 0, -75, 3, 2.4, 100, C.earth, 0, true, 0.04);
    // огневой рубеж
    b.box(-36, 0, -75, 0.9, 1, 100, C.bag, 0, true, 0.05);
    for (let z = -30; z >= -120; z -= 18) b.box(-37, 0, z + 9, 0.3, 2.2, 0.3, C.wood);
    // вышка наблюдения
    this.watchTower(-30, -8);
    // щиты-стенды разделители
    for (let z = -21; z >= -129; z -= 18) b.box(-62, 0, z, 0.8, 0.8, 1.6, C.bag, 0);
  }

  private watchTower(x: number, z: number) {
    const b = this.b;
    b.push(x, z, 0);
    for (const sx of [-1.4, 1.4]) for (const sz of [-1.4, 1.4]) b.box(sx, 0, sz, 0.3, 8.6, 0.3, C.wood);
    b.box(0, 3, 0, 3.2, 0.12, 0.1, C.wood, 0.0, false);
    b.box(0, 5.5, 0, 0.1, 0.12, 3.2, C.wood, 0, false);
    b.box(0, 8.6, 0, 3.8, 0.25, 3.8, C.wood);
    const ops = [{ u0: -1.1, u1: 1.1, y0: 1.0, y1: 1.7 }];
    b.wall(0, 1.8, 3.6, 0, 2.2, 0.2, C.wood, ops, 0, 8.85);
    b.wall(0, -1.8, 3.6, 0, 2.2, 0.2, C.wood, ops, 0, 8.85);
    b.wall(1.8, 0, 3.4, Math.PI / 2, 2.2, 0.2, C.wood, ops, 0, 8.85);
    b.wall(-1.8, 0, 3.4, Math.PI / 2, 2.2, 0.2, C.wood, [], 0, 8.85);
    b.box(0, 11.05, 0, 4.4, 0.25, 4.4, C.roof);
    b.pop();
  }

  // ------------------------------------------------------------------ деревня
  private windowsFor(len: number, rows: number, door: boolean) {
    const ops: { u0: number; u1: number; y0: number; y1: number }[] = [];
    const n = Math.max(1, Math.floor((len - 1.5) / 3.3));
    const step = len / n;
    for (let i = 0; i < n; i++) {
      const u = -len / 2 + step * (i + 0.5);
      for (let r = 0; r < rows; r++) {
        if (door && r === 0 && Math.abs(u) < step * 0.55 + 0.8) continue;
        ops.push({ u0: u - 0.65, u1: u + 0.65, y0: 1.0 + r * 3.2, y1: 2.4 + r * 3.2 });
      }
    }
    if (door) ops.push({ u0: -0.8, u1: 0.8, y0: 0, y1: 2.4 });
    return ops;
  }

  private building(cx: number, cz: number, w: number, d: number, floors: number, rot: number, ruin: number, color: number) {
    const b = this.b;
    const H = floors * 3.2;
    b.push(cx, cz, rot);
    const th = 0.4;
    b.wall(0, d / 2, w, 0, H, th, color, this.windowsFor(w, floors, true), ruin);
    b.wall(0, -d / 2, w, 0, H, th, color, this.windowsFor(w, floors, false), ruin);
    b.wall(w / 2, 0, d - th, Math.PI / 2, H, th, color, this.windowsFor(d - th, floors, false), ruin);
    b.wall(-w / 2, 0, d - th, Math.PI / 2, H, th, color, this.windowsFor(d - th, floors, false), ruin);
    // внутренняя перегородка с дверью
    b.wall(0, d * 0.1, w - 0.8, 0, H, 0.25, C.plaster3, [{ u0: -w * 0.2 - 0.7, u1: -w * 0.2 + 0.7, y0: 0, y1: 2.3 }], ruin * 0.8);
    if (floors > 1) {
      if (ruin > 0) {
        b.box(w * 0.2, 3.1, 0, w * 0.55, 0.25, d - 0.5, C.concreteD);
      } else b.box(0, 3.1, 0, w - 0.5, 0.25, d - 0.5, C.concreteD);
    }
    if (ruin === 0) {
      b.box(0, H, 0, w + 0.6, 0.3, d + 0.6, C.roof);
      b.box(0, H + 0.3, 0, w + 0.2, 0.5, 0.5, C.roof, 0, false);
    } else {
      b.box(w * 0.18, H - 0.1, -d * 0.2, w * 0.5, 0.25, d * 0.45, C.roof, 0.04);
    }
    // обломки
    if (ruin > 0) {
      for (let i = 0; i < 9; i++) {
        const rx = (this.rand() - 0.5) * (w + 5);
        const rz = (this.rand() > 0.5 ? 1 : -1) * (d / 2 + 0.5 + this.rand() * 2.5);
        const s = 0.4 + this.rand() * 0.9;
        b.box(rx, 0, rz, s * 1.4, s * 0.7, s, this.rand() > 0.5 ? C.concreteD : C.brick, this.rand() * 3);
      }
    }
    b.pop();
  }

  private buildVillage() {
    const list: [number, number, number, number, number, number, number, number][] = [
      // x, z, w, d, floors, rot, ruin, color
      [80, -135, 14, 10, 1, 0.05, 0, C.plaster],
      [108, -132, 10, 12, 2, -0.04, 0, C.plaster2],
      [136, -134, 12, 10, 1, 0.1, 0.75, C.plaster3],
      [82, -166, 10, 14, 1, 0.08, 0.7, C.brick],
      [112, -168, 16, 10, 1, 0, 0, C.plaster3],
      [141, -166, 10, 10, 2, -0.1, 0.65, C.plaster],
      [84, -196, 12, 10, 1, 0.0, 0, C.plaster2],
      [114, -199, 10, 10, 2, 0.1, 0.8, C.brick],
      [142, -197, 14, 10, 1, -0.05, 0, C.plaster],
    ];
    for (const a of list) this.building(...a);
    // стены-ограды и баррикады между домами
    this.sandbagWall(96, -150, 6, 0.4);
    this.sandbagWall(125, -151, 5, -0.5);
    this.sandbagWall(97, -182, 7, 0.1);
    this.sandbagWall(127, -182, 6, 1.4);
    // колодец и укрытие
    this.b.frustum(97, 0, -122, 0.9, 0.9, 1.0, C.concreteD, 10);
    // мёртвая техника на перекрёстке
    this.truckDecor(130, -148, 0.05, C.rust);
  }

  // ------------------------------------------------------------------ окопы
  private buildTrenches() {
    const b = this.b;
    const pts: [number, number][] = [[45, -25], [62, -45], [46, -65], [63, -85], [47, -105], [62, -125]];
    for (let i = 0; i < pts.length - 1; i++) {
      const [x1, z1] = pts[i];
      const [x2, z2] = pts[i + 1];
      const len = Math.hypot(x2 - x1, z2 - z1);
      const ang = Math.atan2(-(z2 - z1), x2 - x1); // вокруг Y
      const mx = (x1 + x2) / 2;
      const mz = (z1 + z2) / 2;
      b.box(mx, 0, mz, len + 1.5, 0.06, 2.4, C.earthD, ang, false, 0.04);
      for (const side of [-1.9, 1.9]) {
        const ox = Math.sin(ang) * side;
        const oz = Math.cos(ang) * side;
        b.box(mx + ox, 0, mz + oz, len + 1.6, 1.0, 1.4, C.earth, ang, true, 0.06);
        b.box(mx + ox * 1.05, 1.0, mz + oz * 1.05, len * 0.9, 0.45, 0.8, C.bag, ang, true, 0.05);
      }
    }
    // блиндажи в окопах
    this.bunker(78, -60, Math.PI / 2 + 0.3);
  }

  // ------------------------------------------------------------------ укрепления, ограждения
  private bunker(x: number, z: number, rot: number) {
    const b = this.b;
    b.push(x, z, rot);
    const col = C.concrete;
    b.wall(0, -2.5, 7, 0, 2.6, 0.7, col, [{ u0: -1.6, u1: 1.6, y0: 1.3, y1: 1.85 }]);
    b.wall(0, 2.5, 7, 0, 2.6, 0.7, col, [{ u0: -0.7, u1: 0.7, y0: 0, y1: 1.9 }]);
    b.wall(3.5, 0, 4.3, Math.PI / 2, 2.6, 0.7, col);
    b.wall(-3.5, 0, 4.3, Math.PI / 2, 2.6, 0.7, col);
    b.box(0, 2.6, 0, 8, 0.6, 6.2, C.concreteD);
    b.frustum(0, 3.2, 0, 5.5, 2.8, 1.5, C.earth, 8, true);
    b.frustum(-4.5, 0, 0, 3.2, 1.6, 2.4, C.earth, 8, true);
    b.frustum(4.5, 0, 0, 3.2, 1.6, 2.4, C.earth, 8, true);
    b.pop();
  }

  private sandbagWall(x: number, z: number, len: number, rot: number) {
    const b = this.b;
    b.push(x, z, rot);
    b.box(0, 0, 0, len, 0.5, 0.9, C.bag, 0, true, 0.08);
    b.box(0, 0.5, 0, len - 0.3, 0.45, 0.7, C.bag, 0, true, 0.08);
    b.box(0, 0.95, 0, len - 0.9, 0.4, 0.5, C.bag, 0, true, 0.08);
    b.pop();
  }

  private fence(x1: number, z1: number, x2: number, z2: number) {
    const b = this.b;
    const len = Math.hypot(x2 - x1, z2 - z1);
    const n = Math.ceil(len / 3);
    let px = x1;
    let pz = z1;
    for (let i = 0; i <= n; i++) {
      const t = i / n;
      const x = lerp(x1, x2, t);
      const z = lerp(z1, z2, t);
      b.box(x, 0, z, 0.08, 1.4, 0.08, C.metal, 0, false);
      if (i > 0) for (const y of [0.35, 0.7, 1.05, 1.35]) b.line(px, y, pz, x, y + (i % 2 ? 0.08 : -0.05), z);
      px = x;
      pz = z;
    }
  }

  private buildFortifications() {
    const b = this.b;
    this.bunker(140, -40, -Math.PI / 2);
    this.bunker(-40, -212, 0.3);
    this.bunker(60, -226, Math.PI);
    this.bunker(-150, -112, Math.PI / 2);
    // «зубы дракона» поперёк подъезда
    for (const s of [-1, 1]) {
      for (let i = 0; i < 9; i++) {
        const x = s * (12 + i * 2.2);
        b.frustum(x, 0, -215, 0.9, 0.12, 1.1, C.concreteD, 4, true, Math.PI / 4);
        b.frustum(x + 1, 0, -218, 0.9, 0.12, 1.1, C.concreteD, 4, true, Math.PI / 4);
      }
    }
    // блоки-ограничители вдоль дороги
    for (let i = 0; i < 14; i++) b.box(6.5, 0, -40 - i * 9, 0.7, 0.9, 2.4, C.concreteD, 0.02);
    // мешки у блокпоста
    this.sandbagWall(-14, -205, 8, 0.2);
    this.sandbagWall(-22, -200, 6, 1.2);
    this.sandbagWall(100, 20, 7, 0.4);
    this.sandbagWall(-60, 10, 6, -0.3);
    // колючая проволока
    this.fence(-80, -20, -80, -140);
    this.fence(30, -10, 90, -10);
    this.fence(150, -100, 150, -20);
    this.fence(-120, -150, -170, -150);
    // вышки
    this.watchTower(-100, -155);
    this.watchTower(150, -100);
    this.watchTower(-5, -224);
    // бочки/ящики
    for (let i = 0; i < 12; i++) {
      const x = -60 + this.rand() * 10;
      const z = 20 + this.rand() * 12;
      b.box(x, 0, z, 1, 0.9, 1, C.wood, this.rand() * 3);
    }
  }

  // ------------------------------------------------------------------ техника
  private truckDecor(x: number, z: number, rot: number, color: number) {
    const b = this.b;
    b.push(x, z, rot);
    b.box(0, 0.5, 0, 6.2, 0.4, 2.4, C.metal);
    b.box(-1.2, 0.9, 0, 3.8, 1.6, 2.4, color);
    b.box(2.2, 0.9, 0, 1.8, 1.7, 2.3, color);
    b.box(2.9, 1.8, 0, 0.6, 0.7, 2.0, C.metal, 0, false);
    for (const sx of [-2, 2.2]) for (const sz of [-1.2, 1.2]) b.frustum(sx, 0, sz, 0.55, 0.55, 0.5, 0x1b1b1b, 10, false, 0);
    b.pop();
  }

  private tank(x: number, z: number, rot: number, color: number) {
    const b = this.b;
    b.push(x, z, rot);
    b.box(0, 0.35, 0, 6.6, 1.0, 2.2, color);
    b.box(0, 0, 1.4, 6.9, 1.0, 0.8, C.oliveD);
    b.box(0, 0, -1.4, 6.9, 1.0, 0.8, C.oliveD);
    b.box(-0.3, 1.35, 0, 3.0, 0.9, 2.2, color);
    b.box(2.6, 1.6, 0, 3.6, 0.2, 0.2, C.metal, 0, false);
    b.pop();
  }

  private buildVehicles() {
    this.tank(-40, -175, 0.6, C.olive);
    this.tank(-8, -205, -0.4, C.rust);
    this.truckDecor(28, -118, -0.3, C.rust);
    this.truckDecor(-70, -180, 1.1, C.oliveD);
    this.truckDecor(-24, 5, 0.1, C.olive);
  }

  // ------------------------------------------------------------------ ночные прожекторы
  private buildLamps() {
    const b = this.b;
    const tex = this.glowTexture();
    const beamMat = new MeshBasicMaterial({ color: 0xffeeb8, transparent: true, opacity: 0.1, blending: AdditiveBlending, depthWrite: false, side: DoubleSide });
    const poolMat = new MeshBasicMaterial({ map: tex, color: 0xffe8b0, transparent: true, opacity: 0.8, blending: AdditiveBlending, depthWrite: false });
    const bulbMat = new MeshBasicMaterial({ color: 0xfff2c4 });
    const beamGeo = new ConeGeometry(8, 9.5, 20, 1, true);
    const poolGeo = new CircleGeometry(11, 24);
    poolGeo.rotateX(-Math.PI / 2);
    const bulbGeo = new SphereGeometry(0.35, 8, 6);
    const spots: [number, number][] = [[10, 12], [-52, -75], [-40, -130], [96, -150], [127, -150], [40, -60], [0, -240], [-90, -190], [150, -40]];
    for (const [x, z] of spots) {
      b.box(x, 0, z, 0.25, 9, 0.25, C.metal);
      b.box(x, 9, z, 1.3, 0.25, 0.6, C.metal, 0, false);
      const bulb = new Mesh(bulbGeo, bulbMat);
      bulb.position.set(x, 8.9, z);
      this.group.add(bulb);
      const beam = new Mesh(beamGeo, beamMat);
      beam.position.set(x, 4.2, z);
      this.lamps.add(beam);
      const pool = new Mesh(poolGeo, poolMat);
      pool.position.set(x, 0.1, z);
      this.lamps.add(pool);
    }
    this.lamps.visible = false;
  }

  private glowTexture(): CanvasTexture {
    const c = document.createElement('canvas');
    c.width = c.height = 64;
    const g = c.getContext('2d')!;
    const gr = g.createRadialGradient(32, 32, 0, 32, 32, 32);
    gr.addColorStop(0, 'rgba(255,255,255,1)');
    gr.addColorStop(0.5, 'rgba(255,255,255,0.35)');
    gr.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = gr;
    g.fillRect(0, 0, 64, 64);
    return new CanvasTexture(c);
  }

  // ------------------------------------------------------------------ определения целей и ворот
  private buildDefs() {
    const T = this.targetDefs;
    // тир
    for (let z = -30; z >= -120; z -= 18) T.push({ kind: 'shield', group: 'range', x: -70, z, rot: Math.PI / 2 });
    for (const z of [-39, -75, -93, -111]) T.push({ kind: 'mannequin', group: 'range', x: -56, z, rot: Math.PI / 2 });
    // деревня
    T.push({ kind: 'truck', group: 'village', x: 102, z: -150, rot: 0 });
    T.push({ kind: 'truck', group: 'village', x: 66, z: -150, rot: 0.1 });
    for (const [x, z] of [[80, -135], [112, -168], [142, -197], [108, -132], [84, -196]]) {
      T.push({ kind: 'mannequin', group: 'village', x, z, rot: this.rand() * 6 });
    }
    for (const [x, z] of [[95, -136], [124, -172], [96, -190], [127, -205], [100, -122]]) {
      T.push({ kind: 'barrel', group: 'village', x, z, rot: 0 });
    }
    // колонна по дороге
    const path: [number, number][] = [[-2, -60], [-2, -250]];
    for (let i = 0; i < 3; i++) {
      T.push({ kind: 'cart', group: 'convoy', x: -2, z: -60, rot: 0, path, speed: 6.5, phase: i * 0.12 });
    }
    // пехота патруль вдоль окопов
    const p2: [number, number][] = [[36, -35], [36, -115]];
    for (let i = 0; i < 4; i++) {
      T.push({ kind: 'infantry', group: 'patrol', x: 36, z: -35, rot: 0, path: p2, speed: 2.2, phase: i * 0.22 });
    }

    // слалом
    const n = 10;
    const centers: Vector3[] = [];
    for (let i = 0; i < n; i++) {
      centers.push(new Vector3(Math.sin(i * 1.1) * 14, 3.4 + (i % 3) * 1.6, -30 - i * 22));
    }
    for (let i = 0; i < n; i++) {
      const next = centers[Math.min(i + 1, n - 1)];
      const prev = centers[Math.max(i - 1, 0)];
      const dir = next.clone().sub(prev);
      dir.y = 0;
      dir.normalize();
      this.gates.push({ pos: centers[i], normal: dir, radius: 2.5 });
    }
  }

  // ------------------------------------------------------------------ растительность (instancing)
  private blocked(x: number, z: number): boolean {
    if (Math.abs(x) < 10 && z < 60 && z > -300) return true; // дорога
    if (Math.abs(z + 150) < 8) return true;
    if (Math.hypot(x, z) < 22) return true;
    if (x > -120 && x < -30 && z < -5 && z > -150) return true; // тир
    if (x > 55 && x < 170 && z < -115 && z > -220) return true; // деревня
    if (x > 25 && x < 85 && z < -15 && z > -135) return true; // окопы
    if (x > -50 && x < 60 && z > 5 && z < 60) return true; // база
    for (const zn of [...this.zones, ...this.pads]) if (Math.hypot(x - zn.pos.x, z - zn.pos.z) < 16) return true;
    return false;
  }

  private buildVegetation() {
    const r = this.rand;
    const trees: { x: number; z: number; s: number }[] = [];
    let tries = 0;
    while (trees.length < 190 && tries++ < 4000) {
      const ang = r() * Math.PI * 2;
      const dist = 35 + Math.sqrt(r()) * 300;
      const x = Math.cos(ang) * dist;
      const z = Math.sin(ang) * dist;
      if (this.blocked(x, z)) continue;
      trees.push({ x, z, s: 0.8 + r() * 0.8 });
    }
    const trunkG = new CylinderGeometry(0.16, 0.28, 2.6, 5);
    trunkG.translate(0, 1.3, 0);
    const c1G = new ConeGeometry(2.3, 3.6, 7);
    c1G.translate(0, 2.9, 0);
    const c2G = new ConeGeometry(1.7, 3.2, 7);
    c2G.translate(0, 4.8, 0);
    const mat = new MeshLambertMaterial({ color: 0xffffff });
    const trunk = new InstancedMesh(trunkG, mat, trees.length);
    const c1 = new InstancedMesh(c1G, mat, trees.length);
    const c2 = new InstancedMesh(c2G, mat, trees.length);
    const m = new Matrix4();
    const q = new Quaternion();
    const col = new Color();
    trees.forEach((t, i) => {
      const y = terrainHeight(t.x, t.z);
      q.setFromAxisAngle(new Vector3(0, 1, 0), r() * 6.28);
      m.compose(new Vector3(t.x, y, t.z), q, new Vector3(t.s, t.s * (0.9 + r() * 0.3), t.s));
      trunk.setMatrixAt(i, m);
      c1.setMatrixAt(i, m);
      c2.setMatrixAt(i, m);
      trunk.setColorAt(i, col.setHex(0x5a4430));
      const g = col.setHSL(0.27 + r() * 0.05, 0.35 + r() * 0.15, 0.17 + r() * 0.07);
      c1.setColorAt(i, g);
      c2.setColorAt(i, g);
      // физика: ствол и крона
      this.phys.addDesc(WorldPhysics.R.ColliderDesc.cylinder(1.3 * t.s, 0.3 * t.s).setTranslation(t.x, y + 1.3 * t.s, t.z));
      this.phys.addDesc(WorldPhysics.R.ColliderDesc.cone(2.5 * t.s, 1.9 * t.s).setTranslation(t.x, y + 3.7 * t.s, t.z));
    });
    for (const im of [trunk, c1, c2]) {
      im.castShadow = true;
      im.receiveShadow = true;
      im.instanceMatrix.needsUpdate = true;
      if (im.instanceColor) im.instanceColor.needsUpdate = true;
      this.group.add(im);
    }

    // кусты и камни (без коллизий)
    const bushG = new IcosahedronGeometry(0.9, 0);
    const bushes = new InstancedMesh(bushG, mat, 160);
    const rockG = new DodecahedronGeometry(0.8, 0);
    const rocks = new InstancedMesh(rockG, mat, 70);
    let nb = 0;
    let nr = 0;
    for (let i = 0; i < 1500 && (nb < 160 || nr < 70); i++) {
      const ang = r() * 6.28;
      const dist = 20 + Math.sqrt(r()) * 320;
      const x = Math.cos(ang) * dist;
      const z = Math.sin(ang) * dist;
      if (this.blocked(x, z)) continue;
      const y = terrainHeight(x, z);
      if (r() > 0.3 && nb < 160) {
        const s = 0.7 + r() * 1.1;
        m.compose(new Vector3(x, y + 0.3 * s, z), q.setFromAxisAngle(new Vector3(0, 1, 0), r() * 6), new Vector3(s * 1.3, s * 0.8, s * 1.3));
        bushes.setMatrixAt(nb, m);
        bushes.setColorAt(nb++, col.setHSL(0.22 + r() * 0.06, 0.4, 0.16 + r() * 0.08));
      } else if (nr < 70) {
        const s = 0.6 + r() * 1.6;
        m.compose(new Vector3(x, y + 0.2 * s, z), q.setFromAxisAngle(new Vector3(r(), r(), r()).normalize(), r() * 6), new Vector3(s, s * 0.7, s));
        rocks.setMatrixAt(nr, m);
        rocks.setColorAt(nr++, col.setHSL(0.1, 0.05, 0.28 + r() * 0.12));
      }
    }
    bushes.count = nb;
    rocks.count = nr;
    for (const im of [bushes, rocks]) {
      im.instanceMatrix.needsUpdate = true;
      if (im.instanceColor) im.instanceColor.needsUpdate = true;
      im.receiveShadow = true;
      this.group.add(im);
    }
  }
}
