import {
  BoxGeometry,
  BufferGeometry,
  CanvasTexture,
  Color,
  CylinderGeometry,
  Float32BufferAttribute,
  LineBasicMaterial,
  LineSegments,
  Matrix4,
  Mesh,
  MeshLambertMaterial,
  RepeatWrapping,
  SRGBColorSpace,
  Group,
} from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import type { WorldPhysics } from '../physics/WorldPhysics';
import { clamp, rng } from '../utils/MathUtils';

/** Процедурная «бетонная» текстура — один тайл, умножается на цвета вершин */
export function makeDetailTexture(): CanvasTexture {
  const c = document.createElement('canvas');
  c.width = c.height = 128;
  const g = c.getContext('2d')!;
  const r = rng(99);
  g.fillStyle = '#d4d4d0';
  g.fillRect(0, 0, 128, 128);
  const img = g.getImageData(0, 0, 128, 128);
  for (let i = 0; i < img.data.length; i += 4) {
    const n = 205 + r() * 50 - 25;
    img.data[i] = img.data[i + 1] = img.data[i + 2] = n;
  }
  g.putImageData(img, 0, 0);
  // пятна и трещины
  for (let i = 0; i < 26; i++) {
    g.fillStyle = `rgba(${r() > 0.5 ? '60,55,45' : '255,255,255'},${0.04 + r() * 0.07})`;
    g.beginPath();
    g.arc(r() * 128, r() * 128, 4 + r() * 18, 0, Math.PI * 2);
    g.fill();
  }
  g.strokeStyle = 'rgba(40,40,40,0.25)';
  for (let i = 0; i < 6; i++) {
    g.beginPath();
    let x = r() * 128;
    let y = r() * 128;
    g.moveTo(x, y);
    for (let k = 0; k < 4; k++) g.lineTo((x += r() * 20 - 10), (y += r() * 20 - 10));
    g.stroke();
  }
  const t = new CanvasTexture(c);
  t.wrapS = t.wrapT = RepeatWrapping;
  t.colorSpace = SRGBColorSpace;
  t.anisotropy = 2;
  return t;
}

export class Builder {
  private geos: BufferGeometry[] = [];
  private stack: [number, number, number][] = [];
  private tx = 0;
  private tz = 0;
  private tr = 0;
  private lineVerts: number[] = [];
  private tmpColor = new Color();
  colliders = 0;

  constructor(
    private phys: WorldPhysics,
    public rand: () => number,
  ) {}

  push(x: number, z: number, rot: number) {
    this.stack.push([this.tx, this.tz, this.tr]);
    const [wx, wz] = this.toWorld(x, z);
    this.tx = wx;
    this.tz = wz;
    this.tr += rot;
  }
  pop() {
    const s = this.stack.pop()!;
    [this.tx, this.tz, this.tr] = s;
  }
  toWorld(x: number, z: number): [number, number] {
    const c = Math.cos(this.tr);
    const s = Math.sin(this.tr);
    return [this.tx + x * c + z * s, this.tz - x * s + z * c];
  }

  private paint(g: BufferGeometry, color: number, yBase: number, jitter: number) {
    this.tmpColor.setHex(color);
    const pos = g.getAttribute('position');
    const nor = g.getAttribute('normal');
    const j = 1 + (this.rand() - 0.5) * jitter * 2;
    const arr = new Float32Array(pos.count * 3);
    for (let i = 0; i < pos.count; i++) {
      const ny = nor.getY(i);
      let f = (0.78 + 0.22 * (ny * 0.5 + 0.5)) * j;
      if (ny < -0.5) f *= 0.6;
      const h = yBase + pos.getY(i);
      f *= 0.78 + 0.22 * clamp(h / 0.9, 0, 1);
      arr[i * 3] = this.tmpColor.r * f;
      arr[i * 3 + 1] = this.tmpColor.g * f;
      arr[i * 3 + 2] = this.tmpColor.b * f;
    }
    g.setAttribute('color', new Float32BufferAttribute(arr, 3));
  }

  /** Бокс: (x, y0, z) — центр основания. ry — доп. поворот вокруг Y */
  box(x: number, y0: number, z: number, w: number, h: number, d: number, color: number, ry = 0, solid = true, jitter = 0.07) {
    if (w <= 0.01 || h <= 0.01 || d <= 0.01) return;
    const g = new BoxGeometry(w, h, d);
    const uv = g.getAttribute('uv');
    const dims: [number, number][] = [[d, h], [d, h], [w, d], [w, d], [w, h], [w, h]];
    for (let i = 0; i < uv.count; i++) {
      const f = Math.floor(i / 4);
      uv.setXY(i, (uv.getX(i) * dims[f][0]) / 2.5, (uv.getY(i) * dims[f][1]) / 2.5);
    }
    this.paint(g, color, y0 + h / 2, jitter); // локальный Y относительно центра -> абсолютная высота
    const [wx, wz] = this.toWorld(x, z);
    const rot = ry + this.tr;
    const m = new Matrix4().makeRotationY(rot);
    m.setPosition(wx, y0 + h / 2, wz);
    g.applyMatrix4(m);
    this.geos.push(g);
    if (solid) {
      this.phys.addBox(wx, y0 + h / 2, wz, w / 2, h / 2, d / 2, rot);
      this.colliders++;
    }
  }

  /** Усечённый конус/цилиндр (холмики, пирамиды, бочки). segs=4 — пирамида */
  frustum(x: number, y0: number, z: number, rBottom: number, rTop: number, h: number, color: number, segs = 8, solid = true, ry = 0) {
    const g = new CylinderGeometry(rTop, rBottom, h, segs, 1);
    const uv = g.getAttribute('uv');
    for (let i = 0; i < uv.count; i++) uv.setXY(i, (uv.getX(i) * rBottom * 2) / 2.5, (uv.getY(i) * h) / 2.5);
    this.paint(g, color, y0 + h / 2, 0.08);
    const [wx, wz] = this.toWorld(x, z);
    const m = new Matrix4().makeRotationY(ry + this.tr);
    m.setPosition(wx, y0 + h / 2, wz);
    g.applyMatrix4(m);
    this.geos.push(g);
    if (solid) {
      const p = g.getAttribute('position');
      const pts = new Float32Array(p.count * 3);
      for (let i = 0; i < p.count; i++) {
        pts[i * 3] = p.getX(i);
        pts[i * 3 + 1] = p.getY(i);
        pts[i * 3 + 2] = p.getZ(i);
      }
      if (this.phys.addConvex(pts)) this.colliders++;
    }
  }

  line(x1: number, y1: number, z1: number, x2: number, y2: number, z2: number) {
    const [a, b] = this.toWorld(x1, z1);
    const [c, d] = this.toWorld(x2, z2);
    this.lineVerts.push(a, y1, b, c, y2, d);
  }

  /**
   * Стена вдоль локальной оси U с проёмами. Центр (cx, cz), поворот rot.
   * ruin 0..1 — степень разрушения (рваная верхняя кромка).
   */
  wall(
    cx: number,
    cz: number,
    len: number,
    rot: number,
    h: number,
    th: number,
    color: number,
    ops: { u0: number; u1: number; y0: number; y1: number }[] = [],
    ruin = 0,
    y0 = 0,
  ) {
    const cuts = new Set<number>([-len / 2, len / 2]);
    for (const o of ops) {
      cuts.add(clamp(o.u0, -len / 2, len / 2));
      cuts.add(clamp(o.u1, -len / 2, len / 2));
    }
    if (ruin > 0) for (let u = -len / 2 + 1.3; u < len / 2 - 0.5; u += 1.3 + this.rand() * 0.6) cuts.add(u);
    const us = [...cuts].sort((a, b) => a - b);
    const cs = Math.cos(rot);
    const sn = Math.sin(rot);
    for (let i = 0; i < us.length - 1; i++) {
      const a = us[i];
      const b = us[i + 1];
      if (b - a < 0.05) continue;
      const mid = (a + b) / 2;
      const hEff = ruin > 0 ? h * (1 - ruin * Math.pow(this.rand(), 0.8)) : h;
      const px = cx + mid * cs;
      const pz = cz - mid * sn;
      const segs: [number, number][] = [[0, hEff]];
      const out: [number, number][] = [];
      for (const [s0, s1] of segs) {
        let parts: [number, number][] = [[s0, s1]];
        for (const o of ops) {
          if (mid > o.u0 && mid < o.u1) {
            const np: [number, number][] = [];
            for (const [p0, p1] of parts) {
              if (o.y0 > p0) np.push([p0, Math.min(p1, o.y0)]);
              if (o.y1 < p1) np.push([Math.max(p0, o.y1), p1]);
            }
            parts = np;
          }
        }
        out.push(...parts);
      }
      for (const [p0, p1] of out) {
        if (p1 - p0 > 0.05) this.box(px, y0 + p0, pz, b - a, p1 - p0, th, color, rot, true, 0.09);
      }
    }
  }

  build(map: CanvasTexture): Group {
    const group = new Group();
    const merged = mergeGeometries(this.geos, false);
    for (const g of this.geos) g.dispose();
    this.geos = [];
    if (merged) {
      const mesh = new Mesh(merged, new MeshLambertMaterial({ vertexColors: true, map }));
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      mesh.matrixAutoUpdate = false;
      group.add(mesh);
    }
    if (this.lineVerts.length) {
      const lg = new BufferGeometry();
      lg.setAttribute('position', new Float32BufferAttribute(this.lineVerts, 3));
      group.add(new LineSegments(lg, new LineBasicMaterial({ color: 0x2a2a2a })));
    }
    return group;
  }
}
