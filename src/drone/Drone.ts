import {
  BoxGeometry,
  CircleGeometry,
  CylinderGeometry,
  ConeGeometry,
  Group,
  Mesh,
  MeshBasicMaterial,
  MeshLambertMaterial,
} from 'three';

const MOTORS: [number, number][] = [
  [-0.12, -0.13],
  [0.12, -0.13],
  [-0.12, 0.13],
  [0.12, 0.13],
];

/** Визуальная модель 7" FPV-дрона с условным учебным грузом */
export class Drone {
  group = new Group();
  payload = new Group();
  private props: Mesh[] = [];
  private blades: Group[] = [];
  private discs: MeshBasicMaterial[] = [];
  private angle = [0, 0, 0, 0];

  constructor() {
    const carbon = new MeshLambertMaterial({ color: 0x1b1c1e });
    const carbon2 = new MeshLambertMaterial({ color: 0x2b2d31 });
    const orange = new MeshLambertMaterial({ color: 0xd9792b });
    const metal = new MeshLambertMaterial({ color: 0x777b80 });
    const olive = new MeshLambertMaterial({ color: 0x59633f });
    const red = new MeshBasicMaterial({ color: 0xff2a1a });
    const white = new MeshBasicMaterial({ color: 0xffffff });

    const add = (geo: BoxGeometry | CylinderGeometry, mat: MeshLambertMaterial | MeshBasicMaterial, x: number, y: number, z: number, ry = 0) => {
      const m = new Mesh(geo, mat);
      m.position.set(x, y, z);
      m.rotation.y = ry;
      m.castShadow = true;
      this.group.add(m);
      return m;
    };

    // корпус: нижняя и верхняя карбоновые пластины
    add(new BoxGeometry(0.07, 0.008, 0.2), carbon, 0, -0.012, 0);
    add(new BoxGeometry(0.06, 0.008, 0.17), carbon2, 0, 0.034, 0.01);
    // стойки и стек электроники
    add(new BoxGeometry(0.045, 0.03, 0.1), carbon, 0, 0.012, 0.01);
    // аккумулятор
    add(new BoxGeometry(0.05, 0.034, 0.13), orange, 0, 0.058, 0.03);
    // камера FPV спереди
    add(new BoxGeometry(0.036, 0.034, 0.03), carbon2, 0, 0.02, -0.105);
    const lens = add(new CylinderGeometry(0.011, 0.011, 0.012, 10), metal, 0, 0.02, -0.124);
    lens.rotation.x = Math.PI / 2;
    // антенна
    add(new CylinderGeometry(0.002, 0.002, 0.09, 4), carbon, 0, 0.1, 0.1);

    const armLen = Math.hypot(0.12, 0.13);
    MOTORS.forEach(([x, z], i) => {
      const ang = Math.atan2(x, z);
      const arm = add(new BoxGeometry(0.02, 0.008, armLen), carbon2, x / 2, -0.004, z / 2);
      arm.rotation.y = ang;
      // мотор
      add(new CylinderGeometry(0.017, 0.019, 0.026, 10), metal, x, 0.012, z);
      // ножка
      add(new CylinderGeometry(0.008, 0.008, 0.03, 6), carbon, x, -0.018, z);
      // светодиоды: красные спереди, белые сзади
      add(new BoxGeometry(0.012, 0.004, 0.012), z < 0 ? red : white, x * 1.0, 0.0, z * 1.1);

      // ротор: две лопасти + диск размытия
      const holder = new Group();
      holder.position.set(x, 0.034, z);
      const bladeG = new Group();
      const b1 = new Mesh(new BoxGeometry(0.17, 0.003, 0.016), new MeshLambertMaterial({ color: 0x15171a }));
      bladeG.add(b1);
      const hub = new Mesh(new CylinderGeometry(0.01, 0.01, 0.012, 8), orange);
      holder.add(bladeG, hub);
      const discMat = new MeshBasicMaterial({ color: 0x9aa0a6, transparent: true, opacity: 0, depthWrite: false });
      const disc = new Mesh(new CircleGeometry(0.087, 24), discMat);
      disc.rotation.x = -Math.PI / 2;
      disc.position.y = 0.002;
      holder.add(disc);
      this.group.add(holder);
      this.props.push(holder as unknown as Mesh);
      this.blades.push(bladeG);
      this.discs.push(discMat);
      this.angle[i] = Math.random() * 6;
    });

    // условный учебный груз (инертный макет) под корпусом
    const body = new Mesh(new CylinderGeometry(0.03, 0.03, 0.15, 12), olive);
    body.rotation.x = Math.PI / 2;
    const nose = new Mesh(new ConeGeometry(0.03, 0.05, 12), olive);
    nose.rotation.x = -Math.PI / 2;
    nose.position.z = -0.1;
    const band = new Mesh(new CylinderGeometry(0.0305, 0.0305, 0.02, 12), new MeshLambertMaterial({ color: 0xb8302a }));
    band.rotation.x = Math.PI / 2;
    band.position.z = 0.02;
    const fin = new Mesh(new BoxGeometry(0.06, 0.06, 0.004), carbon);
    fin.position.z = 0.08;
    this.payload.add(body, nose, band, fin);
    this.payload.position.set(0, -0.06, 0.0);
    this.payload.traverse((o) => (o.castShadow = true));
    this.group.add(this.payload);
  }

  /** Анимация винтов: скорость зависит от оборотов (визуально замедлена во избежание «стробоскопа») */
  update(dt: number, motors: Float32Array) {
    for (let i = 0; i < 4; i++) {
      const m = motors[i];
      const dir = i === 0 || i === 3 ? 1 : -1;
      this.angle[i] += dir * (m * 60 + 4) * dt * (m > 0.02 ? 1 : 0.3);
      this.blades[i].rotation.y = this.angle[i];
      const o = Math.min(1, m * 3);
      this.discs[i].opacity = o * 0.28;
      this.blades[i].visible = m < 0.45;
    }
  }

  setPayload(on: boolean) {
    this.payload.visible = on;
  }
}
