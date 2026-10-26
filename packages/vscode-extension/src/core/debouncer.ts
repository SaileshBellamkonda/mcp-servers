/** The timer functions a Debouncer uses; injected in tests so they control the clock. */
export interface Timers {
  setTimeout(run: () => void, ms: number): unknown;
  clearTimeout(handle: unknown): void;
}

const realTimers: Timers = {
  setTimeout: (run, ms) => setTimeout(run, ms),
  clearTimeout: (handle) => {
    clearTimeout(handle as NodeJS.Timeout);
  },
};

/**
 * Runs the latest action of a key once `delayMs` have passed without another trigger for that key, so several
 * quick changes (editing a few settings in a row) cause one run.
 */
export class Debouncer {
  private readonly handles = new Map<string, unknown>();

  constructor(
    private readonly delayMs: number,
    private readonly timers: Timers = realTimers
  ) {}

  trigger(key: string, action: () => void): void {
    const previous = this.handles.get(key);
    if (previous !== undefined) this.timers.clearTimeout(previous);
    const handle = this.timers.setTimeout(() => {
      this.handles.delete(key);
      action();
    }, this.delayMs);
    this.handles.set(key, handle);
  }

  dispose(): void {
    for (const handle of this.handles.values()) this.timers.clearTimeout(handle);
    this.handles.clear();
  }
}
