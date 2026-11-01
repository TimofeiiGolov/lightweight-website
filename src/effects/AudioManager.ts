import { clamp } from '../utils/MathUtils';

/** Процедурный звук на Web Audio: моторы, ветер, взрывы, сигналы. Файлы не нужны. */
export class AudioManager {
  private ctx: AudioContext | null = null;
  private master!: GainNode;
  private motorOscs: OscillatorNode[] = [];
  private motorGain!: GainNode;
  private motorFilter!: BiquadFilterNode;
  private windGain!: GainNode;
  private windFilter!: BiquadFilterNode;
  private noiseBuf!: AudioBuffer;
  private volume = 0.6;

  /** Нужно вызывать из пользовательского жеста (тап по кнопке) */
  start() {
    if (this.ctx) {
      void this.ctx.resume();
      return;
    }
    const AC = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    if (!AC) return;
    const ctx = new AC();
    this.ctx = ctx;
    this.master = ctx.createGain();
    this.master.gain.value = this.volume;
    this.master.connect(ctx.destination);

    this.motorGain = ctx.createGain();
    this.motorGain.gain.value = 0;
    this.motorFilter = ctx.createBiquadFilter();
    this.motorFilter.type = 'lowpass';
    this.motorFilter.frequency.value = 1400;
    this.motorFilter.connect(this.motorGain).connect(this.master);
    for (let i = 0; i < 4; i++) {
      const o = ctx.createOscillator();
      o.type = i % 2 ? 'sawtooth' : 'square';
      o.frequency.value = 100;
      const g = ctx.createGain();
      g.gain.value = 0.25;
      o.connect(g).connect(this.motorFilter);
      o.start();
      this.motorOscs.push(o);
    }

    const len = ctx.sampleRate * 2;
    this.noiseBuf = ctx.createBuffer(1, len, ctx.sampleRate);
    const d = this.noiseBuf.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
    const wind = ctx.createBufferSource();
    wind.buffer = this.noiseBuf;
    wind.loop = true;
    this.windFilter = ctx.createBiquadFilter();
    this.windFilter.type = 'bandpass';
    this.windFilter.frequency.value = 500;
    this.windFilter.Q.value = 0.6;
    this.windGain = ctx.createGain();
    this.windGain.gain.value = 0;
    wind.connect(this.windFilter).connect(this.windGain).connect(this.master);
    wind.start();
  }

  setVolume(v: number) {
    this.volume = v;
    if (this.master) this.master.gain.value = v;
  }

  /** Каждый кадр */
  update(motors: Float32Array, armed: boolean, speed: number) {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    let avg = 0;
    for (let i = 0; i < 4; i++) {
      avg += motors[i];
      this.motorOscs[i].frequency.setTargetAtTime(70 + motors[i] * 520 + i * 3, t, 0.03);
    }
    avg /= 4;
    const on = armed || avg > 0.02;
    this.motorGain.gain.setTargetAtTime(on ? 0.05 + avg * 0.14 : 0, t, 0.08);
    this.motorFilter.frequency.setTargetAtTime(500 + avg * 2500, t, 0.05);
    const w = clamp(speed / 28, 0, 1);
    this.windGain.gain.setTargetAtTime(w * w * 0.35, t, 0.1);
    this.windFilter.frequency.setTargetAtTime(300 + w * 1400, t, 0.1);
  }

  silenceMotors() {
    if (this.ctx) this.motorGain.gain.setTargetAtTime(0, this.ctx.currentTime, 0.05);
  }

  beep(freq = 880, dur = 0.12, vol = 0.2, type: OscillatorType = 'sine') {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    const o = this.ctx.createOscillator();
    const g = this.ctx.createGain();
    o.type = type;
    o.frequency.value = freq;
    g.gain.setValueAtTime(vol, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g).connect(this.master);
    o.start(t);
    o.stop(t + dur + 0.02);
  }

  arm(on: boolean) {
    this.beep(on ? 1200 : 600, 0.1, 0.18, 'square');
    if (on) setTimeout(() => this.beep(1600, 0.1, 0.18, 'square'), 120);
  }

  gate() {
    this.beep(1040, 0.08, 0.2);
    setTimeout(() => this.beep(1560, 0.12, 0.2), 80);
  }

  warn() {
    this.beep(520, 0.15, 0.2, 'square');
  }

  drop() {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    const o = this.ctx.createOscillator();
    const g = this.ctx.createGain();
    o.type = 'triangle';
    o.frequency.setValueAtTime(900, t);
    o.frequency.exponentialRampToValueAtTime(200, t + 0.25);
    g.gain.setValueAtTime(0.12, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.3);
    o.connect(g).connect(this.master);
    o.start(t);
    o.stop(t + 0.35);
  }

  private noiseBurst(dur: number, f0: number, f1: number, vol: number) {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    const s = this.ctx.createBufferSource();
    s.buffer = this.noiseBuf;
    const f = this.ctx.createBiquadFilter();
    f.type = 'lowpass';
    f.frequency.setValueAtTime(f0, t);
    f.frequency.exponentialRampToValueAtTime(f1, t + dur);
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(vol, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    s.connect(f).connect(g).connect(this.master);
    s.start(t);
    s.stop(t + dur + 0.05);
  }

  explosion(distance: number) {
    if (!this.ctx) return;
    const vol = clamp(1.1 - distance / 250, 0.15, 1);
    this.noiseBurst(1.6, 2000, 60, vol);
    const t = this.ctx.currentTime;
    const o = this.ctx.createOscillator();
    const g = this.ctx.createGain();
    o.frequency.setValueAtTime(90, t);
    o.frequency.exponentialRampToValueAtTime(28, t + 0.7);
    g.gain.setValueAtTime(vol * 0.9, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.9);
    o.connect(g).connect(this.master);
    o.start(t);
    o.stop(t + 1);
  }

  crash(power = 1) {
    this.noiseBurst(0.35 + power * 0.2, 1800, 200, clamp(0.3 + power * 0.3, 0.2, 0.9));
  }

  bump() {
    this.noiseBurst(0.12, 1500, 300, 0.25);
  }
}
