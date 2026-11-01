import * as THREE from 'three';

/** Ворота слалома */
export interface Gate {
  index: number;
  center: THREE.Vector3;
  normal: THREE.Vector3; // плоскость ворот
  halfW: number;
  halfH: number;
  passed: boolean;
  group: THREE.Group;
  ringMat: THREE.MeshStandardMaterial;
}

/** Зона сброса груза */
export interface DropZone {
  index: number;
  center: THREE.Vector3;
  radius: number;
  ringMat: THREE.MeshBasicMaterial;
}

/**
 * Ворота, зоны сброса, регистр AABB для прямой видимости.
 */
export class Obstacles {
  gates: Gate[] = [];
  zones: DropZone[] = [];
  readonly group = new THREE.Group();
  private disposables: Array<{ dispose(): void }> = [];

  /** Построить 8 ворот + финальные (курс слалома) */
  buildGates(): void {
    const defs: Array<{ x: number; y: number; z: number; nx: number; nz: number }> = [
      { x: 0, y: 3.2, z: 24, nx: 0, nz: 1 },
      { x: 14, y: 4.4, z: 44, nx: -0.35, nz: 1 },
      { x: -13, y: 5.2, z: 66, nx: 0.3, nz: 1 },
      { x: 11, y: 5.8, z: 88, nx: -0.3, nz: 1 },
      { x: -15, y: 6.4, z: 110, nx: 0.35, nz: 1 },
      { x: 8, y: 6.6, z: 128, nx: 0, nz: 1 },
      { x: -12, y: 6.2, z: 104, nx: 0.4, nz: -1 },
      { x: 0, y: 5.0, z: 10, nx: 0, nz: -1 },
    ];
    const frameMat = new THREE.MeshStandardMaterial({ color: 0x2e3328, roughness: 0.7, metalness: 0.3 });
    this.disposables.push(frameMat);
    defs.forEach((d, i) => {
      const g = new THREE.Group();
      const hw = 3.5;
      const hh = 2.5;
      const ringMat = new THREE.MeshStandardMaterial({
        color: 0x39412c,
        emissive: 0xffc94d,
        emissiveIntensity: 0.9,
        roughness: 0.5,
      });
      this.disposables.push(ringMat);
      const bar = new THREE.BoxGeometry(0.35, 0.35, 0.35);
      this.disposables.push(bar);
      // светящаяся рамка: 2 стойки + верх/низ
      const left = new THREE.Mesh(bar, ringMat);
      left.scale.set(0.3, hh * 2, 0.3);
      left.position.set(-hw, 0, 0);
      const right = new THREE.Mesh(bar, ringMat);
      right.scale.set(0.3, hh * 2, 0.3);
      right.position.set(hw, 0, 0);
      const top = new THREE.Mesh(bar, ringMat);
      top.scale.set(hw * 2 + 0.3, 0.3, 0.3);
      top.position.set(0, hh, 0);
      const bottom = new THREE.Mesh(bar, ringMat);
      bottom.scale.set(hw * 2 + 0.3, 0.3, 0.3);
      bottom.position.set(0, -hh, 0);
      g.add(left, right, top, bottom);

      // номер ворота
      const numTex = makeNumberTexture(i + 1);
      this.disposables.push(numTex);
      const num = new THREE.Mesh(
        new THREE.PlaneGeometry(2.4, 2.4),
        new THREE.MeshBasicMaterial({ map: numTex, transparent: true, side: THREE.DoubleSide })
      );
      num.position.set(0, 0, 0);
      num.position.y = 0;
      g.add(num);

      const normal = new THREE.Vector3(d.nx, 0, d.nz).normalize();
      const center = new THREE.Vector3(d.x, d.y, d.z);
      g.position.copy(center);
      g.lookAt(center.clone().add(normal));
      this.group.add(g);
      this.gates.push({
        index: i,
        center,
        normal,
        halfW: hw,
        halfH: hh,
        passed: false,
        group: g,
        ringMat,
      });
    });
  }

  /** Сброс состояния прохождения */
  resetGates(): void {
    for (const g of this.gates) g.passed = false;
  }

  /**
   * Проверка пролёта через ворота: пересечение отрезка (prev→cur) с плоскостью
   * ворот внутри габарита. Возвращает индекс пройденных ворот или -1.
   */
  checkGatePass(prev: THREE.Vector3, cur: THREE.Vector3): number {
    for (const g of this.gates) {
      const dPrev = (prev.x - g.center.x) * g.normal.x + (prev.z - g.center.z) * g.normal.z;
      const dCur = (cur.x - g.center.x) * g.normal.x + (cur.z - g.center.z) * g.normal.z;
      if (Math.sign(dPrev) === Math.sign(dCur) || Math.abs(dCur - dPrev) < 1e-6) continue;
      const t = dPrev / (dPrev - dCur);
      const ix = prev.x + (cur.x - prev.x) * t;
      const iy = prev.y + (cur.y - prev.y) * t;
      const iz = prev.z + (cur.z - prev.z) * t;
      // локальные координаты внутри плоскости ворот
      const lx = (ix - g.center.x) * g.normal.z - (iz - g.center.z) * g.normal.x; // поперёк
      const ly = iy - g.center.y;
      if (Math.abs(lx) <= g.halfW && Math.abs(ly) <= g.halfH) {
        return g.index;
      }
    }
    return -1;
  }

  /** Построить 3 зоны сброса */
  buildZones(): void {
    const defs: Array<[number, number]> = [[60, -45], [-80, -25], [20, 95]];
    defs.forEach((d, i) => {
      const ringMat = new THREE.MeshBasicMaterial({
        color: 0xffc94d,
        transparent: true,
        opacity: 0.85,
        side: THREE.DoubleSide,
      });
      this.disposables.push(ringMat);
      const ring = new THREE.Mesh(new THREE.RingGeometry(5.2, 6.0, 40), ringMat);
      ring.rotation.x = -Math.PI / 2;
      ring.position.set(d[0], 0.04, d[1]);
      const inner = new THREE.Mesh(
        new THREE.CircleGeometry(1.8, 24),
        new THREE.MeshBasicMaterial({ color: 0x8a6a10, transparent: true, opacity: 0.6 })
      );
      inner.rotation.x = -Math.PI / 2;
      inner.position.set(d[0], 0.035, d[1]);
      // флаги по краям
      const flagMat = new THREE.MeshStandardMaterial({ color: 0xc23b2e, roughness: 0.8 });
      this.disposables.push(flagMat);
      for (const a of [0, 2.1, 4.2]) {
        const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.08, 3, 6), flagMat);
        pole.position.set(d[0] + Math.sin(a) * 5.6, 1.5, d[1] + Math.cos(a) * 5.6);
        this.group.add(pole);
      }
      this.group.add(ring);
      this.group.add(inner);
      this.zones.push({
        index: i,
        center: new THREE.Vector3(d[0], 0, d[1]),
        radius: 6.0,
        ringMat,
      });
    });
  }

  /** Пульс колец зон/ворот */
  update(t: number): void {
    for (const z of this.zones) {
      z.ringMat.opacity = 0.55 + 0.35 * Math.sin(t * 3 + z.index);
    }
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

function makeNumberTexture(n: number): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = c.height = 128;
  const ctx = c.getContext('2d') as CanvasRenderingContext2D;
  ctx.clearRect(0, 0, 128, 128);
  ctx.fillStyle = 'rgba(20,24,14,0.55)';
  ctx.beginPath();
  ctx.arc(64, 64, 46, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = '#ffc94d';
  ctx.font = 'bold 64px "Courier New", monospace';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(String(n), 64, 68);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}
