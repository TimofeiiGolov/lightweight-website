import type { InputManager } from '../core/InputManager';
import type { MissionManager } from '../missions/MissionManager';

/** Кнопки управления, уведомления, панель целей, прицельная метка, оверлеи краша */
export class HUD {
  root = document.createElement('div');
  private toast: HTMLElement;
  private objPanel: HTMLElement;
  private overlay: HTMLElement;
  private pipper: HTMLElement;
  private armBtn: HTMLElement;
  private dropBtn: HTMLElement;
  private dropCount: HTMLElement;
  private cache: { [k: string]: string } = {};

  constructor(
    parent: HTMLElement,
    private input: InputManager,
  ) {
    this.root.className = 'hud';
    this.root.innerHTML = `
      <div class="btn-left">
        <button class="hbtn arm" data-a="arm"><span>ARM</span></button>
        <button class="hbtn sm" data-a="tilt-" title="Камера вниз">CAM▼</button>
        <button class="hbtn sm" data-a="tilt+" title="Камера вверх">CAM▲</button>
      </div>
      <div class="btn-right">
        <button class="hbtn drop" data-a="drop"><span>DROP</span><small data-id="dc"></small></button>
      </div>
      <div class="btn-top">
        <button class="hbtn sm" data-a="pause">❚❚</button>
        <button class="hbtn sm" data-a="reset">⟲</button>
        <button class="hbtn sm" data-a="camera">VIEW</button>
        <button class="hbtn sm" data-a="mode">MODE</button>
      </div>
      <div class="objs" data-id="objs"></div>
      <div class="toast" data-id="toast"></div>
      <div class="pipper" data-id="pipper"></div>
      <div class="overlay" data-id="overlay"></div>
      <div class="kbhint">WASD — газ/рысканье · стрелки — тангаж/крен · SPACE — arm · F — сброс · R — reset · V — вид · M — режим · Q/E — камера</div>`;
    parent.appendChild(this.root);
    this.toast = this.root.querySelector('[data-id=toast]')!;
    this.objPanel = this.root.querySelector('[data-id=objs]')!;
    this.overlay = this.root.querySelector('[data-id=overlay]')!;
    this.pipper = this.root.querySelector('[data-id=pipper]')!;
    this.armBtn = this.root.querySelector('[data-a=arm]')!;
    this.dropBtn = this.root.querySelector('[data-a=drop]')!;
    this.dropCount = this.root.querySelector('[data-id=dc]')!;

    this.root.querySelectorAll<HTMLElement>('[data-a]').forEach((b) => {
      b.addEventListener('pointerdown', (e) => {
        e.preventDefault();
        e.stopPropagation();
        const a = b.dataset.a!;
        const bus = this.input.bus;
        if (a === 'tilt+') bus.emit('tilt', 1);
        else if (a === 'tilt-') bus.emit('tilt', -1);
        else bus.emit(a as 'arm', undefined as never);
      });
    });
  }

  setVisible(v: boolean) {
    this.root.style.display = v ? 'block' : 'none';
  }

  setArmed(armed: boolean) {
    this.armBtn.classList.toggle('on', armed);
    this.armBtn.firstElementChild!.textContent = armed ? 'DISARM' : 'ARM';
  }

  setDrop(text: string, enabled: boolean) {
    this.dropBtn.classList.toggle('off', !enabled);
    if (this.cache.dc !== text) {
      this.cache.dc = text;
      this.dropCount.textContent = text;
    }
  }

  notify(text: string, kind: 'ok' | 'warn' | 'info' = 'info') {
    const d = document.createElement('div');
    d.className = `t-${kind}`;
    d.textContent = text;
    this.toast.appendChild(d);
    while (this.toast.children.length > 3) this.toast.firstElementChild!.remove();
    setTimeout(() => d.remove(), 2800);
  }

  showOverlay(html: string) {
    if (this.cache.ov !== html) {
      this.cache.ov = html;
      this.overlay.innerHTML = html;
    }
    this.overlay.style.display = html ? 'flex' : 'none';
  }

  /** Прицельная метка точки падения (экранные координаты, null — скрыть) */
  setPipper(p: { x: number; y: number } | null) {
    if (!p) {
      this.pipper.style.display = 'none';
      return;
    }
    this.pipper.style.display = 'block';
    this.pipper.style.transform = `translate(${p.x.toFixed(0)}px, ${p.y.toFixed(0)}px) translate(-50%, -50%)`;
  }

  updateObjectives(m: MissionManager) {
    const d = m.def;
    if (!d || d.category === 'free') {
      if (this.cache.obj !== 'free') {
        this.cache.obj = 'free';
        this.objPanel.innerHTML = '';
      }
      this.objPanel.style.display = 'none';
      return;
    }
    this.objPanel.style.display = 'block';
    const tl = d.timeLimit > 0 ? m.timeLeft : m.elapsed;
    const t = `${String(Math.floor(tl / 60)).padStart(2, '0')}:${String(Math.floor(tl % 60)).padStart(2, '0')}`;
    const rows = m.objectives
      .map((o) => {
        const p = o.type === 'hover' ? `${o.progress.toFixed(1)}/${o.target}с` : o.type === 'altitude' ? `${Math.round(o.progress)}/${o.target}м` : o.target > 1 ? `${o.progress}/${o.target}` : o.done ? '✔' : '';
        return `<div class="${o.done ? 'done' : ''}"><span>${o.done ? '✔' : '▫'} ${o.label}</span><b>${p}</b></div>`;
      })
      .join('');
    const html = `<div class="ot"><span>${d.title}</span><b class="${d.timeLimit > 0 && m.timeLeft < 20 ? 'bad' : ''}">${t}</b></div>${rows}`;
    if (this.cache.obj !== html) {
      this.cache.obj = html;
      this.objPanel.innerHTML = html;
    }
  }
}
