import * as THREE from 'three';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { ShaderPass } from 'three/examples/jsm/postprocessing/ShaderPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js';
import type { Quality } from '../types';

/**
 * Пост-обработка FPV: один кастомный шейдер
 * (виньетка + зерно + скан-линии + шум сигнала + хроматическая аберрация
 * + катящаяся полоса помех), опциональный bloom на desktop/high.
 */
const FPVShader = {
  uniforms: {
    tDiffuse: { value: null as THREE.Texture | null },
    uTime: { value: 0 },
    uNoise: { value: 0 },      // 0..1 помехи
    uVignette: { value: 0.55 },
    uGrain: { value: 0.06 },
    uScan: { value: 0.12 },
    uAberration: { value: 0.0022 },
    uBand: { value: 0 },       // катящаяся полоса
    uAnalog: { value: 1 },
  },
  vertexShader: /* glsl */ `
    varying vec2 vUv;
    void main() {
      vUv = uv;
      gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    }
  `,
  fragmentShader: /* glsl */ `
    uniform sampler2D tDiffuse;
    uniform float uTime;
    uniform float uNoise;
    uniform float uVignette;
    uniform float uGrain;
    uniform float uScan;
    uniform float uAberration;
    uniform float uBand;
    uniform float uAnalog;
    varying vec2 vUv;

    float hash(vec2 p) {
      return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453123);
    }

    void main() {
      vec2 uv = vUv;
      vec2 center = uv - 0.5;
      float dist = length(center);

      // хроматическая аберрация к краям
      float ab = uAberration * (1.0 + dist * 4.0) + uNoise * 0.004;
      float r = texture2D(tDiffuse, uv + center * ab).r;
      float g = texture2D(tDiffuse, uv).g;
      float b = texture2D(tDiffuse, uv - center * ab).b;
      vec3 col = vec3(r, g, b);

      // скан-линии (сильнее в аналоговом режиме)
      float scanAmt = uScan * mix(0.4, 1.0, uAnalog);
      float scan = sin(uv.y * 900.0) * 0.5 + 0.5;
      col *= 1.0 - scanAmt * scan * 0.5;

      // катящаяся полоса помех
      if (uBand > 0.001) {
        float bandY = fract(uTime * 0.13);
        float band = smoothstep(0.12, 0.0, abs(uv.y - bandY)) * uBand;
        col += band * 0.35;
        col = mix(col, vec3(0.8, 0.85, 0.8), band * 0.25);
      }

      // статический шум сигнала
      if (uNoise > 0.001) {
        float n = hash(uv * vec2(1000.0, 700.0) + fract(uTime) * 100.0);
        col = mix(col, vec3(n), clamp(uNoise, 0.0, 0.92));
      }

      // зерно
      float grain = (hash(uv * 800.0 + fract(uTime * 7.0)) - 0.5) * uGrain * (1.0 + uNoise * 2.0);
      col += grain;

      // виньетка
      float vig = smoothstep(0.85, 0.35, dist * (1.0 + uVignette));
      col *= mix(1.0, vig, uVignette + 0.25);

      gl_FragColor = vec4(col, 1.0);
    }
  `,
};

export class PostProcessing {
  private composer: EffectComposer;
  private fpvPass: ShaderPass;
  private bloom: UnrealBloomPass;
  private enabled = true;
  private width = 1;
  private height = 1;

  constructor(renderer: THREE.WebGLRenderer, scene: THREE.Scene, camera: THREE.Camera) {
    this.composer = new EffectComposer(renderer);
    this.composer.addPass(new RenderPass(scene, camera));

    this.bloom = new UnrealBloomPass(new THREE.Vector2(256, 256), 0.35, 0.5, 0.85);
    this.composer.addPass(this.bloom);

    this.fpvPass = new ShaderPass(FPVShader);
    this.composer.addPass(this.fpvPass);

    this.composer.addPass(new OutputPass());
  }

  setQuality(q: Quality, isMobile: boolean): void {
    const useBloom = q === 'high' && !isMobile;
    this.bloom.enabled = useBloom;
    this.enabled = q !== 'low';
    this.fpvPass.uniforms.uGrain.value = q === 'high' ? 0.05 : 0.075;
  }

  setCamera(camera: THREE.Camera): void {
    const renderPass = this.composer.passes[0] as RenderPass;
    renderPass.camera = camera;
  }

  update(time: number, noise: number, analog: boolean): void {
    const u = this.fpvPass.uniforms;
    u.uTime.value = time;
    u.uNoise.value = Math.min(0.95, noise);
    u.uAnalog.value = analog ? 1 : 0;
    u.uScan.value = analog ? 0.14 : 0.05;
    u.uBand.value = analog && noise > 0.45 ? 0.7 : analog ? 0.12 : 0;
  }

  setSize(w: number, h: number): void {
    this.width = w;
    this.height = h;
    this.composer.setSize(w, h);
  }

  render(renderer: THREE.WebGLRenderer, scene: THREE.Scene, camera: THREE.Camera): void {
    if (this.enabled) {
      this.composer.render();
    } else {
      renderer.render(scene, camera);
    }
  }

  get pixelWidth(): number {
    return this.width;
  }

  get pixelHeight(): number {
    return this.height;
  }
}
