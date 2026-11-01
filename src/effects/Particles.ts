import * as THREE from 'three';

interface Pool {
  points: THREE.Points;
  geo: THREE.BufferGeometry;
  pos: Float32Array;
  col: Float32Array;
  size: Float32Array;
  alpha: Float32Array;
  vel: Float32Array;
  life: Float32Array;
  maxLife: Float32Array;
  grav: Float32Array;
  dragK: number;
  cursor: number;
  count: number;
}

/**
 * Пул частиц (взрывы, искры, дым, пыль) на кастомном шейдере.
 * CPU-обновление, без аллокаций в кадре.
 */
export class Particles {
  readonly group = new THREE.Group();
  private fire: Pool;
  private smoke: Pool;
  private decals: THREE.Mesh[] = [];
  private decalCursor = 0;
  private disposables: Array<{ dispose(): void }> = [];

  private static FIRE_N = 320;
  private static SMOKE_N = 200;

  constructor() {
    this.fire = this.makePool(Particles.FIRE_N, THREE.AdditiveBlending, false);
    this.smoke = this.makePool(Particles.SMOKE_N, THREE.NormalBlending, true);
    this.makeDecals();
  }

  private makePool(n: number, blending: THREE.Blending, isSmoke: boolean): Pool {
    const geo = new THREE.BufferGeometry();
    const pos = new Float32Array(n * 3);
    const col = new Float32Array(n * 3);
    const size = new Float32Array(n);
    const alpha = new Float32Array(n);
    const vel = new Float32Array(n * 3);
    const life = new Float32Array(n);
    const maxLife = new Float32Array(n);
    const grav = new Float32Array(n);
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    geo.setAttribute('aColor', new THREE.BufferAttribute(col, 3));
    geo.setAttribute('aSize', new THREE.BufferAttribute(size, 1));
    geo.setAttribute('aAlpha', new THREE.BufferAttribute(alpha, 1));
    geo.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 500);

    const mat = new THREE.ShaderMaterial({
      transparent: true,
      depthWrite: false,
      blending,
      uniforms: {},
      vertexShader: /* glsl */ `
        attribute vec3 aColor;
        attribute float aSize;
        attribute float aAlpha;
        varying vec3 vColor;
        varying float vAlpha;
        void main() {
          vColor = aColor;
          vAlpha = aAlpha;
          vec4 mv = modelViewMatrix * vec4(position, 1.0);
          gl_PointSize = aSize * (240.0 / max(1.0, -mv.z));
          gl_Position = projectionMatrix * mv;
        }
      `,
      fragmentShader: /* glsl */ `
        varying vec3 vColor;
        varying float vAlpha;
        void main() {
          vec2 d = gl_PointCoord - 0.5;
          float r = length(d);
          if (r > 0.5) discard;
          float soft = smoothstep(0.5, ${isSmoke ? '0.1' : '0.05'}, r);
          gl_FragColor = vec4(vColor, vAlpha * soft);
        }
      `,
    });
    this.disposables.push(geo, mat);

    const points = new THREE.Points(geo, mat);
    points.frustumCulled = false;
    this.group.add(points);
    return { points, geo, pos, col, size, alpha, vel, life, maxLife, grav, dragK: isSmoke ? 1.2 : 0.6, cursor: 0, count: n };
  }

  private makeDecals(): void {
    const geo = new THREE.CircleGeometry(1.7, 20);
    const mat = new THREE.MeshBasicMaterial({ color: 0x14140f, transparent: true, opacity: 0.7, depthWrite: false });
    this.disposables.push(geo, mat);
    for (let i = 0; i < 12; i++) {
      const m = new THREE.Mesh(geo, mat);
      m.rotation.x = -Math.PI / 2;
      m.visible = false;
      m.renderOrder = 1;
      this.decals.push(m);
      this.group.add(m);
    }
  }

  private spawn(p: Pool, x: number, y: number, z: number, vx: number, vy: number, vz: number, r: number, g: number, b: number, size: number, life: number, grav: number): void {
    const i = p.cursor;
    p.cursor = (p.cursor + 1) % p.count;
    p.pos[i * 3] = x;
    p.pos[i * 3 + 1] = y;
    p.pos[i * 3 + 2] = z;
    p.vel[i * 3] = vx;
    p.vel[i * 3 + 1] = vy;
    p.vel[i * 3 + 2] = vz;
    p.col[i * 3] = r;
    p.col[i * 3 + 1] = g;
    p.col[i * 3 + 2] = b;
    p.size[i] = size;
    p.alpha[i] = 1;
    p.life[i] = life;
    p.maxLife[i] = life;
    p.grav[i] = grav;
  }

  /** Взрыв: вспышка, огонь, дым */
  explosion(x: number, y: number, z: number, scale = 1): void {
    for (let i = 0; i < 70; i++) {
      const a = Math.random() * Math.PI * 2;
      const el = Math.random() * Math.PI - Math.PI / 2;
      const sp = (2 + Math.random() * 8) * scale;
      const hot = Math.random();
      this.spawn(
        this.fire, x, y, z,
        Math.cos(a) * Math.cos(el) * sp, Math.sin(el) * sp * 0.8 + 1.5, Math.sin(a) * Math.cos(el) * sp,
        1.0, hot > 0.5 ? 0.55 + hot * 0.3 : 0.3, hot > 0.7 ? 0.15 : 0.05,
        (0.5 + Math.random() * 0.7) * scale, 0.35 + Math.random() * 0.5, -3
      );
    }
    for (let i = 0; i < 34; i++) {
      const a = Math.random() * Math.PI * 2;
      const sp = 0.5 + Math.random() * 2.2;
      this.spawn(
        this.smoke, x, y + 0.4, z,
        Math.cos(a) * sp, 1.2 + Math.random() * 2.4, Math.sin(a) * sp,
        0.16, 0.15, 0.13,
        (1.4 + Math.random() * 1.6) * scale, 1.8 + Math.random() * 1.6, 1.6
      );
    }
    // декаль на земле
    const decal = this.decals[this.decalCursor];
    this.decalCursor = (this.decalCursor + 1) % this.decals.length;
    decal.position.set(x, 0.03, z);
    decal.visible = true;
    decal.scale.setScalar(0.6 + scale * 0.5);
  }

  /** Искры при жёстком ударе дрона */
  sparks(x: number, y: number, z: number): void {
    for (let i = 0; i < 26; i++) {
      const a = Math.random() * Math.PI * 2;
      const el = Math.random() * Math.PI / 2;
      const sp = 3 + Math.random() * 9;
      this.spawn(
        this.fire, x, y, z,
        Math.cos(a) * Math.cos(el) * sp, Math.sin(el) * sp, Math.sin(a) * Math.cos(el) * sp,
        1.0, 0.85, 0.3,
        0.1 + Math.random() * 0.12, 0.25 + Math.random() * 0.4, -9.8
      );
    }
    for (let i = 0; i < 10; i++) {
      this.spawn(this.smoke, x, y, z, (Math.random() - 0.5) * 1.4, 0.8 + Math.random(), (Math.random() - 0.5) * 1.4,
        0.12, 0.12, 0.11, 0.7 + Math.random() * 0.6, 1.0 + Math.random() * 0.8, 1.2);
    }
  }

  /** Пыль при жёсткой посадке */
  dust(x: number, y: number, z: number): void {
    for (let i = 0; i < 12; i++) {
      const a = Math.random() * Math.PI * 2;
      const sp = 0.8 + Math.random() * 2.4;
      this.spawn(this.smoke, x, y + 0.1, z,
        Math.cos(a) * sp, 0.4 + Math.random() * 0.8, Math.sin(a) * sp,
        0.42, 0.38, 0.28, 0.5 + Math.random() * 0.5, 0.5 + Math.random() * 0.4, 2.5);
    }
  }

  update(dt: number): void {
    for (const p of [this.fire, this.smoke]) {
      const { pos, vel, life, maxLife, alpha, grav, count } = p;
      for (let i = 0; i < count; i++) {
        if (life[i] <= 0) {
          alpha[i] = 0;
          continue;
        }
        life[i] -= dt;
        const k = Math.max(0, life[i] / maxLife[i]);
        alpha[i] = k * k * (p === this.smoke ? 0.55 : 0.95);
        vel[i * 3 + 1] -= grav[i] * dt;
        const dr = 1 - p.dragK * dt;
        vel[i * 3] *= dr;
        vel[i * 3 + 2] *= dr;
        pos[i * 3] += vel[i * 3] * dt;
        pos[i * 3 + 1] += vel[i * 3 + 1] * dt;
        pos[i * 3 + 2] += vel[i * 3 + 2] * dt;
        // дым растёт
        if (p === this.smoke) p.size[i] += dt * 0.9;
      }
      p.geo.attributes.position.needsUpdate = true;
      (p.geo.attributes.aColor as THREE.BufferAttribute).needsUpdate = false;
      (p.geo.attributes.aAlpha as THREE.BufferAttribute).needsUpdate = true;
      (p.geo.attributes.aSize as THREE.BufferAttribute).needsUpdate = true;
    }
  }

  dispose(scene: THREE.Scene): void {
    scene.remove(this.group);
    for (const d of this.disposables) d.dispose();
  }
}
