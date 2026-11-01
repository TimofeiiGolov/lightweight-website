import {
  Color,
  DirectionalLight,
  Fog,
  HemisphereLight,
  Mesh,
  PCFShadowMap,
  PerspectiveCamera,
  Scene,
  ShaderMaterial,
  SphereGeometry,
  BackSide,
  Vector3,
  WebGLRenderer,
} from 'three';
import type { TimeOfDay } from '../config';

interface Tod {
  top: number;
  horizon: number;
  fogFar: number;
  sunColor: number;
  sunInt: number;
  sunDir: [number, number, number];
  hemiSky: number;
  hemiGround: number;
  hemiInt: number;
  gain: number;
  stars: number;
  lamps: boolean;
  noise: number; // доп. шум изображения в темноте
}

export const TOD: Record<TimeOfDay, Tod> = {
  day: { top: 0x3f78c0, horizon: 0xb8cfe0, fogFar: 700, sunColor: 0xfff1d6, sunInt: 3.0, sunDir: [0.5, 0.8, 0.3], hemiSky: 0xcfe4ff, hemiGround: 0x6a6a4a, hemiInt: 1.5, gain: 1.15, stars: 0, lamps: false, noise: 0 },
  dusk: { top: 0x2d3c70, horizon: 0xe69468, fogFar: 450, sunColor: 0xff9650, sunInt: 2.0, sunDir: [0.9, 0.2, 0.25], hemiSky: 0x8a96c8, hemiGround: 0x4a3a34, hemiInt: 0.9, gain: 1.3, stars: 0.3, lamps: true, noise: 0.02 },
  night: { top: 0x01030a, horizon: 0x0d1830, fogFar: 300, sunColor: 0x8fa8ff, sunInt: 0.5, sunDir: [-0.4, 0.7, 0.3], hemiSky: 0x2a3c66, hemiGround: 0x0b0d14, hemiInt: 0.6, gain: 2.3, stars: 1, lamps: true, noise: 0.05 },
};

const SKY_VERT = /* glsl */ `
varying vec3 vDir;
void main(){
  vDir = normalize(position);
  vec4 p = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  gl_Position = p.xyww;
}`;
const SKY_FRAG = /* glsl */ `
uniform vec3 uTop, uHorizon, uSunDir, uSunColor;
uniform float uStars;
varying vec3 vDir;
float hash(vec3 p){ return fract(sin(dot(p, vec3(127.1, 311.7, 74.7))) * 43758.5453); }
void main(){
  vec3 d = normalize(vDir);
  float h = clamp(d.y, 0.0, 1.0);
  vec3 c = mix(uHorizon, uTop, pow(h, 0.5));
  float s = max(dot(d, normalize(uSunDir)), 0.0);
  c += uSunColor * (pow(s, 900.0) * 4.0 + pow(s, 14.0) * 0.22);
  if (d.y < 0.0) c = mix(uHorizon, uHorizon * 0.8, clamp(-d.y * 4.0, 0.0, 1.0));
  if (uStars > 0.0) {
    float st = step(0.9972, hash(floor(d * 260.0)));
    c += vec3(st) * uStars * smoothstep(0.02, 0.25, d.y);
  }
  gl_FragColor = vec4(c, 1.0);
  #include <colorspace_fragment>
}`;

export class SceneManager {
  renderer: WebGLRenderer;
  scene = new Scene();
  camera = new PerspectiveCamera(100, 1, 0.05, 1600);
  sun = new DirectionalLight(0xffffff, 3);
  hemi = new HemisphereLight(0xffffff, 0x444444, 1.2);
  sky: Mesh;
  tod: TimeOfDay = 'day';
  gain = 1;
  extraNoise = 0;
  private skyMat: ShaderMaterial;
  private shadowSize = 0;

  constructor(canvas: HTMLCanvasElement) {
    this.renderer = new WebGLRenderer({ canvas, antialias: false, powerPreference: 'high-performance', stencil: false, alpha: false });
    this.renderer.shadowMap.type = PCFShadowMap;
    this.scene.add(this.camera);
    this.scene.add(this.hemi, this.sun, this.sun.target);
    this.skyMat = new ShaderMaterial({
      uniforms: {
        uTop: { value: new Color() },
        uHorizon: { value: new Color() },
        uSunDir: { value: new Vector3(0, 1, 0) },
        uSunColor: { value: new Color() },
        uStars: { value: 0 },
      },
      vertexShader: SKY_VERT,
      fragmentShader: SKY_FRAG,
      side: BackSide,
      depthWrite: false,
      fog: false,
    });
    this.sky = new Mesh(new SphereGeometry(1000, 20, 12), this.skyMat);
    this.sky.frustumCulled = false;
    this.sky.renderOrder = -10;
    this.scene.add(this.sky);
    this.scene.fog = new Fog(0xffffff, 40, 700);
    this.setTimeOfDay('day');
  }

  /** Сумерки/ночь: меняет небо, туман, свет, усиление камеры */
  setTimeOfDay(t: TimeOfDay) {
    this.tod = t;
    const p = TOD[t];
    const u = this.skyMat.uniforms;
    u.uTop.value.setHex(p.top);
    u.uHorizon.value.setHex(p.horizon);
    u.uSunColor.value.setHex(p.sunColor);
    u.uSunDir.value.set(...p.sunDir).normalize();
    u.uStars.value = p.stars;
    const fog = this.scene.fog as Fog;
    fog.color.setHex(p.horizon).multiplyScalar(t === 'day' ? 1 : 0.9);
    fog.near = 30;
    fog.far = p.fogFar;
    this.sun.color.setHex(p.sunColor);
    this.sun.intensity = p.sunInt;
    this.sun.position.set(...p.sunDir).normalize().multiplyScalar(150);
    this.hemi.color.setHex(p.hemiSky);
    this.hemi.groundColor.setHex(p.hemiGround);
    this.hemi.intensity = p.hemiInt;
    this.gain = p.gain;
    this.extraNoise = p.noise;
  }

  setShadows(size: number) {
    if (size === this.shadowSize) return;
    this.shadowSize = size;
    this.renderer.shadowMap.enabled = size > 0;
    this.sun.castShadow = size > 0;
    if (size > 0) {
      const s = this.sun.shadow;
      s.mapSize.set(size, size);
      s.map?.dispose();
      s.map = null;
      const c = s.camera;
      c.left = c.bottom = -45;
      c.right = c.top = 45;
      c.near = 1;
      c.far = 400;
      c.updateProjectionMatrix();
      s.bias = -0.0006;
      s.normalBias = 0.05;
    }
  }

  /** Тень «следует» за камерой с привязкой к сетке текселей */
  followShadow(p: Vector3) {
    if (!this.sun.castShadow) return;
    const step = 90 / this.shadowSize;
    const x = Math.round(p.x / step) * step;
    const z = Math.round(p.z / step) * step;
    const dir = this.sun.position.clone().sub(this.sun.target.position);
    this.sun.target.position.set(x, 0, z);
    this.sun.position.copy(this.sun.target.position).add(dir);
    this.sun.target.updateMatrixWorld();
  }

  setFov(hFovDeg: number) {
    const a = this.camera.aspect;
    const h = Math.tan((hFovDeg * Math.PI) / 360);
    const v = (2 * Math.atan(h / a) * 180) / Math.PI;
    this.camera.fov = Math.min(Math.max(v, 45), 118);
    this.camera.updateProjectionMatrix();
  }

  resizeCamera(w: number, h: number) {
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
  }

  updateSky(camPos: Vector3) {
    this.sky.position.copy(camPos);
  }
}
