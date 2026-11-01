/** Простой типизированный EventBus */
type Handler = (...args: unknown[]) => void;

export class EventBus {
  private map = new Map<string, Set<Handler>>();

  on(event: string, fn: Handler): () => void {
    let set = this.map.get(event);
    if (!set) {
      set = new Set();
      this.map.set(event, set);
    }
    set.add(fn);
    return () => this.off(event, fn);
  }

  off(event: string, fn: Handler): void {
    this.map.get(event)?.delete(fn);
  }

  emit(event: string, ...args: unknown[]): void {
    const set = this.map.get(event);
    if (!set) return;
    for (const fn of [...set]) {
      try {
        fn(...args);
      } catch (e) {
        console.error(`[EventBus] handler error on "${event}"`, e);
      }
    }
  }

  clear(): void {
    this.map.clear();
  }
}
