import * as THREE from 'three';

/**
 * Визуальная модель дрона: 5" фрейм, 4 мотора, пропеллеры,
 * батарея, FPV-камера, антенна и условный подвес с грузом.
 * Вся геометрия процедурная low-poly, материалы переиспользуются.
 */
export class DroneVisual {
  readonly group = new THREE.Group();
  private props: THREE.Mesh[] = [];
  private propDiscs: THREE.Mesh[] = [];
  private payloadGroup: THREE.Group;
  private matBody: THREE.MeshStandardMaterial;
  private matDark: THREE.MeshStandardMaterial;
  private matAccent: THREE.MeshStandardMaterial;
  private matProp: THREE.MeshStandardMaterial;
  private matDisc: THREE.MeshBasicMaterial;
  private matPayload: THREE.MeshStandardMaterial;

  constructor() {
    this.matBody = new THREE.MeshStandardMaterial({ color: 0x3d4433, roughness: 0.75, metalness: 0.25 });
    this.matDark = new THREE.MeshStandardMaterial({ color: 0x14161a, roughness: 0.6, metalness: 0.4 });
    this.matAccent = new THREE.MeshStandardMaterial({ color: 0xd8842a, roughness: 0.5, metalness: 0.1 });
    this.matProp = new THREE.MeshStandardMaterial({ color: 0x0c0e10, roughness: 0.4, metalness: 0.2, transparent: true, opacity: 0.92 });
    this.matDisc = new THREE.MeshBasicMaterial({ color: 0x1a1d14, transparent: true, opacity: 0.14, side: THREE.DoubleSide, depthWrite: false });
    this.matPayload = new THREE.MeshStandardMaterial({ color: 0x2f3a22, roughness: 0.8, metalness: 0.05 });

    // центральная пластина
    const plate = new THREE.Mesh(new THREE.BoxGeometry(0.075, 0.02, 0.16), this.matBody);
    this.group.add(plate);

    // верхняя крышка + батарея
    const batt = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.028, 0.095), this.matDark);
    batt.position.set(0, 0.035, 0.01);
    this.group.add(batt);
    const strap = new THREE.Mesh(new THREE.BoxGeometry(0.056, 0.032, 0.018), this.matAccent);
    strap.position.set(0, 0.036, 0.01);
    this.group.add(strap);

    // FPV-камера спереди
    const camBox = new THREE.Mesh(new THREE.BoxGeometry(0.035, 0.03, 0.02), this.matDark);
    camBox.position.set(0, 0.03, -0.085);
    camBox.rotation.x = -0.35;
    this.group.add(camBox);
    const lens = new THREE.Mesh(new THREE.CylinderGeometry(0.009, 0.011, 0.012, 10), this.matDark);
    lens.rotation.x = Math.PI / 2 - 0.35;
    lens.position.set(0, 0.038, -0.098);
    this.group.add(lens);

    // антенна сзади
    const ant = new THREE.Mesh(new THREE.CylinderGeometry(0.003, 0.003, 0.09, 6), this.matDark);
    ant.position.set(0, 0.07, 0.09);
    ant.rotation.x = 0.5;
    this.group.add(ant);
    const antTip = new THREE.Mesh(new THREE.SphereGeometry(0.008, 6, 6), this.matAccent);
    antTip.position.set(0, 0.112, 0.108);
    this.group.add(antTip);

    // лучи + моторы + пропеллеры (диагонали)
    const armGeo = new THREE.BoxGeometry(0.018, 0.012, 0.13);
    const motorGeo = new THREE.CylinderGeometry(0.016, 0.018, 0.026, 10);
    const propGeo = new THREE.BoxGeometry(0.23, 0.003, 0.018);
    const discGeo = new THREE.CircleGeometry(0.115, 20);
    const dirs: Array<[number, number]> = [[1, 1], [1, -1], [-1, 1], [-1, -1]];
    for (const [dx, dz] of dirs) {
      const arm = new THREE.Mesh(armGeo, this.matBody);
      arm.position.set(dx * 0.06, 0, dz * 0.06);
      arm.rotation.y = Math.atan2(dx, dz) + Math.PI / 2;
      this.group.add(arm);

      const motor = new THREE.Mesh(motorGeo, this.matDark);
      motor.position.set(dx * 0.115, 0.028, dz * 0.115);
      this.group.add(motor);

      const prop = new THREE.Mesh(propGeo, this.matProp);
      prop.position.set(dx * 0.115, 0.045, dz * 0.115);
      this.props.push(prop);
      this.group.add(prop);

      // полупрозрачный диск «размытия» винта
      const disc = new THREE.Mesh(discGeo, this.matDisc);
      disc.rotation.x = -Math.PI / 2;
      disc.position.set(dx * 0.115, 0.0455, dz * 0.115);
      disc.visible = false;
      this.propDiscs.push(disc);
      this.group.add(disc);
    }

    // условный подвес с грузом
    this.payloadGroup = new THREE.Group();
    const bombBody = new THREE.Mesh(new THREE.CapsuleGeometry(0.02, 0.045, 4, 10), this.matPayload);
    this.payloadGroup.add(bombBody);
    for (const a of [0, Math.PI / 2, Math.PI, (3 * Math.PI) / 2]) {
      const fin = new THREE.Mesh(new THREE.BoxGeometry(0.004, 0.03, 0.016), this.matPayload);
      fin.position.set(Math.sin(a) * 0.018, -0.038, Math.cos(a) * 0.018);
      fin.rotation.y = a;
      this.payloadGroup.add(fin);
    }
    const mount = new THREE.Mesh(new THREE.BoxGeometry(0.03, 0.012, 0.03), this.matDark);
    mount.position.y = 0.035;
    this.payloadGroup.add(mount);
    this.payloadGroup.position.set(0, -0.05, 0.02);
    this.group.add(this.payloadGroup);
  }

  /** Синхронизация визуала с физическим телом */
  sync(pos: THREE.Vector3, quat: THREE.Quaternion): void {
    this.group.position.copy(pos);
    this.group.quaternion.copy(quat);
  }

  /** Вращение пропеллеров + диск размытия */
  updateProps(dt: number, spool: number, armed: boolean): void {
    const spin = spool * (40 + 160 * spool);
    for (let i = 0; i < this.props.length; i++) {
      this.props[i].rotation.y += spin * dt * (i % 2 === 0 ? 1 : -1);
      this.props[i].visible = !(armed && spool > 0.35);
      this.propDiscs[i].visible = armed && spool > 0.35;
    }
  }

  showPayload(visible: boolean): void {
    this.payloadGroup.visible = visible;
  }

  dispose(scene: THREE.Scene): void {
    scene.remove(this.group);
    this.group.traverse((o) => {
      const m = o as THREE.Mesh;
      if (m.isMesh) m.geometry.dispose();
    });
    [this.matBody, this.matDark, this.matAccent, this.matProp, this.matDisc, this.matPayload].forEach((m) => m.dispose());
  }
}
