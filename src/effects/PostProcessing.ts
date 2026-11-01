import {
  BufferGeometry,
  Camera,
  Float32BufferAttribute,
  HalfFloatType,
  LinearFilter,
  Mesh,
  OrthographicCamera,
  Scene,
  ShaderMaterial,
  UnsignedByteType,
  WebGLRenderTarget,
  type WebGLRenderer,
} from 'three';

export interface FxParams {
  noise: number; // снег при потере сигнала 0..1
  glitch: number; // горизонтальные полосы 0..1
  vignette: number;
  chroma: number;
  grain: number;
  scan: number;
  gain: number;
  sat: number;
  analog: number; // 0 цифра / 1 аналог
  flash: number;
}

const FRAG = /* glsl */ `
precision highp float;
uniform sampler2D tDiffuse;
uniform vec2 uRes;
uniform float uTime, uNoise, uGlitch, uVignette, uChroma, uGrain, uScan, uGain, uSat, uAnalog, uFlash;
varying vec2 vUv;
float hash(vec2 p){ return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
vec3 aces(vec3 x){ return clamp((x*(2.51*x+0.03))/(x*(2.43*x+0.59)+0.14), 0.0, 1.0); }
void main(){
  vec2 uv = vUv;
  // горизонтальные полосы помех
  float row = floor(uv.y * 70.0);
  float r = hash(vec2(row, floor(uTime * 14.0)));
  float tear = step(1.0 - uGlitch * 0.45, r) * (r - 0.5) * 0.25 * uGlitch;
  uv.x += tear + sin(uv.y * 9.0 + uTime * 25.0) * 0.006 * uGlitch * uGlitch;
  vec2 c = uv - 0.5;
  float amt = uChroma * (0.0012 + dot(c, c) * 0.014);
  vec3 col;
  col.r = texture2D(tDiffuse, uv + c * amt * 1.5).r;
  col.g = texture2D(tDiffuse, uv).g;
  col.b = texture2D(tDiffuse, uv - c * amt * 1.5).b;
  if (uAnalog > 0.01) {
    vec2 px = vec2(1.6 / uRes.x, 0.0);
    vec3 bl = 0.5 * (texture2D(tDiffuse, uv + px).rgb + texture2D(tDiffuse, uv - px).rgb);
    col = mix(col, bl, 0.45 * uAnalog);
  }
  col *= uGain;
  col = aces(col);
  float l = dot(col, vec3(0.299, 0.587, 0.114));
  col = mix(vec3(l), col, uSat);
  if (uAnalog > 0.01) {
    col *= 1.0 - uScan * uAnalog * 0.14 * (0.5 + 0.5 * sin(uv.y * uRes.y * 1.5708));
    col *= vec3(1.0, 1.02, 0.97);
  }
  float n = hash(uv * uRes + fract(uTime) * 91.7);
  col += (n - 0.5) * uGrain;
  col = mix(col, vec3(hash(uv * uRes * 0.5 + uTime) * 0.8 + 0.1), clamp(uNoise, 0.0, 1.0));
  float v = smoothstep(0.95, 0.3, length(c) * 1.25);
  col *= mix(1.0, v, uVignette);
  col = mix(col, vec3(1.0), uFlash);
  gl_FragColor = vec4(col, 1.0);
  #include <colorspace_fragment>
}`;

/** Рендер сцены в RT и один полноэкранный проход с FPV-эффектами */
export class PostProcessing {
  rt: WebGLRenderTarget;
  private scene = new Scene();
  private cam = new OrthographicCamera(-1, 1, 1, -1, 0, 1);
  private mat: ShaderMaterial;
  private halfOk: boolean;
  private floatOk: boolean;
  time = 0;

  constructor(private renderer: WebGLRenderer) {
    this.floatOk = renderer.extensions.has('EXT_color_buffer_float');
    this.halfOk = this.floatOk || renderer.extensions.has('EXT_color_buffer_half_float');
    this.rt = this.makeRT(2, 2, 0);
    this.mat = new ShaderMaterial({
      uniforms: {
        tDiffuse: { value: this.rt.texture },
        uRes: { value: [2, 2] },
        uTime: { value: 0 },
        uNoise: { value: 0 },
        uGlitch: { value: 0 },
        uVignette: { value: 0.6 },
        uChroma: { value: 1 },
        uGrain: { value: 0.05 },
        uScan: { value: 1 },
        uGain: { value: 1 },
        uSat: { value: 1 },
        uAnalog: { value: 1 },
        uFlash: { value: 0 },
      },
      vertexShader: 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }',
      fragmentShader: FRAG,
      depthTest: false,
      depthWrite: false,
    });
    const g = new BufferGeometry();
    g.setAttribute('position', new Float32BufferAttribute([-1, -1, 0, 3, -1, 0, -1, 3, 0], 3));
    g.setAttribute('uv', new Float32BufferAttribute([0, 0, 2, 0, 0, 2], 2));
    const quad = new Mesh(g, this.mat);
    quad.frustumCulled = false;
    this.scene.add(quad);
  }

  private makeRT(w: number, h: number, samples: number) {
    return new WebGLRenderTarget(w, h, {
      // MSAA для RGBA16F требует EXT_color_buffer_float; иначе безопасный 8-бит
      type: (samples > 0 ? this.floatOk : this.halfOk) ? HalfFloatType : UnsignedByteType,
      minFilter: LinearFilter,
      magFilter: LinearFilter,
      depthBuffer: true,
      samples,
    });
  }

  setSize(w: number, h: number, samples: number) {
    this.rt.dispose();
    this.rt = this.makeRT(w, h, samples);
    this.mat.uniforms.tDiffuse.value = this.rt.texture;
    this.mat.uniforms.uRes.value = [w, h];
  }

  render(scene: Scene, camera: Camera, p: FxParams, dt: number) {
    this.time += dt;
    const u = this.mat.uniforms;
    u.uTime.value = this.time;
    u.uNoise.value = p.noise;
    u.uGlitch.value = p.glitch;
    u.uVignette.value = p.vignette;
    u.uChroma.value = p.chroma;
    u.uGrain.value = p.grain;
    u.uScan.value = p.scan;
    u.uGain.value = p.gain;
    u.uSat.value = p.sat;
    u.uAnalog.value = p.analog;
    u.uFlash.value = p.flash;
    this.renderer.setRenderTarget(this.rt);
    this.renderer.render(scene, camera);
    this.renderer.setRenderTarget(null);
    this.renderer.render(this.scene, this.cam);
  }
}
