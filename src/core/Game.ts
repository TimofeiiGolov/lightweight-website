import * as THREE from 'three';
import { CRASH, PAYLOAD, PHYS, SIGNAL, WORLD } from '../config';
import { EventBus } from './EventBus';
import { InputManager } from './InputManager';
import { SceneManager } from './SceneManager';
import { loadSettings, saveSettings } from '../utils/Storage';
import { DroneBody } from '../physics/DroneBody';
import { FlightModel } from '../physics/FlightModel';
import { WorldPhysics } from '../physics/WorldPhysics';
import { CameraFPV } from '../drone/CameraFPV';
import { DroneVisual } from '../drone/Drone';
import { Payload } from '../drone/Payload';
import { buildLevel, type LevelData } from '../world/Level';
import { defaultTargets, Targets } from '../world/Targets';
import { Obstacles } from '../world/Obstacles';
import { AudioManager } from '../effects/AudioManager';
import { Particles } from '../effects/Particles';
import { PostProcessing } from '../effects/PostProcessing';
import { MissionManager, type MissionEndResult } from '../missions/MissionManager';
import { HUD } from '../ui/HUD';
import { Menu } from '../ui/Menu';
import { OSD, type OSDState } from '../ui/OSD';
import { autoQuality, toast } from '../ui/Common';
import type { FlightInput, GameState, MissionDef, Settings, Telemetry } from '../types';
import { clamp, damp, isMobileDevice } from '../utils/MathUtils';

/**
 * Главный класс: игровой цикл, состояния, связывание всех подсистем.
 * Физика — фиксированный шаг 120 Гц (аккумулятор), рендер — по rAF.
 */
export class Game {
  private bus = new EventBus();
  private scenes: SceneManager;
  private physics = new WorldPhysics();
  private flight = new FlightModel();
  private body = new DroneBody();
  private visual: DroneVisual;
  private fpv: CameraFPV;
  private payload = new Payload();
  private level: LevelData | null = null;
  private targets = new Targets();
  private obstacles = new Obstacles();
  private audio = new AudioManager();
  private particles: Particles;
  private post: PostProcessing;
  private osd = new OSD();
  private hud: HUD;
  private menu: Menu;
  private input: InputManager;
  private missions: MissionManager;

  private settings: Settings;
  private state: GameState = 'loading';
  private flightMode: 'ACRO' | 'ANGLE' = 'ACRO';

  private clock = new THREE.Clock();
  private acc = 0;
  private time = 0;
  private flightClock = 0;

  private prevVel = new THREE.Vector3();
  private pos = new THREE.Vector3();
  private quat = new THREE.Quaternion();
  private vel = new THREE.Vector3();
  private prevPos = new THREE.Vector3();
  private upVec = new THREE.Vector3();

  private crashTimer = 0;
  private lastLandedEmit = 0;
  private rssi = 100;
  private rssiTimer = 0;
  private hitMarkerT = 0;
  private osdMessage = '';
  private osdMessageT = 0;
  private popups: Array<{ text: string; t: number }> = [];
  private fpsEMA = 60;
  private qualityDownTimer = 0;
  private lowBatBeepT = 0;

  private spawnPoint = new THREE.Vector3(0, 1.6, 6);
  private spawnYaw = 0;
  private hoverRing: THREE.Mesh | null = null;

  constructor(container: HTMLElement) {
    this.settings = loadSettings();
    this.scenes = new SceneManager(container);
    this.visual = new DroneVisual();
    this.fpv = new CameraFPV(this.scenes.width / this.scenes.height);
    this.particles = new Particles();
    this.post = new PostProcessing(this.scenes.renderer, this.scenes.scene, this.fpv.camera);
    this.input = new InputManager({
      onArmToggle: () => this.toggleArm(),
      onReset: () => this.resetDrone(true),
      onDrop: () => this.dropPayload(),
      onTilt: (d) => this.changeTilt(d),
      onPause: () => this.togglePause(),
    });

    this.menu = new Menu(this.settings, {
      startMode: (def) => this.startMode(def),
      resume: () => this.resume(),
      restart: () => this.restart(),
      exitToMenu: () => this.exitToMenu(),
      settingsChanged: (s) => this.applySettings(s),
      restoreTargets: () => {
        this.targets.restoreAll();
        toast('Мишени восстановлены');
      },
    });

    this.hud = new HUD(this.input, {
      onPause: () => this.togglePause(),
      onArmToggle: () => this.toggleArm(),
      onReset: () => this.resetDrone(true),
      onDrop: () => this.dropPayload(),
      onTilt: (d) => this.changeTilt(d),
    });

    this.missions = new MissionManager(this.bus, (r) => this.onMissionEnd(r));

    // события игры
    this.bus.on('score', (...a) => {
      const pts = a[0] as number;
      this.missions.score += pts;
      this.popups.push({ text: `+${pts}`, t: 1.6 });
    });
    this.bus.on('objectiveProgress', () => {
      this.hud.setObjective(this.missions.objectiveText());
    });
    this.bus.on('objectiveDone', () => {
      this.hud.setObjective(this.missions.objectiveText());
      this.osdMessage = 'ЭТАП ВЫПОЛНЕН';
      this.osdMessageT = 1.6;
      this.audio.gate();
    });
    this.bus.on('highlightTargets', (...a) => {
      this.targets.setHighlight(a[0] as Iterable<number>);
    });

    // аудио: первый жест пользователя
    const unlock = () => {
      this.audio.ensureStarted();
      this.audio.resume();
      window.removeEventListener('pointerdown', unlock);
      window.removeEventListener('keydown', unlock);
    };
    window.addEventListener('pointerdown', unlock);
    window.addEventListener('keydown', unlock);

    // авто-пауза при сворачивании
    document.addEventListener('visibilitychange', () => {
      if (document.hidden && this.state === 'flying') this.pause();
    });

    window.addEventListener('keydown', (e) => {
      if (e.code === 'KeyM' && this.state === 'flying') {
        this.flightMode = this.flightMode === 'ACRO' ? 'ANGLE' : 'ACRO';
        toast(`Режим: ${this.flightMode}`);
        this.audio.click();
      }
    });

    this.applySettings(this.settings, true);
    this.menu.showMain();
    this.state = 'menu';
  }

  /** Инициализация физики (вызывается из main после загрузки WASM) */
  async initWorld(onProgress?: (p: number, text: string) => void): Promise<void> {
    onProgress?.(0.2, 'Загрузка физического движка…');
    await this.physics.init();
    onProgress?.(0.55, 'Построение полигона…');
    this.level = buildLevel(this.scenes.scene, this.physics, this.settings.lighting);
    onProgress?.(0.8, 'Расстановка мишеней…');
    this.targets.spawn(defaultTargets());
    this.scenes.scene.add(this.targets.group);
    this.obstacles.buildGates();
    this.obstacles.buildZones();
    this.scenes.scene.add(this.obstacles.group);
    this.scenes.scene.add(this.visual.group);
    this.scenes.scene.add(this.payload.mesh);
    this.scenes.scene.add(this.particles.group);
    this.body.create(this.physics.world, this.spawnPoint, 0, this.settings);
    this.visual.sync(this.spawnPoint, new THREE.Quaternion());
    onProgress?.(1, 'Готово');
  }

  // ================= Режимы =================

  private startMode(def: MissionDef): void {
    this.audio.ensureStarted();
    this.audio.click();
    this.menu.hide();
    this.missions.load(def, () => this.targets.restoreAll());
    this.obstacles.resetGates();
    this.spawnPoint.set(def.spawn.pos[0], def.spawn.pos[1], def.spawn.pos[2]);
    this.spawnYaw = def.spawn.yaw;
    this.resetDrone(false);
    this.state = 'flying';
    this.flightClock = 0;
    this.hud.show();
    this.hud.setObjective(this.missions.objectiveText());
    this.hud.setArmed(false);
    // кольцо для тренировки висения
    this.updateHoverRing();
    if (def.mode === 'free') {
      toast('Свободный полёт — ARM и вперёд');
    } else if (def.timeLimit > 0) {
      this.osdMessage = def.title.toUpperCase();
      this.osdMessageT = 2.2;
    }
  }

  private updateHoverRing(): void {
    const o = this.missions.currentObjective();
    if (o?.type === 'hover' && o.anchor) {
      if (!this.hoverRing) {
        const geo = new THREE.TorusGeometry(2.5, 0.08, 8, 40);
        const mat = new THREE.MeshBasicMaterial({ color: 0xffc94d, transparent: true, opacity: 0.7 });
        this.hoverRing = new THREE.Mesh(geo, mat);
        this.scenes.scene.add(this.hoverRing);
      }
      this.hoverRing.position.set(o.anchor[0], o.anchor[1], o.anchor[2]);
      this.hoverRing.visible = true;
    } else if (this.hoverRing) {
      this.hoverRing.visible = false;
    }
  }

  private onMissionEnd(r: MissionEndResult): void {
    this.state = 'results';
    this.hud.hide();
    if (r.win) {
      this.audio.win();
    } else {
      this.audio.fail();
    }
    const hasNext = r.def.id !== 'free';
    this.menu.showResults(r, hasNext);
  }

  private restart(): void {
    if (this.missions.current) {
      this.startMode(this.missions.current);
    }
  }

  private resume(): void {
    this.menu.hide();
    this.state = 'flying';
    this.hud.show();
    this.audio.resume();
  }

  private pause(): void {
    if (this.state !== 'flying') return;
    this.state = 'paused';
    this.hud.hide();
    this.menu.showPause();
  }

  private togglePause(): void {
    if (this.state === 'flying') this.pause();
    else if (this.state === 'paused') this.resume();
  }

  private exitToMenu(): void {
    this.state = 'menu';
    this.hud.hide();
    this.missions.clear();
    this.targets.restoreAll();
    this.obstacles.resetGates();
    this.resetDrone(false);
    this.menu.showMain();
  }

  // ================= Управление дроном =================

  private toggleArm(): void {
    if (this.state !== 'flying') return;
    if (this.crashTimer > 0) return;
    this.audio.ensureStarted();
    if (!this.body.body) return;
    if (this.flightMode === 'ACRO' && this.input.sticks.left.values.y > 0.05 && !this.armed) {
      // защита: при газе > 5% не армим
      toast('Убери газ перед ARM');
      return;
    }
    this.armed = !this.armed;
    if (this.armed) {
      this.audio.arm();
      this.popups.push({ text: 'ARMED', t: 1.2 });
    } else {
      this.audio.disarm();
    }
    this.hud.setArmed(this.armed);
  }

  private armed = false;

  private resetDrone(manual: boolean): void {
    if (!this.body.body) return;
    this.body.reset(this.spawnPoint, this.spawnYaw);
    this.flight.reset();
    this.armed = false;
    this.crashTimer = 0;
    this.input.resetThrottle();
    this.input.resetSticks();
    this.hud.setArmed(false);
    if (manual) {
      this.audio.click();
      toast('Дрон на старте');
    }
  }

  private changeTilt(delta: number): void {
    this.settings.camTilt = clamp(this.settings.camTilt + delta, 0, 45);
    this.fpv.setTilt(this.settings.camTilt);
    saveSettings(this.settings);
  }

  private dropPayload(): void {
    if (this.state !== 'flying' || !this.armed) {
      if (this.state === 'flying') toast('Сначала ARM');
      return;
    }
    if (!this.payload.ready) return;
    const ok = this.payload.drop(this.pos, this.vel, this.quat);
    if (ok) {
      this.audio.drop();
      this.visual.showPayload(false);
    }
  }

  // ================= Настройки =================

  private applySettings(s: Settings, first = false): void {
    this.settings = s;
    saveSettings(s);
    const q = s.quality === 'auto' ? autoQuality() : s.quality;
    this.scenes.setQuality(q);
    this.scenes.applyLighting(s.lighting);
    this.fpv.setFov(s.fov);
    this.fpv.setTilt(s.camTilt);
    this.fpv.shakeAmount = s.shake;
    this.input.sticks.sens = s.stickSens;
    this.input.sticks.scale = s.stickScale;
    this.input.sticks.applyScale();
    this.post.setQuality(q, isMobileDevice());
    this.audio.setVolume(s.volume);
    if (!first && this.state === 'flying') {
      // применяем массу на лету — пересоздаём тело
      // (простой вариант: только при первом входе в режим)
    }
    if (this.level) {
      for (const fl of this.level.floodlights) fl.visible = s.lighting === 'dusk';
    }
  }

  // ================= Игровой цикл =================

  start(): void {
    this.clock.start();
    const loop = () => {
      requestAnimationFrame(loop);
      const dt = Math.min(0.05, this.clock.getDelta());
      this.tick(dt);
    };
    requestAnimationFrame(loop);
  }

  private tick(dt: number): void {
    this.time += dt;
    this.fpsEMA = damp(this.fpsEMA, 1 / Math.max(dt, 1e-4), 2, dt);

    if (this.state === 'flying') {
      this.tickFlying(dt);
    } else {
      // меню/пауза: слегка вращаем камеру вокруг дрона? Нет — статичный кадр FPV
      this.fpv.update(dt, this.pos, this.quat, 0, 0);
      this.targets.update(0);
      this.obstacles.update(this.time);
      this.particles.update(dt);
    }

    // OSD
    const st = this.buildOSDState(dt);
    this.osd.update(dt, st);
    this.post.update(this.time, st.signalLost ? 1 : this.osd.noiseLevel, this.settings.osdStyle === 'analog');

    // рендер
    this.post.render(this.scenes.renderer, this.scenes.scene, this.fpv.camera);

    // авто-снижение качества
    if (this.settings.quality === 'auto' && this.fpsEMA < 38 && this.state === 'flying') {
      this.qualityDownTimer += dt;
      if (this.qualityDownTimer > 5) {
        const q = this.scenes.quality;
        if (q === 'high') {
          this.scenes.setQuality('medium');
          toast('Качество снижено (FPS)');
          this.qualityDownTimer = 0;
        } else if (q === 'medium') {
          this.scenes.setQuality('low');
          toast('Качество снижено (FPS)');
          this.qualityDownTimer = 0;
        }
      }
    } else {
      this.qualityDownTimer = 0;
    }
  }

  private tickFlying(dt: number): void {
    this.input.update(dt);
    this.input.pollGamepad();
    const cmd = this.input.getCommand(this.settings.stickSens);

    // позиция предыдущего кадра — для проверки пролёта ворот
    this.prevPos.copy(this.pos);

    // --- фиксированный шаг физики ---
    this.acc += dt;
    let steps = 0;
    const h = 1 / PHYS.stepHz;
    while (this.acc >= h && steps < PHYS.maxStepsPerFrame) {
      this.physicsStep(h, cmd);
      this.acc -= h;
      steps++;
    }
    if (steps === PHYS.maxStepsPerFrame) this.acc = 0; // защита от спирали

    // --- синхронизация ---
    this.body.position(this.pos);
    this.body.quaternion(this.quat);
    this.body.velocity(this.vel);
    this.prevPos.copy(this.pos);
    this.visual.sync(this.pos, this.quat);
    this.visual.updateProps(dt, this.flight.spool, this.armed);
    this.fpv.update(dt, this.pos, this.quat, this.flight.spool, cmd.throttle);

    // --- груз ---
    this.payload.tick(dt);
    if (this.payload.active) {
      const res = this.payload.update(dt, this.level?.boxes ?? []);
      if (res) {
        this.explosion(res.point);
      }
      if (!this.payload.active && this.payload.ready) {
        this.visual.showPayload(true);
      }
    } else if (this.payload.ready) {
      this.visual.showPayload(true);
    }

    // --- мир ---
    this.targets.update(dt);
    this.obstacles.update(this.time);
    const gateIdx = this.obstacles.checkGatePass(this.prevPos, this.pos);
    if (gateIdx >= 0) {
      const g = this.obstacles.gates[gateIdx];
      const expected = this.missions.currentObjective()?.type === 'gates';
      if (!g.passed) {
        g.passed = true;
        this.audio.gate();
        this.bus.emit('gatePassed', gateIdx);
        this.missions.onGatePassed(gateIdx, expected);
      }
    }
    this.updateHoverRing();
    if (this.hoverRing && this.hoverRing.visible) {
      this.hoverRing.rotation.y += dt * 0.8;
    }
    this.missions.update(dt, this.pos, this.vel.length(), this.pos.y);

    // --- эффекты/аудио ---
    this.particles.update(dt);
    this.audio.update(this.armed && this.crashTimer <= 0, this.flight.spool, this.vel.length(), cmd.yaw);

    // --- таймеры ---
    this.flightClock += dt;
    if (this.hitMarkerT > 0) this.hitMarkerT -= dt;
    if (this.osdMessageT > 0) this.osdMessageT -= dt;
    for (const p of this.popups) p.t -= dt;
    this.popups = this.popups.filter((p) => p.t > 0);

    // --- RSSI ---
    this.rssiTimer -= dt;
    if (this.rssiTimer <= 0) {
      this.rssiTimer = 0.4;
      this.updateRSSI();
    }
    this.input.jitter = this.rssi < SIGNAL.lostBelow ? 0.22 : this.rssi < 20 ? 0.08 : 0;

    // --- крэш-таймер ---
    if (this.crashTimer > 0) {
      this.crashTimer -= dt;
      if (this.crashTimer <= 0) {
        this.resetDrone(false);
        this.osdMessage = 'РЕСЕТ';
        this.osdMessageT = 1;
      }
    }
  }

  private physicsStep(h: number, cmd: FlightInput): void {
    if (!this.body.body) return;
    this.body.velocity(this.prevVel);
    if (this.armed && this.crashTimer <= 0) {
      this.flight.step(cmd, this.body.body, h, this.settings, this.flightMode);
    }
    this.physics.step();

    // --- детекция удара ---
    this.body.velocity(this.vel);
    const dv = this.vel.distanceTo(this.prevVel);
    if (dv > CRASH.dvThreshold && this.crashTimer <= 0) {
      this.onCrash();
    }
    // --- переворот у земли ---
    this.body.position(this.pos);
    this.upVec.set(0, 1, 0).applyQuaternion(this.body.quaternion(this.quat));
    if (this.armed && this.crashTimer <= 0 && this.pos.y < 0.6 && this.upVec.y < CRASH.upsideDot) {
      this.onCrash();
    }
    // --- мягкая посадка (для тренировки) ---
    const speed = this.vel.length();
    if (this.pos.y < 0.45 && speed < CRASH.landSpeed && cmd.throttle < 0.12) {
      if (this.time - this.lastLandedEmit > 2) {
        this.lastLandedEmit = this.time;
        this.checkLanding();
      }
    }
  }

  private onCrash(): void {
    if (!this.armed) return;
    this.armed = false;
    this.crashTimer = CRASH.resetDelay;
    this.hud.setArmed(false);
    this.audio.crash();
    this.particles.sparks(this.pos.x, this.pos.y, this.pos.z);
    this.fpv.addImpact(1.2);
    if (navigator.vibrate) navigator.vibrate([60, 40, 60]);
  }

  private checkLanding(): void {
    // пад в (0, 6), радиус 3.2
    const d = Math.hypot(this.pos.x - 0, this.pos.z - 6);
    const inZone = d < 3.4;
    if (inZone) {
      this.particles.dust(this.pos.x, this.pos.y, this.pos.z);
      this.audio.gate();
    }
    this.missions.onLanded(inZone);
  }

  private explosion(point: THREE.Vector3): void {
    this.particles.explosion(point.x, point.y, point.z, 1);
    this.audio.explosion();
    if (navigator.vibrate) navigator.vibrate(80);
    // урон по целям
    const destroyed = this.targets.damageRadius(point, PAYLOAD.blastRadius);
    for (const t of destroyed) {
      this.hitMarkerT = 0.45;
      this.popups.push({ text: `${t.kind === 'car' || t.kind === 'walker' ? 'Мишень' : 'Цель'} +${t.points}`, t: 1.6 });
      this.bus.emit('targetDestroyed', t.id, t.points);
      this.audio.hit();
    }
    // тряска от близкого взрыва
    const d = this.pos.distanceTo(point);
    if (d < 25) {
      this.fpv.addImpact((25 - d) / 25 * 0.8);
    }
    // зона сброса?
    for (const z of this.obstacles.zones) {
      const dist = Math.hypot(point.x - z.center.x, point.z - z.center.z);
      if (dist < z.radius) {
        this.bus.emit('payloadLanded', z.index, dist, true);
        this.missions.onPayloadLanded(z.index, true);
        this.popups.push({ text: dist < 2 ? 'В ЯБЛОЧКО! +300' : `ЗОНА +${dist < 4.5 ? 150 : 50}`, t: 2 });
        break;
      }
    }
  }

  private updateRSSI(): void {
    const dist = this.pos.length();
    let rssi = 100 - SIGNAL.distPenalty * clamp(dist / WORLD.rssiMaxDist, 0, 1);
    // прямая видимость до старта
    if (this.level) {
      const ox = this.pos.x, oy = this.pos.y, oz = this.pos.z;
      const len = Math.hypot(ox, oy, oz);
      if (len > 1) {
        const dx = -ox / len, dy = -oy / len, dz = -oz / len;
        for (const b of this.level.boxes) {
          // быстрый slab-тест
          let tmin = 0, tmax = len;
          const o = [ox, oy, oz], d = [dx, dy, dz];
          const bmin = [b.min.x, b.min.y, b.min.z], bmax = [b.max.x, b.max.y, b.max.z];
          let hit = true;
          for (let i = 0; i < 3; i++) {
            const inv = 1 / d[i];
            let t1 = (bmin[i] - o[i]) * inv;
            let t2 = (bmax[i] - o[i]) * inv;
            if (t1 > t2) { const tt = t1; t1 = t2; t2 = tt; }
            tmin = Math.max(tmin, t1);
            tmax = Math.min(tmax, t2);
            if (tmin > tmax) { hit = false; break; }
          }
          if (hit) {
            rssi -= SIGNAL.occludedPenalty;
            break;
          }
        }
      }
    }
    this.rssi = clamp(rssi, 0, 100);
  }

  private buildOSDState(dt: number): OSDState {
    const speedKmh = this.vel.length() * 3.6;
    const m = this.missions;
    const lowBattery = this.flight.vbat < 22.0 && this.armed;
    if (lowBattery) {
      this.lowBatBeepT -= dt;
      if (this.lowBatBeepT <= 0) {
        this.lowBatBeepT = 1.2;
        this.audio.lowBattery();
      }
    }
    return {
      armed: this.armed,
      mode: this.flightMode,
      throttle: this.flight.spool,
      vbat: this.flight.vbat,
      speedKmh,
      altM: Math.max(0, this.pos.y - 0.1),
      rssi: this.rssi,
      clock: this.flightClock,
      missionTime: m.running && m.current && m.current.timeLimit > 0 ? m.timeLeft : -1,
      score: m.score,
      targetsLeft: m.current && m.current.mode !== 'free' ? this.targets.aliveCount() : -1,
      objective: this.hudObjectiveText(),
      payloadReady: this.payload.ready,
      payloadSec: Math.max(0, this.payload.rearmT),
      crash: this.crashTimer > 0,
      signalLost: this.rssi < SIGNAL.lostBelow,
      lowBattery,
      hitMarkerT: this.hitMarkerT,
      style: this.settings.osdStyle,
      showFps: this.settings.showFps,
      fps: this.fpsEMA,
      message: this.osdMessage,
      messageT: this.osdMessageT,
      popups: this.popups,
    };
  }

  private hudObjectiveText(): string {
    if (!this.missions.current) return '';
    if (this.missions.current.mode === 'free') return 'Свободный полёт';
    return this.missions.objectiveText();
  }

  /** Телеметрия для внешних целей (не используется в UI, полезно для отладки) */
  telemetry(): Telemetry {
    return {
      speed: this.vel.length(),
      alt: this.pos.y,
      vbat: this.flight.vbat,
      throttle: this.flight.spool,
      rssi: this.rssi,
    };
  }

  dispose(): void {
    this.targets.dispose(this.scenes.scene);
    this.obstacles.dispose(this.scenes.scene);
    this.particles.dispose(this.scenes.scene);
    this.visual.dispose(this.scenes.scene);
    this.level?.dispose();
    this.scenes.renderer.dispose();
  }
}
