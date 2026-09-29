import type { Speed } from '../../shared/events.ts';

/**
 * The server owns time. Every delay the audience perceives is scheduled here, never in the
 * browser - otherwise pause and speed would have two owners, and a reconnecting viewer would
 * be watching a differently-timed game from the one actually running.
 *
 * Pausing stops *scheduling*, it does not abort work already in flight. Model inference is by
 * far the most expensive thing in this system and it will be wanted the moment the game
 * resumes, so throwing it away at a pause boundary would be pure waste.
 */

export type Beat = 'think' | 'thought' | 'action' | 'street' | 'showdown' | 'handEnd';

export const BEATS: Record<Speed, Record<Beat, number>> = {
  slow: { think: 1400, thought: 2800, action: 900, street: 1400, showdown: 5000, handEnd: 4000 },
  normal: { think: 700, thought: 1600, action: 500, street: 800, showdown: 3200, handEnd: 2500 },
  fast: { think: 300, thought: 800, action: 250, street: 400, showdown: 1600, handEnd: 1200 },
  turbo: { think: 0, thought: 0, action: 0, street: 0, showdown: 0, handEnd: 0 },
};

export class Cancelled extends Error {
  constructor() {
    super('cancelled');
  }
}

export class Pacer {
  #speed: Speed;
  #paused = false;
  #idle = false;
  #resumeWaiters: (() => void)[] = [];
  #timers = new Set<{ timer: ReturnType<typeof setTimeout>; reject: (error: Error) => void }>();

  constructor(speed: Speed) {
    this.#speed = speed;
  }

  get speed(): Speed {
    return this.#speed;
  }

  /** Paused by a person. Distinct from idling because nobody is watching. */
  get paused(): boolean {
    return this.#paused;
  }

  get idle(): boolean {
    return this.#idle;
  }

  get held(): boolean {
    return this.#paused || this.#idle;
  }

  /**
   * Stops the game while no browser is connected.
   *
   * Measured on this machine, a tournament in progress costs about two of the four cores,
   * sustained for hours - the decision model is busy roughly seventy percent of wall-clock
   * time, because a decision takes longer than the beat that is meant to hide it. Nobody is
   * watching most of the time, and a poker game with no audience is pure waste, so the loop
   * holds until someone opens the page.
   */
  setIdle(idle: boolean): void {
    if (this.#idle === idle) return;
    this.#idle = idle;
    if (!idle) this.#release();
  }

  setSpeed(speed: Speed): void {
    this.#speed = speed;
  }

  pause(): void {
    this.#paused = true;
  }

  resume(): void {
    if (!this.#paused) return;
    this.#paused = false;
    this.#release();
  }

  #release(): void {
    if (this.held) return;
    const waiters = this.#resumeWaiters;
    this.#resumeWaiters = [];
    for (const waiter of waiters) waiter();
  }

  /** Awaited before anything that costs CPU. Resolves at once unless paused or unwatched. */
  gate(): Promise<void> {
    if (!this.held) return Promise.resolve();
    return new Promise((resolve) => this.#resumeWaiters.push(resolve));
  }

  /**
   * Holds for one beat at the current speed. Cancellable, because a plain setTimeout would
   * deadlock "new tournament while paused" the first time anyone tried it.
   */
  beat(kind: Beat): Promise<void> {
    const ms = BEATS[this.#speed][kind];
    if (ms <= 0) return Promise.resolve();
    return this.sleep(ms);
  }

  sleep(ms: number): Promise<void> {
    return new Promise<void>((resolve, reject) => {
      const entry = {
        timer: setTimeout(() => {
          this.#timers.delete(entry);
          resolve();
        }, ms),
        reject,
      };
      this.#timers.add(entry);
    });
  }

  /** Aborts every pending sleep and releases anything waiting on the pause gate. */
  cancel(): void {
    for (const entry of this.#timers) {
      clearTimeout(entry.timer);
      entry.reject(new Cancelled());
    }
    this.#timers.clear();
    const waiters = this.#resumeWaiters;
    this.#resumeWaiters = [];
    for (const waiter of waiters) waiter();
  }

  /** Waits until at least `ms` has passed since `startedAt` - used to floor the think time. */
  async untilAtLeast(startedAt: number, kind: Beat): Promise<void> {
    const target = BEATS[this.#speed][kind];
    const elapsed = performance.now() - startedAt;
    if (elapsed < target) await this.sleep(target - elapsed);
  }
}
