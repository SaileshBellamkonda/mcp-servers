import { describe, expect, it, vi } from 'vitest';
import { Debouncer, type Timers } from '../../src/core/debouncer';

/** A clock the test advances by hand. */
class ManualTimers implements Timers {
  now = 0;
  private nextId = 1;
  private readonly pending = new Map<number, { at: number; run: () => void }>();

  setTimeout(run: () => void, ms: number): number {
    const id = this.nextId++;
    this.pending.set(id, { at: this.now + ms, run });
    return id;
  }
  clearTimeout(handle: unknown): void {
    this.pending.delete(handle as number);
  }
  advance(ms: number): void {
    this.now += ms;
    for (const [id, timer] of [...this.pending]) {
      if (timer.at <= this.now) {
        this.pending.delete(id);
        timer.run();
      }
    }
  }
  get count(): number {
    return this.pending.size;
  }
}

describe('Debouncer', () => {
  it('runs the action once, after the quiet period', () => {
    const timers = new ManualTimers();
    const debouncer = new Debouncer(500, timers);
    const action = vi.fn();
    debouncer.trigger('coderag', action);
    timers.advance(499);
    expect(action).not.toHaveBeenCalled();
    timers.advance(1);
    expect(action).toHaveBeenCalledOnce();
  });

  it('collapses a burst of triggers into one run, measured from the last trigger', () => {
    const timers = new ManualTimers();
    const debouncer = new Debouncer(500, timers);
    const action = vi.fn();
    for (let i = 0; i < 5; i++) {
      debouncer.trigger('coderag', action);
      timers.advance(300);
    }
    expect(action).not.toHaveBeenCalled();
    timers.advance(200);
    expect(action).toHaveBeenCalledOnce();
  });

  it('keeps the keys independent', () => {
    const timers = new ManualTimers();
    const debouncer = new Debouncer(500, timers);
    const a = vi.fn();
    const b = vi.fn();
    debouncer.trigger('a', a);
    timers.advance(300);
    debouncer.trigger('b', b);
    timers.advance(200);
    expect(a).toHaveBeenCalledOnce();
    expect(b).not.toHaveBeenCalled();
    timers.advance(300);
    expect(b).toHaveBeenCalledOnce();
  });

  it('runs again for a trigger after the previous run', () => {
    const timers = new ManualTimers();
    const debouncer = new Debouncer(500, timers);
    const action = vi.fn();
    debouncer.trigger('k', action);
    timers.advance(500);
    debouncer.trigger('k', action);
    timers.advance(500);
    expect(action).toHaveBeenCalledTimes(2);
  });

  it('dispose() cancels everything that is pending', () => {
    const timers = new ManualTimers();
    const debouncer = new Debouncer(500, timers);
    const action = vi.fn();
    debouncer.trigger('k', action);
    debouncer.dispose();
    expect(timers.count).toBe(0);
    timers.advance(1000);
    expect(action).not.toHaveBeenCalled();
  });

  it('uses the real timers by default', () => {
    vi.useFakeTimers();
    try {
      const debouncer = new Debouncer(500);
      const action = vi.fn();
      debouncer.trigger('k', action);
      vi.advanceTimersByTime(500);
      expect(action).toHaveBeenCalledOnce();
    } finally {
      vi.useRealTimers();
    }
  });
});
