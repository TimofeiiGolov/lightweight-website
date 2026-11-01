import * as THREE from 'three';
import type { LightingMode, Quality } from '../types';
import { isMobileDevice } from '../utils/MathUtils';

/** Рендерер, сцена, свет, адаптивное качество */
export class SceneManager {
  readonly renderer: THREE.WebGLRenderer;
  readonly scene: THREE.Scene;
  readonly sun: THREE.DirectionalLight;
  readonly hemi: THREE.HemisphereLight;

  quality: Quality = 'medium';
  private readonly dprCap: number;
  private container: HTMLElement;
  private shadowOn = false;
  private lighting: LightingMode = 'day';

  constructor(container: HTMLElement) {
    this.container = container;
    const mobile = isMobileDevice();
    this.dprCap = mobile ? 2 : 2;

    this.renderer = new THREE.WebGLRenderer({
      antialias: true,
      powerPreference: 'high-performance',
    });
    this.renderer.shadowMap.type = THREE.PCFShadowMap;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.05;
    container.appendChild(this.renderer.domElement);

    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(0x9db8c9);

    this.hemi = new THREE.HemisphereLight(0xcfe4ff, 0x51583c, 1.0);
    this.scene.add(this.hemi);

    this.sun = new THREE.DirectionalLight(0xfff2d8, 2.4);
    this.sun.position.set(80, 120, 40);
    this.sun.shadow.camera.left = -110;
    this.sun.shadow.camera.right = 110;
    this.sun.shadow.camera.top = 110;
    this.sun.shadow.camera.bottom = -110;
    this.sun.shadow.camera.near = 10;
    this.sun.shadow.camera.far = 400;
    this.sun.shadow.mapSize.set(2048, 2048);
    this.sun.shadow.bias = -0.0004;
    this.scene.add(this.sun);
    this.scene.add(this.sun.target);

    window.addEventListener('resize', () => this.resize());
    this.resize();
  }

  /** Применить качество: разрешение рендера, тени */
  setQuality(q: Quality): void {
    this.quality = q;
    const dpr = Math.min(window.devicePixelRatio || 1, this.dprCap);
    const scale = q === 'low' ? 0.7 : q === 'medium' ? 1.0 : 1.0;
    this.renderer.setPixelRatio(dpr * scale);

    const wantShadow = q === 'high' && !isMobileDevice();
    if (wantShadow !== this.shadowOn) {
      this.shadowOn = wantShadow;
      this.renderer.shadowMap.enabled = wantShadow;
      this.sun.castShadow = wantShadow;
      this.scene.traverse((obj) => {
        const mesh = obj as THREE.Mesh;
        if (mesh.isMesh) {
          const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
          for (const m of mats) m.needsUpdate = true;
        }
      });
    }
    this.resize();
  }

  /** День / сумерки */
  applyLighting(mode: LightingMode): void {
    this.lighting = mode;
    if (mode === 'day') {
      (this.scene.background as THREE.Color).setHex(0x9db8c9);
      this.scene.fog = new THREE.Fog(0x9db8c9, 90, 340);
      this.hemi.intensity = 1.0;
      this.hemi.color.setHex(0xcfe4ff);
      this.sun.intensity = 2.4;
      this.sun.color.setHex(0xfff2d8);
      this.sun.position.set(80, 120, 40);
      this.renderer.toneMappingExposure = 1.05;
    } else {
      (this.scene.background as THREE.Color).setHex(0x4a4356);
      this.scene.fog = new THREE.Fog(0x4a4356, 60, 280);
      this.hemi.intensity = 0.5;
      this.hemi.color.setHex(0x8a7ba6);
      this.sun.intensity = 1.1;
      this.sun.color.setHex(0xff9a4d);
      this.sun.position.set(-120, 35, -60);
      this.renderer.toneMappingExposure = 1.25;
    }
  }

  currentLighting(): LightingMode {
    return this.lighting;
  }

  resize(): void {
    const w = this.container.clientWidth || window.innerWidth;
    const h = this.container.clientHeight || window.innerHeight;
    this.renderer.setSize(w, h, false);
  }

  get width(): number {
    return this.container.clientWidth || window.innerWidth;
  }

  get height(): number {
    return this.container.clientHeight || window.innerHeight;
  }
}
