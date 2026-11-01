import type { InputManager } from '../core/InputManager';

/** Боевой HUD: кнопки Arm/Drop/Tilt/Reset/Pause + баннер задачи */
export class HUD {
  private root = document.getElementById('hud') as HTMLElement;
  private banner = document.getElementById('objective-banner') as HTMLElement;
  private btnArm = document.getElementById('btn-arm') as HTMLButtonElement;
  private btnDrop = document.getElementById('btn-drop') as HTMLButtonElement;
  private onPause: () => void;
  private onArmToggle: () => void;
  private onReset: () => void;
  private onDrop: () => void;
  private onTilt: (d: number) => void;

  constructor(input: InputManager, handlers: { onPause: () => void; onArmToggle: () => void; onReset: () => void; onDrop: () => void; onTilt: (d: number) => void }) {
    this.onPause = handlers.onPause;
    this.onArmToggle = handlers.onArmToggle;
    this.onReset = handlers.onReset;
    this.onDrop = handlers.onDrop;
    this.onTilt = handlers.onTilt;

    const bind = (id: string, fn: () => void) => {
      const el = document.getElementById(id) as HTMLElement;
      el.addEventListener('click', (e) => {
        e.stopPropagation();
        fn();
      });
    };
    bind('btn-pause', () => this.onPause());
    bind('btn-arm', () => this.onArmToggle());
    bind('btn-drop', () => this.onDrop());
    bind('btn-reset', () => this.onReset());
    input.bindHoldButton(document.getElementById('btn-tilt-up') as HTMLElement, 5);
    input.bindHoldButton(document.getElementById('btn-tilt-dn') as HTMLElement, -5);
  }

  show(): void {
    this.root.classList.remove('hidden');
  }

  hide(): void {
    this.root.classList.add('hidden');
  }

  setArmed(armed: boolean): void {
    this.btnArm.classList.toggle('armed', armed);
    this.btnArm.textContent = armed ? 'DISARM' : 'ARM';
    this.btnDrop.disabled = !armed;
  }

  setObjective(text: string): void {
    this.banner.textContent = text;
    this.banner.style.display = text ? 'block' : 'none';
  }
}
