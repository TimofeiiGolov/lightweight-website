import type { OsdStyle } from '../config';

export interface OsdData {
  volt: number;
  mah: number;
  battPct: number;
  mode: string;
  armed: boolean;
  time: number;
  rssi: number;
  speedKmh: number;
  alt: number;
  throttle: number;
  rollDeg: number;
  pitchDeg: number;
  tilt: number;
  warn: string;
  score: number;
  payloads: string;
  targets: string;
  tgtDist: number; // <0 — нет цели
  tgtRel: number; // градусы относительно курса
}

const fmtTime = (t: number) => `${String(Math.floor(t / 60)).padStart(2, '0')}:${String(Math.floor(t % 60)).padStart(2, '0')}`;

/** Betaflight/DJI-подобный OSD: DOM-оверлей с моноширинным «пиксельным» шрифтом */
export class OSD {
  root = document.createElement('div');
  private el: { [k: string]: HTMLElement } = {};
  private cache: { [k: string]: string } = {};

  constructor(parent: HTMLElement) {
    this.root.className = 'osd analog';
    this.root.innerHTML = `
      <div class="osd-tl"><div><span class="ico">▮</span><span data-id="volt">16.8V</span></div><div data-id="mah" class="dim">0mAh</div></div>
      <div class="osd-tc"><span data-id="mode">ANGLE</span> <span data-id="arm" class="arm">DISARMED</span><div data-id="time" class="dim">00:00</div></div>
      <div class="osd-tr"><div>RSSI <span data-id="rssi">100</span></div><div class="bars" data-id="bars"></div></div>
      <div class="osd-ml"><div class="dim">SPD</div><div class="big" data-id="spd">0</div><div class="dim">km/h</div></div>
      <div class="osd-mr"><div class="dim">ALT</div><div class="big" data-id="alt">0.0</div><div class="dim">m</div></div>
      <div class="osd-hz" data-id="hz"><i class="l1"></i><i class="l2"></i><i class="l3"></i><b></b></div>
      <div class="osd-bc"><div class="thr"><div data-id="thrbar"></div></div><div>THR <span data-id="thr">0</span>%</div><div class="dim">CAM <span data-id="tilt">25</span>°</div></div>
      <div class="osd-tgt" data-id="tgt"><span data-id="tgtarrow">▲</span> <span data-id="tgttxt"></span></div>
      <div class="osd-stat"><div>PTS <span data-id="score">0</span></div><div data-id="tgtcnt" class="dim"></div><div data-id="pl" class="dim"></div></div>
      <div class="osd-warn" data-id="warn"></div>`;
    parent.appendChild(this.root);
    this.root.querySelectorAll<HTMLElement>('[data-id]').forEach((e) => (this.el[e.dataset.id!] = e));
    this.el.bars.innerHTML = '<i></i><i></i><i></i><i></i><i></i>';
  }

  setStyle(s: OsdStyle) {
    this.root.className = `osd ${s}`;
  }

  setVisible(v: boolean) {
    this.root.style.display = v ? 'block' : 'none';
  }

  private text(id: string, v: string) {
    if (this.cache[id] !== v) {
      this.cache[id] = v;
      this.el[id].textContent = v;
    }
  }

  update(d: OsdData) {
    this.text('volt', `${d.volt.toFixed(1)}V`);
    this.el.volt.className = d.battPct < 0.2 ? 'bad' : '';
    this.text('mah', `${Math.round(d.mah)}mAh`);
    this.text('mode', d.mode);
    this.text('arm', d.armed ? 'ARMED' : 'DISARMED');
    this.el.arm.className = d.armed ? 'arm on' : 'arm';
    this.text('time', fmtTime(d.time));
    this.text('rssi', String(Math.round(d.rssi)));
    this.el.rssi.className = d.rssi < 30 ? 'bad' : '';
    const bars = this.el.bars.children;
    for (let i = 0; i < 5; i++) (bars[i] as HTMLElement).className = d.rssi > (i + 0.5) * 20 ? 'on' : '';
    this.text('spd', String(Math.round(d.speedKmh)));
    this.text('alt', d.alt.toFixed(1));
    this.text('thr', String(Math.round(d.throttle * 100)));
    this.el.thrbar.style.width = `${Math.round(d.throttle * 100)}%`;
    this.text('tilt', String(Math.round(d.tilt)));
    this.text('score', String(d.score));
    this.text('tgtcnt', d.targets);
    this.text('pl', d.payloads);
    this.text('warn', d.warn);
    this.el.warn.style.display = d.warn ? 'block' : 'none';
    // искусственный горизонт
    const ppd = window.innerHeight / 55;
    this.el.hz.style.transform = `translate(-50%, -50%) rotate(${d.rollDeg.toFixed(1)}deg) translateY(${(d.pitchDeg * ppd).toFixed(1)}px)`;
    // индикатор цели
    if (d.tgtDist >= 0) {
      this.el.tgt.style.display = 'block';
      this.text('tgttxt', `${Math.round(d.tgtDist)}m`);
      this.el.tgtarrow.style.transform = `rotate(${d.tgtRel.toFixed(0)}deg)`;
    } else this.el.tgt.style.display = 'none';
  }
}
