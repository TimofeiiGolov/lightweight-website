import { Quaternion, Vector3, type PerspectiveCamera } from 'three';
import { PHYS, QUALITY, type QualityLevel, type Settings } from '../config';
import { AudioManager } from '../effects/AudioManager';
import { Particles } from '../effects/Particles';
import { PostProcessing, type FxParams } from '../effects/PostProcessing';
import { CameraFPV } from '../drone/CameraFPV';
import { Drone } from '../drone/Drone';
import { PayloadSystem, type PayloadImpact } from '../drone/Payload';
import { FREE, type MissionDef } from '../missions/MissionData';
import { MissionManager, type MissionResult } from '../missions/MissionManager';
import { FlightModel, type FlightInput } from '../physics/FlightModel';
import { WorldPhysics } from '../physics/WorldPhysics';
import { HUD } from '../ui/HUD';
import { Menu } from '../ui/Menu';
import { OSD, type OsdData } from '../ui/OSD';
import { VirtualJoysticks } from '../ui/VirtualJoysticks';
import { clamp, damp, terrainHeight } from '../utils/MathUtils';
import { loadSettings, saveSettings, submitRecord } from '../utils/Storage';
import { Gates, HoverMarker, ZoneMarkers } from '../world/Obstacles';
import { Level } from '../world/Level';
import { Targets } from '../world/Targets';
import { InputManager, type Controls } from './InputManager';
import { SceneManager, TOD } from './SceneManager';

type State = 'loading' | 'menu' | 'playing' | 'paused';

const PILOT = new Vector3(0, 1.7, 8);

/** Главный класс: цикл, состояние дрона, связка всех подсистем */
export class Game {
  settings: Settings = loadSettings();
  private canvas = document.createElement('canvas');
  private ui = document.createElement('div');
  private sm!: SceneManager;
  private post!: PostProcessing;
  private phys!: WorldPhysics;
  private level!: Level;
  private targets!: Targets;
  private gates!: Gates;
  private zones!: ZoneMarkers;
  private padMarks!: ZoneMarkers;
  private hover!: HoverMarker;
  private drone = new Drone();
  private fpv!: CameraFPV;
  private flight!: FlightModel;
  private payload!: PayloadSystem;
  private particles = new Particles();
  private audio = new AudioManager();
  private input: InputManager;
  private sticks!: VirtualJoysticks;
  private osd!: OSD;
  private hud!: HUD;
  private menu!: Menu;
  private missions!: MissionManager;

  private state: State = 'loading';
  private raf = 0;
  private last = 0;
  private clock = 0;
  private acc = 0;
  private controls: Controls = { roll: 0, pitch: 0, yaw: 0, throttleStick: -1 };

  // состояние дрона
  private curPos = new Vector3(0, 0.2, 0);
  private prevPos = new Vector3(0, 0.2, 0);
  private curQuat = new Quaternion();
  private prevQuat = new Quaternion();
  private vel = new Vector3();
  private ang = new Vector3();
  private vPre = new Vector3();
  private rPos = new Vector3();
  private rQuat = new Quaternion();
  private armed = false;
  private crashed = false;
  private failsafe = false;
  private crashTimer = 0;
  private flightTime = 0;
  private payloadsLeft = 0;
  private reload = 0;
  private passive = true;
  private def: MissionDef = FREE;
  private resultTimer = -1;
  private freeRespawnT = 0;

  // сигнал и эффекты
  private rssi = 100;
  private occ = 0;
  private sigT = 0;
  private lostT = 0;
  private flash = 0;
  private glitchBoost = 0;
  private shake = 0;
  private fx: FxParams = { noise: 0, glitch: 0, vignette: 0.6, chroma: 1, grain: 0.05, scan: 1, gain: 1, sat: 1, analog: 1, flash: 0 };
  private osdT = 0;
  private quality: QualityLevel = 'high';
  private fpsAcc = 0;
  private fpsN = 0;
  private fpsT = 0;
  private tmpV = new Vector3();
  private tmpV2 = new Vector3();
  private tmpQ = new Quaternion();
  private pipperPt = new Vector3();

  constructor(private root: HTMLElement) {
    this.input = new InputManager(() => this.settings);
    this.canvas.className = 'view';
    this.ui.className = 'ui';
    root.appendChild(this.canvas);
    root.appendChild(this.ui);
    this.sm = new SceneManager(this.canvas);
    this.post = new PostProcessing(this.sm.renderer);
    this.fpv = new CameraFPV(this.sm.camera);
    this.sticks = new VirtualJoysticks(this.ui, this.input, () => this.settings);
    this.hud = new HUD(this.ui, this.input);
    this.osd = new OSD(this.ui);
    this.hud.setVisible(false);
    this.osd.setVisible(false);
    this.menu = new Menu(
      this.ui,
      () => this.settings,
      {
        start: (d) => this.startMission(d),
        resume: () => this.resume(),
        restart: () => this.startMission(this.def),
        toMenu: () => this.toMenu(),
        changed: (p) => this.settingsChanged(p),
        preset: (n) => this.applyPreset(n),
      },
      () => this.input.padName,
    );
    this.sm.scene.add(this.drone.group, this.particles.group);
    this.drone.group.visible = false;

    this.initQuality();
    window.addEventListener('resize', this.resize);
    window.addEventListener('orientationchange', () => setTimeout(this.resize, 200));
    document.addEventListener('visibilitychange', () => {
      if (document.hidden && this.state === 'playing') this.pause();
    });
    this.bindInput();
    this.resize();
    this.last = performance.now();
    this.raf = requestAnimationFrame(this.loop);
    void this.init();
  }

  dispose() {
    cancelAnimationFrame(this.raf);
    window.removeEventListener('resize', this.resize);
    this.root.innerHTML = '';
  }

  // ------------------------------------------------------------------ инициализация
  private async init() {
    await new Promise((r) => setTimeout(r, 40));
    this.phys = await WorldPhysics.create();
    this.phys.setHz(QUALITY[this.quality].physicsHz);
    this.menu.showLoading('Строим полигон…');
    await new Promise((r) => setTimeout(r, 40));
    this.level = new Level(this.phys);
    this.sm.scene.add(this.level.group);
    this.targets = new Targets(this.level.targetDefs, this.phys);
    this.gates = new Gates(this.level.gates);
    this.zones = new ZoneMarkers(this.level.zones, 0x3ac0ff);
    this.padMarks = new ZoneMarkers(this.level.pads, 0x55ff88, 40);
    this.hover = new HoverMarker(this.level.hoverPoint);
    this.sm.scene.add(this.targets.group, this.gates.group, this.zones.group, this.padMarks.group, this.hover.mesh);
    this.flight = new FlightModel(this.settings);
    this.payload = new PayloadSystem(this.phys, this.targets, (i) => this.onPayloadImpact(i));
    this.sm.scene.add(this.payload.group);
    this.missions = new MissionManager(this.level);
    this.missions.onEvent = (t, k) => this.hud.notify(t, k);
    this.missions.onFinish = (r) => this.onMissionFinish(r);
    this.fpv.tilt = this.settings.camTilt;
    this.osd.setStyle(this.settings.osdStyle);
    this.audio.setVolume(this.settings.volume);
    this.sm.setTimeOfDay('day');
    this.level.lamps.visible = false;
    this.targets.setActiveGroups([]);
    this.phys.setDroneDamping(true);
    this.state = 'menu';
    this.menu.showMain();
  }

  // ------------------------------------------------------------------ качество и размер
  private initQuality() {
    const q = this.settings.quality;
    if (q === 'auto') {
      const mobile = ('ontouchstart' in window || navigator.maxTouchPoints > 0) && Math.min(screen.width, screen.height) < 900;
      this.quality = mobile ? 'medium' : 'high';
    } else this.quality = q;
  }

  private applyQuality(q: QualityLevel) {
    this.quality = q;
    this.phys?.setHz(QUALITY[q].physicsHz);
    this.resize();
  }

  private resize = () => {
    const p = QUALITY[this.quality];
    const w = window.innerWidth;
    const h = window.innerHeight;
    const f = Math.min(window.devicePixelRatio || 1, p.prCap) * p.scale;
    const pw = Math.max(2, Math.floor(w * f));
    const ph = Math.max(2, Math.floor(h * f));
    this.sm.renderer.setPixelRatio(1);
    this.sm.renderer.setSize(pw, ph, false);
    this.post.setSize(pw, ph, p.msaa);
    this.sm.setShadows(p.shadow);
    this.sm.resizeCamera(w, h);
    this.sm.setFov(this.settings.fov);
    this.particles.setScale(ph, this.sm.camera.fov);
    this.sticks.layout();
  };

  private monitorFps(dt: number) {
    this.fpsAcc += dt;
    this.fpsN++;
    this.fpsT += dt;
    if (this.fpsT > 4) {
      const fps = this.fpsN / this.fpsAcc;
      if (this.settings.quality === 'auto' && this.state === 'playing' && fps < 38 && this.quality !== 'low') {
        const next: QualityLevel = this.quality === 'high' ? 'medium' : 'low';
        this.applyQuality(next);
        this.hud.notify(`Качество снижено: ${next}`, 'info');
      }
      this.fpsAcc = this.fpsN = this.fpsT = 0;
    }
  }

  // ------------------------------------------------------------------ ввод
  private bindInput() {
    const b = this.input.bus;
    b.on('arm', () => this.state === 'playing' && this.toggleArm());
    b.on('reset', () => this.state === 'playing' && this.respawn(true));
    b.on('drop', () => this.state === 'playing' && this.dropPayload());
    b.on('tilt', (d) => {
      if (this.state !== 'playing' && this.state !== 'paused') return;
      this.settings.camTilt = clamp(this.settings.camTilt + d * 5, 0, 60);
      this.fpv.tilt = this.settings.camTilt;
      saveSettings(this.settings);
      this.hud.notify(`Наклон камеры: ${this.settings.camTilt}°`, 'info');
    });
    b.on('pause', () => {
      if (this.state === 'playing') this.pause();
      else if (this.state === 'paused') this.resume();
    });
    b.on('camera', () => {
      if (this.state !== 'playing') return;
      this.fpv.mode = this.fpv.mode === 'fpv' ? 'chase' : 'fpv';
      this.fpv.resetChase();
      this.hud.notify(this.fpv.mode === 'fpv' ? 'Вид: FPV' : 'Вид: снаружи', 'info');
    });
    b.on('mode', () => {
      if (this.state !== 'playing') return;
      const order = ['angle', 'horizon', 'acro'] as const;
      this.settings.flightMode = order[(order.indexOf(this.settings.flightMode) + 1) % 3];
      saveSettings(this.settings);
      this.hud.notify(`Режим: ${this.settings.flightMode.toUpperCase()}`, 'info');
    });
  }

  private settingsChanged(path: string) {
    saveSettings(this.settings);
    const s = this.settings;
    if (path === 'quality') {
      this.initQuality();
      this.applyQuality(this.quality);
    } else if (path === 'fov') {
      this.sm.setFov(s.fov);
      this.particles.setScale(this.sm.renderer.domElement.height, this.sm.camera.fov);
    } else if (path === 'camTilt') this.fpv.tilt = s.camTilt;
    else if (path === 'osdStyle') this.osd.setStyle(s.osdStyle);
    else if (path === 'volume') this.audio.setVolume(s.volume);
    else if (path.startsWith('stick') || path === 'touchUi') this.sticks.layout();
    else if (path === 'throttleMode') this.input.resetThrottle();
    else if (path === 'timeOfDay' && this.def.category === 'free') this.applyTod(s.timeOfDay);
    else if (path === 'freeTargets' && this.def.category === 'free') this.targets?.setActiveGroups(s.freeTargets ? FREE.groups : []);
  }

  private applyPreset(n: 'beginner' | 'pilot' | 'pro') {
    const s = this.settings;
    if (n === 'beginner') {
      s.flightMode = 'angle';
      s.throttleMode = 'assist';
      s.rpRates = { center: 90, max: 600, expo: 0.25 };
    } else if (n === 'pilot') {
      s.flightMode = 'horizon';
      s.throttleMode = 'hold';
      s.rpRates = { center: 100, max: 700, expo: 0.2 };
    } else {
      s.flightMode = 'acro';
      s.throttleMode = 'hold';
      s.rpRates = { center: 110, max: 800, expo: 0.15 };
    }
    this.input.resetThrottle();
    saveSettings(s);
  }

  // ------------------------------------------------------------------ состояние игры
  private applyTod(t: 'day' | 'dusk' | 'night') {
    this.sm.setTimeOfDay(t);
    this.level.lamps.visible = TOD[t].lamps;
  }

  private startMission(def: MissionDef) {
    if (!this.level) return;
    this.audio.start();
    this.def = def;
    const free = def.category === 'free';
    this.applyTod(def.tod ?? (free ? this.settings.timeOfDay : 'day'));
    this.targets.reset();
    this.targets.setActiveGroups(free ? (this.settings.freeTargets ? FREE.groups : []) : def.groups);
    this.gates.setActive(def.gates);
    this.zones.setActive(def.zones);
    this.padMarks.setActive(def.pads);
    this.hover.mesh.visible = def.hover;
    this.payload.clear();
    this.payloadsLeft = def.payloads;
    this.reload = 0;
    this.drone.setPayload(def.payloads !== 0);
    this.missions.start(def);
    this.resultTimer = -1;
    this.fpv.mode = 'fpv';
    this.respawn(false);
    this.state = 'playing';
    this.menu.hide();
    this.hud.setVisible(true);
    this.osd.setVisible(true);
    this.hud.notify(def.title.toUpperCase(), 'info');
    this.last = performance.now();
    this.freeRespawnT = 0;
    if (this.settings.throttleMode === 'hold') this.hud.notify('Газ вниз → ARM → газ вверх', 'info');
    else this.hud.notify('Нажмите ARM и потяните газ вверх', 'info');
  }

  private pause() {
    this.state = 'paused';
    this.audio.silenceMotors();
    this.menu.showPause();
  }

  private resume() {
    this.state = 'playing';
    this.menu.hide();
    this.last = performance.now();
  }

  private toMenu() {
    this.state = 'menu';
    this.hud.setVisible(false);
    this.osd.setVisible(false);
    this.hud.showOverlay('');
    this.audio.silenceMotors();
    this.payload.clear();
    this.targets.setActiveGroups([]);
    this.gates.setActive(false);
    this.zones.setActive([]);
    this.padMarks.setActive([]);
    this.hover.mesh.visible = false;
    this.drone.group.visible = false;
    this.applyTod('day');
    this.menu.showMain();
  }

  private onMissionFinish(r: MissionResult) {
    submitRecord(this.def.id, r.stars, r.score, r.time, r.success);
    this.hud.notify(r.success ? 'ЗАДАНИЕ ВЫПОЛНЕНО' : 'ЗАДАНИЕ ПРОВАЛЕНО', r.success ? 'ok' : 'warn');
    this.resultTimer = 1.8;
    if (r.success) this.audio.gate();
  }

  // ------------------------------------------------------------------ дрон
  private respawn(notify: boolean) {
    this.tmpV.copy(this.level.spawn);
    this.tmpQ.identity();
    this.phys.teleportDrone(this.tmpV, this.tmpQ);
    this.curPos.copy(this.tmpV);
    this.prevPos.copy(this.tmpV);
    this.curQuat.copy(this.tmpQ);
    this.prevQuat.copy(this.tmpQ);
    this.vel.set(0, 0, 0);
    this.ang.set(0, 0, 0);
    this.flight.reset();
    this.armed = false;
    this.crashed = false;
    this.failsafe = false;
    this.crashTimer = 0;
    this.flightTime = 0;
    this.lostT = 0;
    this.occ = 0;
    this.flash = 0;
    this.input.resetThrottle();
    this.fpv.resetChase();
    this.passive = true;
    this.phys.setDroneDamping(true);
    this.hud.showOverlay('');
    this.hud.setArmed(false);
    if (notify) this.hud.notify('Дрон возвращён на площадку', 'info');
  }

  private toggleArm() {
    if (this.crashed) return;
    if (!this.armed) {
      if (this.settings.throttleMode === 'hold' && this.input.holdThrottle > 0.08) {
        this.hud.notify('СНИЗЬТЕ ГАЗ ДЛЯ ARM', 'warn');
        this.audio.warn();
        return;
      }
      if (this.tmpV.set(0, 1, 0).applyQuaternion(this.curQuat).y < 0.2 && this.curPos.y < 1) {
        this.hud.notify('ДРОН ПЕРЕВЁРНУТ — нажмите RESET', 'warn');
        return;
      }
      this.armed = true;
    } else this.armed = false;
    this.audio.arm(this.armed);
    this.hud.setArmed(this.armed);
  }

  private dropPayload() {
    if (!this.armed || this.crashed) {
      this.hud.notify('Сначала ARM', 'warn');
      return;
    }
    if (this.payloadsLeft === 0 || this.reload > 0) {
      if (this.payloadsLeft === 0) this.hud.notify('НАГРУЗКА ИСЧЕРПАНА', 'warn');
      return;
    }
    this.tmpV.set(0, -0.1, 0).applyQuaternion(this.curQuat).add(this.curPos);
    this.tmpV2.copy(this.vel);
    this.payload.drop(this.tmpV, this.tmpV2);
    if (this.payloadsLeft > 0) this.payloadsLeft--;
    this.missions.drops++;
    this.audio.drop();
    if (this.payloadsLeft === 0) this.drone.setPayload(false);
    else if (this.payloadsLeft < 0) {
      this.reload = 1.4;
      this.drone.setPayload(false);
    }
  }

  private onPayloadImpact(i: PayloadImpact) {
    this.particles.explosion(i.pos, 1);
    this.audio.explosion(i.pos.distanceTo(this.curPos));
    this.glitchBoost = Math.max(this.glitchBoost, clamp(1 - i.pos.distanceTo(this.curPos) / 40, 0, 0.8));
    const killed = this.targets.blast(i.pos, 3.5);
    if (i.direct && i.direct.alive) {
      i.direct.destroy();
      killed.push(i.direct);
    }
    if (killed.length) {
      const pts = killed.reduce((a, t) => a + t.points, 0);
      this.missions.targetsDestroyed(killed.length, pts);
      for (const t of killed) this.particles.explosion(t.pos, 0.6);
    }
    this.missions.payloadImpact(i.pos);
  }

  private onImpact(dv: number) {
    if (dv > PHYS.crashImpact && this.armed && !this.crashed) {
      this.crashed = true;
      this.armed = false;
      this.crashTimer = PHYS.crashTime;
      this.particles.sparks(this.curPos, 40, 1.6);
      this.particles.smokePuff(this.curPos, 4, 1.4);
      this.audio.crash(1);
      this.flash = 0.7;
      this.glitchBoost = 1;
      this.shake = 1;
      this.missions.crashed();
      this.hud.setArmed(false);
      if (this.settings.haptics && navigator.vibrate) navigator.vibrate([60, 40, 120]);
    } else if (dv > PHYS.bumpImpact) {
      this.particles.sparks(this.curPos, 10 + dv * 2, 0.8);
      this.audio.bump();
      this.glitchBoost = Math.max(this.glitchBoost, 0.45);
      this.shake = Math.max(this.shake, 0.5);
      if (this.settings.haptics && navigator.vibrate) navigator.vibrate(30);
    }
  }

  // ------------------------------------------------------------------ фиксированный шаг физики
  private fixedStep(h: number) {
    this.prevPos.copy(this.curPos);
    this.prevQuat.copy(this.curQuat);
    const c = this.controls;
    const inp: FlightInput = { roll: c.roll, pitch: c.pitch, yaw: c.yaw, throttleStick: c.throttleStick, armed: this.armed, crashed: this.crashed };
    const ctl = this.flight.step(h, inp, this.curQuat, this.vel, this.ang);
    const passive = !ctl;
    if (passive !== this.passive) {
      this.passive = passive;
      this.phys.setDroneDamping(passive);
    }
    this.phys.writeDrone(this.vel, ctl ? this.ang : null);
    this.vPre.copy(this.vel);
    this.targets.step(h);
    this.phys.step();
    this.phys.readDrone(this.curPos, this.curQuat, this.vel, this.ang);
    const dv = this.vPre.distanceTo(this.vel);
    if (dv > PHYS.bumpImpact) this.onImpact(dv);

    if (this.gates.active && this.gates.check(this.prevPos, this.curPos)) {
      this.audio.gate();
      this.missions.gatePassed(this.gates.passed, this.vel.length());
      this.hud.notify(`ВОРОТА ${this.gates.passed}/${this.gates.total}`, 'ok');
    }
    if (this.curPos.y < -3 || this.curPos.lengthSq() > 1200 * 1200) this.respawn(true);
  }

  // ------------------------------------------------------------------ главный цикл
  private loop = (now: number) => {
    this.raf = requestAnimationFrame(this.loop);
    const dt = Math.min((now - this.last) / 1000, 0.1);
    this.last = now;
    this.clock += dt;
    this.controls = this.input.sample(dt);
    this.monitorFps(dt);

    if (this.state === 'playing') this.updatePlaying(dt);
    else if (this.state === 'loading' || this.state === 'menu' || this.state === 'paused') this.updateIdle(dt);
    this.render(dt);
  };

  private updateIdle(dt: number) {
    if (this.state === 'menu' || this.state === 'loading') {
      // «витрина»: облёт полигона
      const t = this.clock * 0.06;
      const cam = this.sm.camera;
      cam.position.set(30 + Math.cos(t) * 150, 38 + Math.sin(t * 1.7) * 8, -110 + Math.sin(t) * 150);
      cam.lookAt(30, 4, -110);
      this.sm.updateSky(cam.position);
    }
    void dt;
  }

  private updatePlaying(dt: number) {
    const hz = QUALITY[this.quality].physicsHz;
    const h = 1 / hz;
    this.acc += dt;
    let steps = 0;
    while (this.acc >= h && steps < 10) {
      this.fixedStep(h);
      this.acc -= h;
      steps++;
    }
    if (steps >= 10) this.acc = 0;
    const alpha = this.acc / h;
    this.rPos.lerpVectors(this.prevPos, this.curPos, alpha);
    this.rQuat.slerpQuaternions(this.prevQuat, this.curQuat, alpha);

    // таймеры
    if (this.armed) this.flightTime += dt;
    if (this.reload > 0) {
      this.reload -= dt;
      if (this.reload <= 0 && this.payloadsLeft < 0) this.drone.setPayload(true);
    }
    if (this.crashed) {
      this.crashTimer -= dt;
      if (Math.random() < dt * 25) this.particles.smokePuff(this.curPos, 1, 0.9);
      if (this.crashTimer <= 0) this.respawn(false);
    }
    this.flash = damp(this.flash, 0, 2.2, dt);
    this.glitchBoost = damp(this.glitchBoost, 0, 3.5, dt);
    this.shake = damp(this.shake, 0, 4, dt);

    this.updateSignal(dt);
    this.payload.update(dt);

    // дым от уничтоженных целей
    if (this.targets) {
      for (const t of this.targets.list) {
        if (!t.alive && t.active && t.smoke > 0) {
          t.smoke -= dt;
          if (Math.random() < dt * 10) this.particles.smokePuff(this.tmpV.set(t.pos.x, t.pos.y + 0.5, t.pos.z), 1, 1.4);
        }
      }
    }
    // пыль от потока винтов вблизи земли
    const gy = Math.max(terrainHeight(this.rPos.x, this.rPos.z), 0);
    const agl = this.rPos.y - gy;
    if (agl < 2.5 && this.flight.avgMotor > 0.25 && Math.random() < 0.6) {
      this.tmpV.set(this.rPos.x, gy + 0.1, this.rPos.z);
      this.particles.dust(this.tmpV, this.tmpV2.set(this.vel.x * 0.3, 0, this.vel.z * 0.3), 1);
    }

    // свободный полёт: мишени восстанавливаются
    if (this.def.category === 'free' && this.settings.freeTargets && this.targets.activeAlive().length === 0) {
      this.freeRespawnT += dt;
      if (this.freeRespawnT > 4) {
        this.targets.reset();
        this.targets.setActiveGroups(FREE.groups);
        this.hud.notify('Мишени восстановлены', 'info');
        this.freeRespawnT = 0;
      }
    }

    // миссия
    const upright = this.tmpV.set(0, 1, 0).applyQuaternion(this.curQuat).y > 0.7;
    this.missions.update(dt, {
      pos: this.curPos,
      speed: this.vel.length(),
      agl,
      armed: this.armed,
      upright,
      payloadsInFlight: this.payload.pending,
      payloadsLeft: this.payloadsLeft < 0 ? 99 : this.payloadsLeft,
    });
    if (this.resultTimer > 0) {
      this.resultTimer -= dt;
      if (this.resultTimer <= 0 && this.missions.result) {
        this.state = 'paused';
        this.audio.silenceMotors();
        this.menu.showResult(this.missions.result, this.def);
      }
    }
    this.hover.setInside(this.missions.hoverInside);
  }

  private updateSignal(dt: number) {
    this.sigT -= dt;
    if (this.sigT <= 0) {
      this.sigT = 0.15;
      const d = this.curPos.distanceTo(PILOT);
      let target = 0;
      if (d > 4) {
        this.tmpV.copy(this.curPos).sub(PILOT);
        const len = this.tmpV.length();
        this.tmpV.divideScalar(len);
        const hit = this.phys.raycast(PILOT, this.tmpV, len - 0.5);
        if (hit >= 0) target = 1;
      }
      this.occ += (target - this.occ) * 0.5;
    }
    const d = this.curPos.distanceTo(PILOT);
    const base = clamp(100 * (1 - Math.pow(d / 480, 1.7)), 0, 100);
    this.rssi = base * (1 - 0.62 * this.occ);
    if (this.rssi < 6 && !this.crashed) {
      this.lostT += dt;
      if (this.lostT > 3 && !this.failsafe) {
        // failsafe: дрон теряет управление и возвращается на площадку
        this.failsafe = true;
        this.crashed = true;
        this.armed = false;
        this.crashTimer = 1.6;
        this.hud.setArmed(false);
        this.hud.notify('FAILSAFE — потеря сигнала', 'warn');
      }
    } else if (this.rssi >= 6) this.lostT = Math.max(0, this.lostT - dt);
  }

  // ------------------------------------------------------------------ рендер
  private render(dt: number) {
    const sm = this.sm;
    const cam = sm.camera;
    const playing = this.state === 'playing' || this.state === 'paused';
    if (this.level && playing) {
      this.fpv.update(dt, this.rPos, this.rQuat, this.flight.avgMotor, this.vel.length(), this.shake);
      this.drone.group.position.copy(this.rPos);
      this.drone.group.quaternion.copy(this.rQuat);
      this.drone.group.visible = this.fpv.mode === 'chase';
      if (this.drone.group.visible) this.drone.update(dt, this.flight.motors);
      sm.updateSky(cam.position);
    }
    if (this.level) {
      this.targets.render(dt, this.clock);
      this.gates.pulse(this.clock);
      this.zones.update(this.clock);
      this.padMarks.update(this.clock);
      this.hover.mesh.rotation.y += dt * 0.5;
    }
    this.particles.update(dt);
    this.sticks.update();
    sm.followShadow(cam.position);

    if (this.state === 'playing') {
      this.audio.update(this.flight.motors, this.armed || this.crashed, this.vel.length());
      this.osdT -= dt;
      if (this.osdT <= 0) {
        this.osdT = 0.05;
        this.updateOsd(cam);
      }
      this.updatePipper(cam);
    }

    // FPV-эффекты
    const q = QUALITY[this.quality];
    const fpvOn = this.fpv.mode === 'fpv';
    const k = this.settings.fpvFx * q.fx * (fpvOn ? 1 : 0.35);
    const sigNoise = clamp((55 - this.rssi) / 55, 0, 1);
    const sigGlitch = clamp((78 - this.rssi) / 78, 0, 1);
    const analog = this.settings.osdStyle === 'analog' ? 1 : 0;
    const f = this.fx;
    const sigK = Math.max(0.35, this.settings.fpvFx);
    f.noise = this.state === 'playing' || this.state === 'paused' ? Math.pow(sigNoise, 1.2) * sigK * (fpvOn ? 1 : 0.5) : 0;
    f.glitch = clamp(Math.pow(sigGlitch, 1.5) * sigK + this.glitchBoost * Math.max(0.4, k), 0, 1);
    f.vignette = 0.3 + 0.5 * k;
    f.chroma = k * (analog ? 1 : 0.45);
    f.grain = (0.02 + 0.03 * k + sm.extraNoise * (0.5 + this.settings.fpvFx)) * (this.state === 'menu' ? 0.5 : 1);
    f.scan = k;
    f.gain = sm.gain;
    f.sat = analog ? 0.92 : 1;
    f.analog = analog * (fpvOn ? 1 : 0.4) * Math.min(1, this.settings.fpvFx * 2);
    f.flash = this.flash;
    this.post.render(sm.scene, cam, f, dt);
  }

  private updateOsd(cam: PerspectiveCamera) {
    const fl = this.flight;
    const m = this.missions;
    const free = this.def.category === 'free';
    // ориентация камеры для горизонта
    this.tmpV.set(1, 0, 0).applyQuaternion(cam.quaternion);
    const roll = (Math.asin(clamp(this.tmpV.y, -1, 1)) * 180) / Math.PI;
    this.tmpV.set(0, 0, -1).applyQuaternion(cam.quaternion);
    const pitch = (Math.asin(clamp(this.tmpV.y, -1, 1)) * 180) / Math.PI;
    const heading = Math.atan2(this.tmpV.x, -this.tmpV.z);
    const gy = Math.max(terrainHeight(this.curPos.x, this.curPos.z), 0);

    // целевой ориентир
    const gp = this.guidePoint();
    let tgtDist = -1;
    let tgtRel = 0;
    if (gp) {
      const dx = gp.x - this.curPos.x;
      const dz = gp.z - this.curPos.z;
      tgtDist = Math.hypot(dx, dz);
      let rel = (Math.atan2(dx, -dz) - heading) * (180 / Math.PI);
      rel = ((rel + 540) % 360) - 180;
      tgtRel = rel;
    }

    let warn = '';
    if (this.failsafe) warn = 'FAILSAFE';
    else if (this.crashed) warn = 'CRASH';
    else if (this.rssi < 8) warn = 'NO SIGNAL';
    else if (this.rssi < 30) warn = 'LOW SIGNAL';
    else if (fl.batteryPct < 0.15) warn = 'LOW BATTERY';

    const alive = this.targets.activeAlive().length;
    const total = this.targets.list.filter((t) => t.active).length;
    const d: OsdData = {
      volt: fl.voltage,
      mah: fl.batteryUsed,
      battPct: fl.batteryPct,
      mode: this.settings.flightMode === 'angle' ? 'ANGLE' : this.settings.flightMode === 'horizon' ? 'HORIZON' : 'ACRO',
      armed: this.armed,
      time: this.flightTime,
      rssi: this.rssi,
      speedKmh: this.vel.length() * 3.6,
      alt: Math.max(0, this.curPos.y - gy - 0.1),
      throttle: fl.throttleCmd,
      rollDeg: roll,
      pitchDeg: pitch,
      tilt: this.settings.camTilt,
      warn,
      score: Math.round(m.score),
      payloads: this.payloadsLeft < 0 ? 'PL ∞' : `PL ${this.payloadsLeft}`,
      targets: total > 0 ? `TGT ${total - alive}/${total}` : '',
      tgtDist: free && alive === 0 ? -1 : tgtDist,
      tgtRel,
    };
    this.osd.update(d);
    this.hud.updateObjectives(m);
    this.hud.setDrop(this.payloadsLeft < 0 ? (this.reload > 0 ? '…' : '∞') : String(this.payloadsLeft), this.payloadsLeft !== 0 && this.reload <= 0);
    const dropBtn = this.def.payloads === 0;
    this.hud.root.classList.toggle('no-drop', dropBtn);

    if (this.failsafe) this.hud.showOverlay('<div class="msg bad">FAILSAFE<small>ПОТЕРЯ СИГНАЛА</small></div>');
    else if (this.crashed) this.hud.showOverlay(`<div class="msg bad">CRASH<small>респавн через ${Math.max(0, Math.ceil(this.crashTimer))}</small></div>`);
    else this.hud.showOverlay('');
  }

  private guidePoint(): Vector3 | null {
    const m = this.missions;
    const def = this.def;
    if (!def || m.state !== 'running') return null;
    if (def.category === 'free') return this.targets.nearest(this.curPos)?.pos ?? null;
    for (let i = 0; i < def.objectives.length; i++) {
      if (m.objectives[i].done) continue;
      const o = def.objectives[i];
      if (o.type === 'destroy') return this.targets.nearest(this.curPos)?.pos ?? null;
      if (o.type === 'drop') return this.level.zones.find((z) => z.id === o.zone)?.pos ?? null;
      if (o.type === 'gates') return this.gates.next?.pos ?? null;
      if (o.type === 'land') return this.level.pads.find((p) => p.id === o.pad)?.pos ?? null;
      if (o.type === 'hover') return this.level.hoverPoint;
      return null;
    }
    return null;
  }

  private updatePipper(cam: PerspectiveCamera) {
    if (!this.settings.pipper || !this.armed || this.payloadsLeft === 0 || this.def.payloads === 0 || this.crashed) {
      this.hud.setPipper(null);
      return;
    }
    if (!this.payload.predict(this.curPos, this.vel, this.pipperPt)) {
      this.hud.setPipper(null);
      return;
    }
    cam.updateMatrixWorld();
    this.tmpV.copy(this.pipperPt).project(cam);
    if (this.tmpV.z > 1 || Math.abs(this.tmpV.x) > 1.05 || Math.abs(this.tmpV.y) > 1.05) {
      this.hud.setPipper(null);
      return;
    }
    this.hud.setPipper({ x: ((this.tmpV.x + 1) / 2) * window.innerWidth, y: ((1 - this.tmpV.y) / 2) * window.innerHeight });
  }
}

