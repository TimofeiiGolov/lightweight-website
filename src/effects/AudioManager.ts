/**
 * Процедурный звук на Web Audio API (без внешних файлов):
 * - моторы: 4 расстроенные пилы + шум, частота/фильтр по газу
 * - ветер: полосовой шум по скорости
 * - события: взрыв, бипы, арм/дисарм, попадание, ворота, победа/провал, клики
 */
export class AudioManager {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private motorGain: GainNode | null = null;
  private motorFilter: BiquadFilterNode | null = null;
  private oscs: OscillatorNode[] = [];
  private noiseSrc: AudioBufferSourceNode | null = null;
  private propGain: GainNode | null = null;
  private propFilter: BiquadFilterNode | null = null;
  private windGain: GainNode | null = null;
  private windFilter: BiquadFilterNode | null = null;
  private noiseBuffer: AudioBuffer | null = null;
  private volume = 0.8;
  private started = false;

  /** Запуск по первому пользовательскому жесту */
  ensureStarted(): void {
    if (this.started) return;
    try {
      const Ctor = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      this.ctx = new Ctor();
      const ctx = this.ctx;

      this.master = ctx.createGain();
      this.master.gain.value = this.volume;
      this.master.connect(ctx.destination);

      // белый шум (общий буфер)
      const len = ctx.sampleRate;
      this.noiseBuffer = ctx.createBuffer(1, len, ctx.sampleRate);
      const data = this.noiseBuffer.getChannelData(0);
      for (let i = 0; i < len; i++) data[i] = Math.random() * 2 - 1;

      // --- моторы ---
      this.motorFilter = ctx.createBiquadFilter();
      this.motorFilter.type = 'lowpass';
      this.motorFilter.frequency.value = 400;
      this.motorFilter.Q.value = 0.8;
      this.motorGain = ctx.createGain();
      this.motorGain.gain.value = 0;
      this.motorFilter.connect(this.motorGain);
      this.motorGain.connect(this.master);

      for (let i = 0; i < 4; i++) {
        const osc = ctx.createOscillator();
        osc.type = 'sawtooth';
        osc.frequency.value = 90;
        osc.detune.value = (i - 1.5) * 7;
        const g = ctx.createGain();
        g.gain.value = 0.22;
        osc.connect(g);
        g.connect(this.motorFilter);
        osc.start();
        this.oscs.push(osc);
      }

      // шум пропеллеров
      this.propFilter = ctx.createBiquadFilter();
      this.propFilter.type = 'bandpass';
      this.propFilter.frequency.value = 900;
      this.propFilter.Q.value = 1.2;
      this.propGain = ctx.createGain();
      this.propGain.gain.value = 0;
      this.propFilter.connect(this.propGain);
      this.propGain.connect(this.master);
      this.noiseSrc = ctx.createBufferSource();
      this.noiseSrc.buffer = this.noiseBuffer;
      this.noiseSrc.loop = true;
      this.noiseSrc.connect(this.propFilter);
      this.noiseSrc.start();

      // --- ветер ---
      this.windFilter = ctx.createBiquadFilter();
      this.windFilter.type = 'bandpass';
      this.windFilter.frequency.value = 500;
      this.windFilter.Q.value = 0.5;
      this.windGain = ctx.createGain();
      this.windGain.gain.value = 0;
      this.windFilter.connect(this.windGain);
      this.windGain.connect(this.master);
      const windSrc = ctx.createBufferSource();
      windSrc.buffer = this.noiseBuffer;
      windSrc.loop = true;
      windSrc.connect(this.windFilter);
      windSrc.start();

      this.started = true;
    } catch (e) {
      console.warn('[Audio] не удалось инициализировать', e);
    }
  }

  resume(): void {
    if (this.ctx && this.ctx.state === 'suspended') {
      void this.ctx.resume();
    }
  }

  setVolume(v: number): void {
    this.volume = v;
    if (this.master) this.master.gain.value = v;
  }

  /** Обновление моторов/ветра каждый кадр */
  update(armed: boolean, spool: number, speed: number, yawInput: number): void {
    if (!this.started || !this.ctx) return;
    const t = this.ctx.currentTime;
    const base = 78 + 250 * spool;
    for (let i = 0; i < this.oscs.length; i++) {
      const diff = (i % 2 === 0 ? 1 : -1) * yawInput * 14;
      this.oscs[i].frequency.setTargetAtTime(base + diff + i * 2, t, 0.04);
    }
    this.motorFilter?.frequency.setTargetAtTime(240 + 2300 * spool, t, 0.05);
    this.motorGain?.gain.setTargetAtTime(armed ? 0.045 + 0.16 * spool : 0, t, 0.06);
    this.propFilter?.frequency.setTargetAtTime(600 + 900 * spool, t, 0.05);
    this.propGain?.gain.setTargetAtTime(armed ? 0.02 + 0.1 * spool : 0, t, 0.06);
    this.windFilter?.frequency.setTargetAtTime(300 + speed * 26, t, 0.1);
    this.windGain?.gain.setTargetAtTime(Math.min(0.28, speed * 0.011), t, 0.12);
  }

  private beep(freq: number, dur: number, type: OscillatorType = 'sine', gain = 0.14, when = 0): void {
    if (!this.started || !this.ctx || !this.master) return;
    const ctx = this.ctx;
    const t = ctx.currentTime + when;
    const osc = ctx.createOscillator();
    osc.type = type;
    osc.frequency.value = freq;
    const g = ctx.createGain();
    g.gain.setValueAtTime(gain, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + dur);
    osc.connect(g);
    g.connect(this.master);
    osc.start(t);
    osc.stop(t + dur + 0.02);
  }

  click(): void {
    this.beep(1900, 0.035, 'square', 0.05);
  }

  arm(): void {
    this.beep(1100, 0.09, 'square', 0.1);
    this.beep(1500, 0.12, 'square', 0.1, 0.12);
  }

  disarm(): void {
    this.beep(880, 0.16, 'square', 0.09);
  }

  gate(): void {
    this.beep(1350, 0.08, 'sine', 0.12);
    this.beep(1800, 0.1, 'sine', 0.1, 0.07);
  }

  hit(): void {
    this.beep(2100, 0.05, 'square', 0.12);
    this.beep(1500, 0.07, 'square', 0.09, 0.04);
  }

  lowBattery(): void {
    this.beep(700, 0.12, 'square', 0.1);
  }

  explosion(): void {
    if (!this.started || !this.ctx || !this.master || !this.noiseBuffer) return;
    const ctx = this.ctx;
    const t = ctx.currentTime;
    // шумовой удар
    const src = ctx.createBufferSource();
    src.buffer = this.noiseBuffer;
    const f = ctx.createBiquadFilter();
    f.type = 'lowpass';
    f.frequency.setValueAtTime(3200, t);
    f.frequency.exponentialRampToValueAtTime(120, t + 0.7);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.6, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + 0.85);
    src.connect(f);
    f.connect(g);
    g.connect(this.master);
    src.start(t);
    src.stop(t + 0.9);
    // низкий «бум»
    const osc = ctx.createOscillator();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(62, t);
    osc.frequency.exponentialRampToValueAtTime(28, t + 0.5);
    const og = ctx.createGain();
    og.gain.setValueAtTime(0.5, t);
    og.gain.exponentialRampToValueAtTime(0.001, t + 0.55);
    osc.connect(og);
    og.connect(this.master);
    osc.start(t);
    osc.stop(t + 0.6);
  }

  crash(): void {
    this.explosion();
  }

  win(): void {
    const notes = [880, 1100, 1320, 1760];
    notes.forEach((n, i) => this.beep(n, 0.16, 'sine', 0.12, i * 0.13));
  }

  fail(): void {
    const notes = [420, 320, 240];
    notes.forEach((n, i) => this.beep(n, 0.2, 'sawtooth', 0.08, i * 0.16));
  }

  drop(): void {
    this.beep(500, 0.1, 'triangle', 0.12);
    this.beep(350, 0.14, 'triangle', 0.1, 0.08);
  }
}
