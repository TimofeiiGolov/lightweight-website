import { PerspectiveCamera, Quaternion, Vector3 } from 'three';
import { damp, DEG } from '../utils/MathUtils';

export type CamMode = 'fpv' | 'chase';

/** FPV-камера жёстко закреплена на дрона (с наклоном и вибрацией моторов) + режим внешнего обзора */
export class CameraFPV {
  mode: CamMode = 'fpv';
  tilt = 25;
  private t = 0;
  private chase = new Vector3();
  private chaseInit = false;
  private off = new Vector3();
  private tq = new Quaternion();
  private jq = new Quaternion();
  private fwd = new Vector3();
  private X = new Vector3(1, 0, 0);

  constructor(public camera: PerspectiveCamera) {}

  resetChase() {
    this.chaseInit = false;
  }

  update(dt: number, pos: Vector3, quat: Quaternion, avgMotor: number, speed: number, shake: number) {
    this.t += dt;
    const cam = this.camera;
    if (this.mode === 'fpv') {
      // вибрация от моторов: суммa высокочастотных синусов
      const a = (0.0007 + avgMotor * 0.0022 + Math.min(speed, 30) * 0.00003) * (1 + shake * 6);
      const t = this.t;
      const jx = Math.sin(t * 91.3) * a + Math.sin(t * 57.1) * a * 0.6;
      const jy = Math.sin(t * 83.7 + 1.3) * a + Math.sin(t * 61.9) * a * 0.6;
      this.off.set(jx * 0.5, 0.035 + jy * 0.5, -0.13).applyQuaternion(quat);
      cam.position.copy(pos).add(this.off);
      this.tq.setFromAxisAngle(this.X, this.tilt * DEG);
      this.jq.setFromAxisAngle(this.X, jy * 1.4).multiply(new Quaternion().setFromAxisAngle(new Vector3(0, 0, 1), jx * 1.4));
      cam.quaternion.copy(quat).multiply(this.tq).multiply(this.jq);
    } else {
      this.fwd.set(0, 0, -1).applyQuaternion(quat);
      this.fwd.y = 0;
      if (this.fwd.lengthSq() < 1e-4) this.fwd.set(0, 0, -1);
      this.fwd.normalize();
      const tx = pos.x - this.fwd.x * 2.4;
      const ty = pos.y + 0.8;
      const tz = pos.z - this.fwd.z * 2.4;
      if (!this.chaseInit) {
        this.chase.set(tx, ty, tz);
        this.chaseInit = true;
      }
      this.chase.x = damp(this.chase.x, tx, 7, dt);
      this.chase.y = damp(this.chase.y, ty, 7, dt);
      this.chase.z = damp(this.chase.z, tz, 7, dt);
      cam.position.copy(this.chase);
      cam.lookAt(pos.x, pos.y + 0.1, pos.z);
    }
  }
}
