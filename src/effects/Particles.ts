import {
  AdditiveBlending,
  BufferAttribute,
  BufferGeometry,
  Color,
  Group,
  Mesh,
  MeshBasicMaterial,
  NormalBlending,
  Points,
  RingGeometry,
  ShaderMaterial,
  SphereGeometry,
  Vector3,
} from 'three';

type RGB = [number, number, number];
const rgb = (hex: number): RGB => {
  const c = new Color(hex);
  return [c.r, c.g, c.b];
};

const VERT = /* glsl */ `
attribute vec4 aColor;
attribute float aSize;
uniform float uScale;
varying vec4 vColor;
void main(){
  vColor = aColor;
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  gl_Position = projectionMatrix * mv;
  gl_PointSize = min(aSize * uScale / max(-mv.z, 0.1), 160.0);
}`;
const FRAG = /* glsl */ `
varying vec4 vColor;
void main(){
  float d = length(gl_PointCoord - 0.5);
  float a = smoothstep(0.5, 0.12, d);
  if (a < 0.01) discard;
  gl_FragColor = vec4(vColor.rgb, vColor.a * a);
}`;

/** Пул частиц на Points: один draw call на систему, CPU-обновление */
class ParticleSystem {
  points: Points;
  private pos: Float32Array;
  private col: Float32Array;
  private size: Float32Array;
  private vel: Float32Array;
  private life: Float32Array;
  private maxLife: Float32Array;
  private s0: Float32Array;
  private s1: Float32Array;
  private c0: Float32Array;
  private c1: Float32Array;
  private a0: Float32Array;
  private drag: Float32Array;
  private grav: Float32Array;
  private next = 0;
  material: ShaderMaterial;

  constructor(private max: number, additive: boolean) {
    this.pos = new Float32Array(max * 3);
    this.col = new Float32Array(max * 4);
    this.size = new Float32Array(max);
    this.vel = new Float32Array(max * 3);
    this.life = new Float32Array(max);
    this.maxLife = new Float32Array(max).fill(1);
    this.s0 = new Float32Array(max);
    this.s1 = new Float32Array(max);
    this.c0 = new Float32Array(max * 3);
    this.c1 = new Float32Array(max * 3);
    this.a0 = new Float32Array(max);
    this.drag = new Float32Array(max);
    this.grav = new Float32Array(max);
    for (let i = 0; i < max; i++) this.pos[i * 3 + 1] = -1000;
    const g = new BufferGeometry();
    g.setAttribute('position', new BufferAttribute(this.pos, 3).setUsage(35048));
    g.setAttribute('aColor', new BufferAttribute(this.col, 4).setUsage(35048));
    g.setAttribute('aSize', new BufferAttribute(this.size, 1).setUsage(35048));
    this.material = new ShaderMaterial({
      uniforms: { uScale: { value: 500 } },
      vertexShader: VERT,
      fragmentShader: FRAG,
      transparent: true,
      depthWrite: false,
      blending: additive ? AdditiveBlending : NormalBlending,
    });
    this.points = new Points(g, this.material);
    this.points.frustumCulled = false;
  }

  emit(p: Vector3, vx: number, vy: number, vz: number, life: number, s0: number, s1: number, c0: RGB, c1: RGB, a0 = 1, drag = 1, grav = 0) {
    const i = this.next;
    this.next = (this.next + 1) % this.max;
    this.pos[i * 3] = p.x;
    this.pos[i * 3 + 1] = p.y;
    this.pos[i * 3 + 2] = p.z;
    this.vel[i * 3] = vx;
    this.vel[i * 3 + 1] = vy;
    this.vel[i * 3 + 2] = vz;
    this.life[i] = this.maxLife[i] = life;
    this.s0[i] = s0;
    this.s1[i] = s1;
    this.c0.set(c0, i * 3);
    this.c1.set(c1, i * 3);
    this.a0[i] = a0;
    this.drag[i] = drag;
    this.grav[i] = grav;
  }

  update(dt: number) {
    for (let i = 0; i < this.max; i++) {
      const l = this.life[i];
      if (l <= 0) {
        if (this.size[i] !== 0) this.size[i] = 0;
        continue;
      }
      const nl = l - dt;
      this.life[i] = nl;
      if (nl <= 0) {
        this.size[i] = 0;
        this.col[i * 4 + 3] = 0;
        continue;
      }
      const k = 1 - nl / this.maxLife[i]; // 0..1
      const dr = Math.exp(-this.drag[i] * dt);
      this.vel[i * 3] *= dr;
      this.vel[i * 3 + 1] = this.vel[i * 3 + 1] * dr - this.grav[i] * dt;
      this.vel[i * 3 + 2] *= dr;
      this.pos[i * 3] += this.vel[i * 3] * dt;
      this.pos[i * 3 + 1] += this.vel[i * 3 + 1] * dt;
      this.pos[i * 3 + 2] += this.vel[i * 3 + 2] * dt;
      if (this.pos[i * 3 + 1] < 0.05 && this.grav[i] > 0) {
        this.pos[i * 3 + 1] = 0.05;
        this.vel[i * 3 + 1] *= -0.3;
      }
      this.size[i] = this.s0[i] + (this.s1[i] - this.s0[i]) * k;
      this.col[i * 4] = this.c0[i * 3] + (this.c1[i * 3] - this.c0[i * 3]) * k;
      this.col[i * 4 + 1] = this.c0[i * 3 + 1] + (this.c1[i * 3 + 1] - this.c0[i * 3 + 1]) * k;
      this.col[i * 4 + 2] = this.c0[i * 3 + 2] + (this.c1[i * 3 + 2] - this.c0[i * 3 + 2]) * k;
      this.col[i * 4 + 3] = this.a0[i] * Math.min(1, (1 - k) * 2.2) * Math.min(1, k * 12 + 0.2);
    }
    const g = this.points.geometry;
    (g.getAttribute('position') as BufferAttribute).needsUpdate = true;
    (g.getAttribute('aColor') as BufferAttribute).needsUpdate = true;
    (g.getAttribute('aSize') as BufferAttribute).needsUpdate = true;
  }
}

interface Flash {
  mesh: Mesh;
  ring: Mesh;
  t: number;
}

/** Стилизованные эффекты: взрывы, искры, дым, пыль */
export class Particles {
  group = new Group();
  private fire = new ParticleSystem(700, true);
  private smoke = new ParticleSystem(900, false);
  private flashes: Flash[] = [];
  private v = new Vector3();
  private cFire0 = rgb(0xffa030);
  private cFire1 = rgb(0x501005);
  private cSpark0 = rgb(0xffe9a0);
  private cSpark1 = rgb(0xff5a10);
  private cSmoke0 = rgb(0x2a2927);
  private cSmoke1 = rgb(0x6c6a66);
  private cDust0 = rgb(0x8a7d62);
  private cDust1 = rgb(0x9b9484);
  private r = (a: number) => (Math.random() - 0.5) * 2 * a;

  constructor() {
    this.group.add(this.smoke.points, this.fire.points);
    const fm = () => new MeshBasicMaterial({ color: 0xffc070, transparent: true, opacity: 0, blending: AdditiveBlending, depthWrite: false });
    for (let i = 0; i < 3; i++) {
      const mesh = new Mesh(new SphereGeometry(1, 12, 8), fm());
      const ring = new Mesh(new RingGeometry(0.85, 1, 32), new MeshBasicMaterial({ color: 0xffe0b0, transparent: true, opacity: 0, side: 2, depthWrite: false }));
      ring.rotation.x = -Math.PI / 2;
      mesh.visible = ring.visible = false;
      this.group.add(mesh, ring);
      this.flashes.push({ mesh, ring, t: 99 });
    }
  }

  setScale(heightPx: number, fovDeg: number) {
    const s = heightPx / (2 * Math.tan((fovDeg * Math.PI) / 360));
    this.fire.material.uniforms.uScale.value = s;
    this.smoke.material.uniforms.uScale.value = s;
  }

  explosion(p: Vector3, big = 1) {
    const r = this.r;
    for (let i = 0; i < 38 * big; i++) {
      this.fire.emit(p, r(5 * big), Math.random() * 6 * big + 1, r(5 * big), 0.45 + Math.random() * 0.7, 2.2 * big, 6.5 * big, this.cFire0, this.cFire1, 1, 2.2);
    }
    for (let i = 0; i < 36; i++) {
      this.fire.emit(p, r(16), Math.random() * 14 + 2, r(16), 0.5 + Math.random() * 0.6, 0.35, 0.1, this.cSpark0, this.cSpark1, 1, 0.4, 9);
    }
    for (let i = 0; i < 34 * big; i++) {
      this.v.set(p.x + r(1.2), p.y + Math.random(), p.z + r(1.2));
      this.smoke.emit(this.v, r(2.5), 1.2 + Math.random() * 3, r(2.5), 2.5 + Math.random() * 2.5, 3, 10 * big, this.cSmoke0, this.cSmoke1, 0.85, 0.8);
    }
    for (let i = 0; i < 22; i++) {
      const a = Math.random() * 6.28;
      const sp = 6 + Math.random() * 8;
      this.smoke.emit(p, Math.cos(a) * sp, 0.4, Math.sin(a) * sp, 1.3, 2.5, 7, this.cDust0, this.cDust1, 0.5, 3);
    }
    const f = this.flashes.find((x) => x.t > 1) ?? this.flashes[0];
    f.t = 0;
    f.mesh.position.copy(p);
    f.ring.position.set(p.x, p.y + 0.15, p.z);
    f.mesh.visible = f.ring.visible = true;
    f.mesh.scale.setScalar(1);
  }

  sparks(p: Vector3, n = 20, power = 1) {
    const r = this.r;
    for (let i = 0; i < n; i++) {
      this.fire.emit(p, r(5 * power), Math.random() * 4 * power, r(5 * power), 0.3 + Math.random() * 0.4, 0.2, 0.06, this.cSpark0, this.cSpark1, 1, 0.5, 9);
    }
  }

  smokePuff(p: Vector3, n = 1, size = 1.2) {
    for (let i = 0; i < n; i++) {
      this.smoke.emit(p, this.r(0.4), 0.8 + Math.random() * 0.8, this.r(0.4), 2 + Math.random() * 1.5, size * 0.6, size * 3, this.cSmoke0, this.cSmoke1, 0.7, 0.6);
    }
  }

  dust(p: Vector3, outward: Vector3, n = 2) {
    for (let i = 0; i < n; i++) {
      const a = Math.random() * 6.28;
      const sp = 3 + Math.random() * 3;
      this.smoke.emit(p, Math.cos(a) * sp + outward.x, 0.3 + Math.random() * 0.6, Math.sin(a) * sp + outward.z, 0.9, 0.4, 1.8, this.cDust0, this.cDust1, 0.35, 2.2);
    }
  }

  update(dt: number) {
    this.fire.update(dt);
    this.smoke.update(dt);
    for (const f of this.flashes) {
      if (f.t > 1) continue;
      f.t += dt * 2.6;
      const k = f.t;
      if (k > 1) {
        f.mesh.visible = f.ring.visible = false;
        continue;
      }
      f.mesh.scale.setScalar(1 + k * 5);
      (f.mesh.material as MeshBasicMaterial).opacity = (1 - k) * 0.9;
      f.ring.scale.setScalar(1 + k * 9);
      (f.ring.material as MeshBasicMaterial).opacity = (1 - k) * 0.7;
    }
  }
}
