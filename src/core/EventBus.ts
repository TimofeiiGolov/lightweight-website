// Минимальная типизированная шина событий

type Handler<T> = (payload: T) => void;

export class EventBus<Events extends { [k: string]: unknown }> {
  private map = new Map<keyof Events, Set<Handler<never>>>();

  on<K extends keyof Events>(name: K, fn: Handler<Events[K]>): () => void {
    let set = this.map.get(name);
    if (!set) this.map.set(name, (set = new Set()));
    set.add(fn as Handler<never>);
    return () => set!.delete(fn as Handler<never>);
  }

  emit<K extends keyof Events>(name: K, payload: Events[K]) {
    this.map.get(name)?.forEach((fn) => (fn as Handler<Events[K]>)(payload));
  }
}

/** События игрового ввода (кнопки) */
export type InputEvents = {
  arm: void;
  reset: void;
  drop: void;
  tilt: number; // +1 / -1
  pause: void;
  camera: void;
  mode: void;
};
