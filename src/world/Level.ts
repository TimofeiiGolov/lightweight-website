import * as THREE from 'three';
import { WORLD } from '../config';

export interface LevelData {
  group: THREE.Group;
  /** AABB всех препятствий (здания, техника, бункер) — для LOS, груза, сигнала */
  boxes: THREE.Box3[];
  /** точки для прожекторов (сумерки) */
  floodlights: THREE.SpotLight[];
  dispose(): void;
}

/**
 * Процедурный военный полигон: земля, дороги, здания (целые/разрушенные),
 * окопы с бермами и мешками, бункер, деревья, проволока, техника,
 * прожекторы. Все коллайдеры регистрируются через колбэк addCollider.
 */
export function buildLevel(
  scene: THREE.Scene,
  physics: { addStaticBox(x: number, y: number, z: number, hx: number, hy: number, hz: number, yaw?: number): void; addStaticCylinder(x: number, y: number, z: number, r: number, hh: number): void; addGround(h: number): void },
  lighting: 'day' | 'dusk'
): LevelData {
  const group = new THREE.Group();
  scene.add(group);
  const boxes: THREE.Box3[] = [];
  const disposables: Array<{ dispose(): void }> = [];
  const floodlights: THREE.SpotLight[] = [];

  // ---------- текстуры (canvas) ----------
  const groundTex = makeGroundTexture();
  const brickTex = makeFacadeTexture('#7a4a3a', '#2a1f1a', false);
  const concreteTex = makeFacadeTexture('#9a9a92', '#3a3f45', true);
  const ruinTex = makeFacadeTexture('#6a6a62', '#26221e', true);
  for (const t of [groundTex, brickTex, concreteTex, ruinTex]) disposables.push(t);

  // ---------- материалы ----------
  const matGround = new THREE.MeshStandardMaterial({ map: groundTex, roughness: 1, metalness: 0 });
  const matRoad = new THREE.MeshStandardMaterial({ color: 0x2e2e2c, roughness: 0.95 });
  const matBrick = new THREE.MeshStandardMaterial({ map: brickTex, roughness: 0.9 });
  const matConcrete = new THREE.MeshStandardMaterial({ map: concreteTex, roughness: 0.9 });
  const matRuin = new THREE.MeshStandardMaterial({ map: ruinTex, roughness: 0.95 });
  const matBerm = new THREE.MeshStandardMaterial({ color: 0x7a7350, roughness: 1 });
  const matSand = new THREE.MeshStandardMaterial({ color: 0x8f855e, roughness: 1 });
  const matDark = new THREE.MeshStandardMaterial({ color: 0x1c1e1a, roughness: 0.9 });
  const matMetal = new THREE.MeshStandardMaterial({ color: 0x3c4046, roughness: 0.55, metalness: 0.5 });
  const matTrunk = new THREE.MeshStandardMaterial({ color: 0x4a3826, roughness: 1 });
  const matLeaf = new THREE.MeshStandardMaterial({ color: 0x3a5a2e, roughness: 1 });
  const matMil = new THREE.MeshStandardMaterial({ color: 0x40483a, roughness: 0.8, metalness: 0.2 });
  disposables.push(matGround, matRoad, matBrick, matConcrete, matRuin, matBerm, matSand, matDark, matMetal, matTrunk, matLeaf, matMil);

  // ---------- земля ----------
  groundTex.repeat.set(26, 26);
  groundTex.wrapS = groundTex.wrapT = THREE.RepeatWrapping;
  groundTex.colorSpace = THREE.SRGBColorSpace;
  const ground = new THREE.Mesh(new THREE.PlaneGeometry(WORLD.size, WORLD.size), matGround);
  ground.rotation.x = -Math.PI / 2;
  ground.receiveShadow = true;
  group.add(ground);
  physics.addGround(WORLD.size / 2);

  // ---------- дороги ----------
  const roadGeoX = new THREE.PlaneGeometry(280, 8);
  const roadX = new THREE.Mesh(roadGeoX, matRoad);
  roadX.rotation.x = -Math.PI / 2;
  roadX.position.set(0, 0.02, 0);
  group.add(roadX);
  const roadGeoZ = new THREE.PlaneGeometry(8, 200);
  const roadZ = new THREE.Mesh(roadGeoZ, matRoad);
  roadZ.rotation.x = -Math.PI / 2;
  roadZ.position.set(40, 0.02, 30);
  group.add(roadZ);
  // пунктир
  const dashGeo = new THREE.PlaneGeometry(2.2, 0.25);
  const dashMat = new THREE.MeshBasicMaterial({ color: 0xb8b8a8 });
  const dashCount = 70;
  const dashes = new THREE.InstancedMesh(dashGeo, dashMat, dashCount);
  const m4 = new THREE.Matrix4();
  const q0 = new THREE.Quaternion().setFromEuler(new THREE.Euler(-Math.PI / 2, 0, 0));
  for (let i = 0; i < dashCount; i++) {
    const along = -136 + i * 4;
    m4.compose(new THREE.Vector3(along, 0.03, 0), q0, new THREE.Vector3(1, 1, 1));
    dashes.setMatrixAt(i, m4);
  }
  group.add(dashes);
  disposables.push(dashGeo, dashMat);

  // ---------- здания ----------
  interface BDef { x: number; z: number; w: number; d: number; h: number; yaw: number; mat: THREE.MeshStandardMaterial; ruined?: boolean }
  const buildings: BDef[] = [
    { x: 70, z: -25, w: 14, d: 10, h: 9, yaw: 0, mat: matBrick },
    { x: 95, z: 8, w: 16, d: 12, h: 12, yaw: 0.2, mat: matConcrete },
    { x: 75, z: 38, w: 12, d: 12, h: 7, yaw: 0.4, mat: matBrick },
    { x: 112, z: -32, w: 10, d: 10, h: 6, yaw: -0.3, mat: matConcrete },
    { x: 55, z: 14, w: 8, d: 8, h: 5, yaw: 0, mat: matBrick },
    { x: -90, z: -25, w: 14, d: 10, h: 8, yaw: 0.3, mat: matRuin, ruined: true },
    { x: -75, z: 22, w: 12, d: 12, h: 10, yaw: -0.2, mat: matRuin, ruined: true },
    { x: -110, z: 48, w: 10, d: 8, h: 6, yaw: 0.2, mat: matBrick },
    { x: -95, z: 64, w: 8, d: 8, h: 5, yaw: -0.1, mat: matBrick },
  ];
  const boxGeo = new THREE.BoxGeometry(1, 1, 1);
  disposables.push(boxGeo);
  for (const b of buildings) {
    const mesh = new THREE.Mesh(boxGeo, b.mat);
    mesh.scale.set(b.w, b.h, b.d);
    mesh.position.set(b.x, b.h / 2, b.z);
    mesh.rotation.y = b.yaw;
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    group.add(mesh);
    // AABB (без поворота — консервативно расширим)
    const ex = Math.abs(Math.cos(b.yaw)) * b.w / 2 + Math.abs(Math.sin(b.yaw)) * b.d / 2;
    const ez = Math.abs(Math.sin(b.yaw)) * b.w / 2 + Math.abs(Math.cos(b.yaw)) * b.d / 2;
    boxes.push(new THREE.Box3(
      new THREE.Vector3(b.x - ex, 0, b.z - ez),
      new THREE.Vector3(b.x + ex, b.h, b.z + ez)
    ));
    physics.addStaticBox(b.x, b.h / 2, b.z, ex, b.h / 2, ez, b.yaw);

    if (b.ruined) {
      // обломки по углам
      for (let i = 0; i < 4; i++) {
        const rubble = new THREE.Mesh(boxGeo, matRuin);
        const s = 1 + Math.random() * 2;
        rubble.scale.set(s, s * 0.6, s);
        rubble.position.set(b.x + (Math.random() - 0.5) * (b.w + 6), s * 0.3, b.z + (Math.random() - 0.5) * (b.d + 6));
        rubble.rotation.y = Math.random() * Math.PI;
        group.add(rubble);
      }
    }
  }

  // ---------- бункер ----------
  const bunkerGeo = new THREE.CylinderGeometry(6.5, 7.5, 3.2, 14, 1, false);
  const bunker = new THREE.Mesh(bunkerGeo, matConcrete);
  bunker.position.set(95, 1.2, -75);
  bunker.castShadow = true;
  bunker.receiveShadow = true;
  group.add(bunker);
  boxes.push(new THREE.Box3(new THREE.Vector3(87, 0, -83), new THREE.Vector3(103, 3.4, -67)));
  physics.addStaticBox(95, 1.6, -75, 7.5, 1.7, 7.5, 0);
  const bunkerEntr = new THREE.Mesh(boxGeo, matConcrete);
  bunkerEntr.scale.set(4, 2.4, 3);
  bunkerEntr.position.set(95, 1.2, -66.5);
  group.add(bunkerEntr);
  boxes.push(new THREE.Box3(new THREE.Vector3(93, 0, -68), new THREE.Vector3(97, 2.4, -65)));
  physics.addStaticBox(95, 1.2, -66.5, 2, 1.2, 1.5, 0);

  // ---------- окопы (бермы + тёмные полосы) ----------
  const trenchMat = new THREE.MeshStandardMaterial({ color: 0x4a4436, roughness: 1 });
  disposables.push(trenchMat);
  for (let i = 0; i < 9; i++) {
    const x = -64 + i * 16;
    const yaw = (i % 2 === 0 ? 0.22 : -0.22);
    const berm = new THREE.Mesh(boxGeo, matBerm);
    berm.scale.set(13, 1.1, 1.8);
    berm.position.set(x, 0.55, -88);
    berm.rotation.y = yaw;
    berm.castShadow = true;
    group.add(berm);
    physics.addStaticBox(x, 0.55, -88, 6.5, 0.55, 0.9, yaw);
    const dark = new THREE.Mesh(new THREE.PlaneGeometry(12, 2.6), trenchMat);
    dark.rotation.x = -Math.PI / 2;
    dark.position.set(x, 0.015, -90.6);
    group.add(dark);
  }

  // ---------- мешки с песком (instanced) ----------
  const bagGeo = new THREE.SphereGeometry(0.5, 7, 5);
  bagGeo.scale(1, 0.55, 0.7);
  const bagPositions: THREE.Vector3[] = [];
  // гнёзда у восточного направления
  const nests: Array<[number, number, number]> = [[25, -30, 0.4], [42, -46, 0.9], [15, -56, -0.4]];
  for (const [nx, nz, nyaw] of nests) {
    for (let r = 0; r < 3; r++) {
      for (let i = 0; i < 8 - r; i++) {
        const off = (i - (7 - r) / 2) * 1.05;
        bagPositions.push(new THREE.Vector3(
          nx + Math.cos(nyaw) * off - Math.sin(nyaw) * r * 0.5,
          0.28 + r * 0.5,
          nz - Math.sin(nyaw) * off - Math.cos(nyaw) * r * 0.5
        ));
      }
    }
  }
  // поверх берм
  for (let i = 0; i < 9; i++) {
    for (let k = 0; k < 6; k++) {
      bagPositions.push(new THREE.Vector3(-68 + i * 16 + k * 2 - 5, 1.15, -88 + (k % 2) * 0.4));
    }
  }
  const bags = new THREE.InstancedMesh(bagGeo, matSand, bagPositions.length);
  for (let i = 0; i < bagPositions.length; i++) {
    m4.compose(bagPositions[i], new THREE.Quaternion().setFromAxisAngle(UP, Math.random() * Math.PI), new THREE.Vector3(1, 1, 1));
    bags.setMatrixAt(i, m4);
  }
  bags.castShadow = true;
  group.add(bags);
  disposables.push(bagGeo);
  for (const [nx, nz, nyaw] of nests) {
    physics.addStaticBox(nx, 0.7, nz, Math.abs(Math.cos(nyaw)) * 4 + 0.5, 0.7, Math.abs(Math.sin(nyaw)) * 4 + 0.5, nyaw);
  }

  // ---------- деревья (instanced) ----------
  const trunkGeo = new THREE.CylinderGeometry(0.22, 0.34, 3.2, 6);
  const leafGeo = new THREE.ConeGeometry(2.1, 5.2, 7);
  const treeSpots: Array<[number, number]> = [];
  let seed = 7;
  const rnd = () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647; };
  for (let i = 0; i < 95; i++) {
    let x = 0, z = 0, tries = 0;
    do {
      x = (rnd() - 0.5) * 250;
      z = 50 + rnd() * 90;
      tries++;
    } while (tries < 8 && Math.abs(x) < 26 && z < 135); // не сажаем в коридор ворот
    if (Math.abs(x) < 26 && z < 135) continue;
    treeSpots.push([x, z]);
  }
  for (let i = 0; i < 30; i++) {
    treeSpots.push([-120 + rnd() * 50, -110 + rnd() * 40]);
  }
  const trunks = new THREE.InstancedMesh(trunkGeo, matTrunk, treeSpots.length);
  const leaves = new THREE.InstancedMesh(leafGeo, matLeaf, treeSpots.length);
  for (let i = 0; i < treeSpots.length; i++) {
    const [x, z] = treeSpots[i];
    const s = 0.8 + rnd() * 0.7;
    m4.compose(new THREE.Vector3(x, 1.6 * s, z), IDQ, new THREE.Vector3(s, s, s));
    trunks.setMatrixAt(i, m4);
    m4.compose(new THREE.Vector3(x, 4.4 * s, z), IDQ, new THREE.Vector3(s, s, s));
    leaves.setMatrixAt(i, m4);
    physics.addStaticCylinder(x, 1.6 * s, z, 0.35 * s, 1.6 * s);
  }
  trunks.castShadow = true;
  leaves.castShadow = true;
  group.add(trunks);
  group.add(leaves);
  disposables.push(trunkGeo, leafGeo);

  // ---------- техника ----------
  makeTruck(group, matMil, matDark, -25, 8, 0.3, boxes, physics);
  makeTank(group, matMil, matDark, 42, 56, 2.2, boxes, physics);
  makeTruck(group, matMil, matDark, -58, -70, -0.5, boxes, physics);

  // ---------- проволока по периметру ----------
  const postGeo = new THREE.CylinderGeometry(0.05, 0.06, 1.7, 5);
  const postCount = 48;
  const posts = new THREE.InstancedMesh(postGeo, matMetal, postCount);
  const wirePts: number[] = [];
  const half = WORLD.fenceHalf;
  let pi = 0;
  for (let side = 0; side < 4; side++) {
    const perSide = postCount / 4;
    const sidePts: number[] = [];
    for (let i = 0; i < perSide; i++) {
      const t = -half + (i / (perSide - 1)) * half * 2;
      let x = 0, z = 0;
      if (side === 0) { x = t; z = -half; }
      else if (side === 1) { x = t; z = half; }
      else if (side === 2) { x = -half; z = t; }
      else { x = half; z = t; }
      m4.compose(new THREE.Vector3(x, 0.85, z), IDQ, new THREE.Vector3(1, 1, 1));
      posts.setMatrixAt(pi, m4);
      sidePts.push(x, 1.55, z);
      pi++;
    }
    // сегменты между соседними столбами
    for (let i = 0; i < perSide - 1; i++) {
      wirePts.push(
        sidePts[i * 3], sidePts[i * 3 + 1], sidePts[i * 3 + 2],
        sidePts[(i + 1) * 3], sidePts[(i + 1) * 3 + 1], sidePts[(i + 1) * 3 + 2]
      );
    }
  }
  group.add(posts);
  const wireGeo = new THREE.BufferGeometry();
  wireGeo.setAttribute('position', new THREE.Float32BufferAttribute(wirePts, 3));
  const wire = new THREE.LineSegments(wireGeo, new THREE.LineBasicMaterial({ color: 0x555a58 }));
  group.add(wire);
  disposables.push(postGeo, wireGeo);

  // ---------- прожекторы ----------
  const lightSpots: Array<[number, number]> = [[-60, -60], [60, 60], [-60, 60], [60, -60], [0, -120], [95, -66]];
  const poleGeo = new THREE.CylinderGeometry(0.12, 0.16, 9, 6);
  const headGeo = new THREE.ConeGeometry(0.7, 1.2, 8);
  const headMat = new THREE.MeshStandardMaterial({ color: 0x555a50, roughness: 0.6, emissive: 0x000000 });
  disposables.push(poleGeo, headGeo, headMat);
  for (const [x, z] of lightSpots) {
    const pole = new THREE.Mesh(poleGeo, matMetal);
    pole.position.set(x, 4.5, z);
    group.add(pole);
    physics.addStaticCylinder(x, 4.5, z, 0.18, 4.5);
    const head = new THREE.Mesh(headGeo, headMat);
    head.position.set(x, 9.3, z);
    head.rotation.x = Math.PI;
    group.add(head);
    if (lighting === 'dusk') {
      const spot = new THREE.SpotLight(0xffe9b0, 260, 90, 0.55, 0.5, 1.6);
      spot.position.set(x, 9.4, z);
      spot.target.position.set(x + (x === 0 ? 0 : x > 0 ? -25 : 25), 0, z + (z === 0 ? 0 : z > 0 ? -25 : 25));
      group.add(spot);
      group.add(spot.target);
      floodlights.push(spot);
    }
  }

  // ---------- стартовый пад ----------
  const padTex = makePadTexture();
  padTex.colorSpace = THREE.SRGBColorSpace;
  const pad = new THREE.Mesh(new THREE.CircleGeometry(3.2, 28), new THREE.MeshBasicMaterial({ map: padTex, transparent: true }));
  pad.rotation.x = -Math.PI / 2;
  pad.position.set(0, 0.025, 6);
  group.add(pad);
  disposables.push(padTex);

  return {
    group,
    boxes,
    floodlights,
    dispose() {
      scene.remove(group);
      for (const d of disposables) d.dispose();
    },
  };
}

const UP = new THREE.Vector3(0, 1, 0);
const IDQ = new THREE.Quaternion();

// ---------- фабрики техники ----------
function makeTruck(group: THREE.Group, matMil: THREE.Material, matDark: THREE.Material, x: number, z: number, yaw: number, boxes: THREE.Box3[], physics: { addStaticBox(x: number, y: number, z: number, hx: number, hy: number, hz: number, yaw?: number): void }): void {
  const g = new THREE.Group();
  const bed = new THREE.Mesh(new THREE.BoxGeometry(5.4, 1.6, 2.3), matMil);
  bed.position.set(-0.8, 1.6, 0);
  const cab = new THREE.Mesh(new THREE.BoxGeometry(1.9, 1.7, 2.3), matMil);
  cab.position.set(2.6, 1.7, 0);
  const wheelGeo = new THREE.CylinderGeometry(0.62, 0.62, 0.4, 10);
  wheelGeo.rotateX(Math.PI / 2);
  for (const [wx, wz] of [[2.6, 1.1], [2.6, -1.1], [-0.4, 1.1], [-0.4, -1.1], [-2.2, 1.1], [-2.2, -1.1]]) {
    const w = new THREE.Mesh(wheelGeo, matDark);
    w.position.set(wx, 0.62, wz);
    g.add(w);
  }
  g.add(bed);
  g.add(cab);
  g.position.set(x, 0, z);
  g.rotation.y = yaw;
  group.add(g);
  const ex = Math.abs(Math.cos(yaw)) * 3 + Math.abs(Math.sin(yaw)) * 1.3;
  const ez = Math.abs(Math.sin(yaw)) * 3 + Math.abs(Math.cos(yaw)) * 1.3;
  boxes.push(new THREE.Box3(new THREE.Vector3(x - ex, 0, z - ez), new THREE.Vector3(x + ex, 2.7, z + ez)));
  physics.addStaticBox(x, 1.35, z, ex, 1.35, ez, yaw);
}

function makeTank(group: THREE.Group, matMil: THREE.Material, matDark: THREE.Material, x: number, z: number, yaw: number, boxes: THREE.Box3[], physics: { addStaticBox(x: number, y: number, z: number, hx: number, hy: number, hz: number, yaw?: number): void }): void {
  const g = new THREE.Group();
  const hull = new THREE.Mesh(new THREE.BoxGeometry(6.8, 1.3, 3.3), matMil);
  hull.position.y = 1.0;
  const turret = new THREE.Mesh(new THREE.BoxGeometry(3.1, 0.95, 2.2), matMil);
  turret.position.set(-0.3, 2.0, 0);
  const barrelGeo = new THREE.CylinderGeometry(0.13, 0.15, 4.4, 8);
  barrelGeo.rotateZ(Math.PI / 2);
  const barrel = new THREE.Mesh(barrelGeo, matDark);
  barrel.position.set(-3.2, 2.1, 0);
  const trackGeo = new THREE.BoxGeometry(7, 0.85, 0.75);
  for (const tz of [-1.45, 1.45]) {
    const tr = new THREE.Mesh(trackGeo, matDark);
    tr.position.set(0, 0.45, tz);
    g.add(tr);
  }
  g.add(hull);
  g.add(turret);
  g.add(barrel);
  g.position.set(x, 0, z);
  g.rotation.y = yaw;
  group.add(g);
  const ex = Math.abs(Math.cos(yaw)) * 3.5 + Math.abs(Math.sin(yaw)) * 1.8;
  const ez = Math.abs(Math.sin(yaw)) * 3.5 + Math.abs(Math.cos(yaw)) * 1.8;
  boxes.push(new THREE.Box3(new THREE.Vector3(x - ex, 0, z - ez), new THREE.Vector3(x + ex, 2.6, z + ez)));
  physics.addStaticBox(x, 1.2, z, ex, 1.2, ez, yaw);
}

// ---------- canvas-текстуры ----------
function makeGroundTexture(): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = c.height = 256;
  const ctx = c.getContext('2d') as CanvasRenderingContext2D;
  ctx.fillStyle = '#77794c';
  ctx.fillRect(0, 0, 256, 256);
  for (let i = 0; i < 900; i++) {
    const g = 95 + Math.floor(Math.random() * 55);
    const yb = 95 + Math.floor(Math.random() * 40);
    ctx.fillStyle = `rgb(${g * 0.85 | 0},${g | 0},${yb * 0.62 | 0})`;
    const s = 2 + Math.random() * 7;
    ctx.globalAlpha = 0.25;
    ctx.fillRect(Math.random() * 256, Math.random() * 256, s, s);
  }
  ctx.globalAlpha = 0.14;
  for (let i = 0; i < 40; i++) {
    ctx.fillStyle = '#3c4030';
    ctx.beginPath();
    ctx.arc(Math.random() * 256, Math.random() * 256, 4 + Math.random() * 12, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.globalAlpha = 1;
  const tex = new THREE.CanvasTexture(c);
  return tex;
}

function makeFacadeTexture(base: string, win: string, grid: boolean): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = c.height = 128;
  const ctx = c.getContext('2d') as CanvasRenderingContext2D;
  ctx.fillStyle = base;
  ctx.fillRect(0, 0, 128, 128);
  // шум
  ctx.globalAlpha = 0.12;
  for (let i = 0; i < 250; i++) {
    ctx.fillStyle = Math.random() > 0.5 ? '#000' : '#fff';
    ctx.fillRect(Math.random() * 128, Math.random() * 128, 2, 2);
  }
  ctx.globalAlpha = 1;
  // окна
  for (let row = 0; row < 4; row++) {
    for (let col = 0; col < 4; col++) {
      ctx.fillStyle = win;
      ctx.fillRect(12 + col * 28, 10 + row * 30, 14, 18);
      if (Math.random() > 0.75) {
        ctx.fillStyle = '#e8d48a';
        ctx.fillRect(13 + col * 28, 11 + row * 30, 12, 16);
      }
    }
  }
  if (grid) {
    ctx.strokeStyle = 'rgba(0,0,0,0.25)';
    ctx.lineWidth = 2;
    for (let i = 0; i <= 4; i++) {
      ctx.beginPath();
      ctx.moveTo(i * 32, 0); ctx.lineTo(i * 32, 128);
      ctx.moveTo(0, i * 32); ctx.lineTo(128, i * 32);
      ctx.stroke();
    }
  }
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  return tex;
}

function makePadTexture(): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = c.height = 128;
  const ctx = c.getContext('2d') as CanvasRenderingContext2D;
  ctx.clearRect(0, 0, 128, 128);
  ctx.fillStyle = 'rgba(22,26,18,0.85)';
  ctx.beginPath();
  ctx.arc(64, 64, 62, 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = '#ffc94d';
  ctx.lineWidth = 5;
  ctx.beginPath();
  ctx.arc(64, 64, 58, 0, Math.PI * 2);
  ctx.stroke();
  ctx.fillStyle = '#ffc94d';
  ctx.fillRect(44, 34, 12, 60);
  ctx.fillRect(72, 34, 12, 60);
  ctx.fillRect(44, 58, 40, 12);
  return new THREE.CanvasTexture(c);
}
