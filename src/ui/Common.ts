import { TITLE, VERSION } from '../config';
import type { Quality } from '../types';
import { isMobileDevice } from '../utils/MathUtils';

/** Простой тост */
let toastTimer: ReturnType<typeof setTimeout> | null = null;
export function toast(text: string, ms = 2200): void {
  let el = document.getElementById('toast');
  if (!el) {
    el = document.createElement('div');
    el.id = 'toast';
    document.body.appendChild(el);
  }
  el.textContent = text;
  el.classList.add('show');
  if (toastTimer) clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove('show'), ms);
}

/** Автоматический выбор качества */
export function autoQuality(): Quality {
  const mobile = isMobileDevice();
  const cores = navigator.hardwareConcurrency ?? 4;
  if (!mobile && cores >= 8) return 'high';
  if (mobile && cores >= 8) return 'medium';
  return cores >= 6 ? 'medium' : 'low';
}

/** Экран загрузки */
export class LoadingScreen {
  private root = document.getElementById('menu-root') as HTMLElement;
  private bar: HTMLElement;
  private status: HTMLElement;

  constructor() {
    this.root.innerHTML = '';
    const wrap = document.createElement('div');
    wrap.id = 'loading';
    wrap.innerHTML = `
      <div class="load-title">${TITLE}</div>
      <div class="load-bar"><div id="load-bar-fill"></div></div>
      <div class="load-status" id="load-status">Инициализация…</div>
      <div class="load-status" style="opacity:0.5">v${VERSION} · Three.js + Rapier3D</div>`;
    this.root.appendChild(wrap);
    this.bar = wrap.querySelector('#load-bar-fill') as HTMLElement;
    this.status = wrap.querySelector('#load-status') as HTMLElement;
  }

  set(progress: number, text: string): void {
    this.bar.style.width = `${Math.round(progress * 100)}%`;
    this.status.textContent = text;
  }

  done(): void {
    const el = document.getElementById('loading');
    if (el) el.remove();
  }
}
