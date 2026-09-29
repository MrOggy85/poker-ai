import logger from '../logger.ts';

/**
 * Every model call in the process goes through here, one at a time.
 *
 * Two reasons it has to be a real queue rather than a convention. The machine has four cores
 * and no GPU, so two concurrent inferences are slower than two sequential ones. And Jeff holds
 * a single non-blocking lock: a second concurrent request is **rejected** with 529, not
 * queued. Being the only caller is what keeps that from ever happening in normal running -
 * which in turn makes a 529 in production a useful signal that something else is talking to
 * Jeff, rather than ordinary load shedding.
 *
 * Decisions outrank monologues, so the thought for one hand can never delay the decision for
 * the next.
 */

export type JobKind = 'decision' | 'monologue';

interface Job<T> {
  kind: JobKind;
  timeoutMs: number;
  run(signal: AbortSignal): Promise<T>;
  resolve(value: T): void;
  reject(error: Error): void;
}

export interface QueueStats {
  inFlight: boolean;
  queued: number;
  completed: Record<JobKind, number>;
  timeouts: Record<JobKind, number>;
  failures: Record<JobKind, number>;
  /** Median and worst latency in milliseconds, over a rolling window. */
  medianMs: Record<JobKind, number>;
  worstMs: Record<JobKind, number>;
}

export class Cancelled extends Error {
  constructor() {
    super('inference cancelled');
  }
}

export class TimedOut extends Error {
  constructor(kind: JobKind, ms: number) {
    super(`${kind} timed out after ${ms}ms`);
  }
}

const WINDOW = 50;

export class InferenceQueue {
  // deno-lint-ignore no-explicit-any
  #pending: Job<any>[] = [];
  #running = false;
  #paused = false;
  #current: AbortController | null = null;

  #completed: Record<JobKind, number> = { decision: 0, monologue: 0 };
  #timeouts: Record<JobKind, number> = { decision: 0, monologue: 0 };
  #failures: Record<JobKind, number> = { decision: 0, monologue: 0 };
  #latencies: Record<JobKind, number[]> = { decision: [], monologue: [] };

  submit<T>(job: { kind: JobKind; timeoutMs: number; run(signal: AbortSignal): Promise<T> }): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      const entry: Job<T> = { ...job, resolve, reject };
      // A stable priority insert: decisions ahead of monologues, otherwise first come first
      // served. The queue is never more than a handful of items deep.
      const index = job.kind === 'decision'
        ? this.#pending.findIndex((pending) => pending.kind === 'monologue')
        : -1;
      if (index >= 0) this.#pending.splice(index, 0, entry);
      else this.#pending.push(entry);
      void this.#drain();
    });
  }

  /** Stops scheduling. Work already in flight always runs to completion. */
  pause(): void {
    this.#paused = true;
  }

  resume(): void {
    if (!this.#paused) return;
    this.#paused = false;
    void this.#drain();
  }

  /** Aborts the in-flight call and rejects everything queued. Used by a new tournament. */
  cancelAll(): void {
    this.#current?.abort();
    const pending = this.#pending;
    this.#pending = [];
    for (const job of pending) job.reject(new Cancelled());
  }

  async #drain(): Promise<void> {
    if (this.#running || this.#paused) return;
    const job = this.#pending.shift();
    if (!job) return;

    this.#running = true;
    const controller = new AbortController();
    this.#current = controller;
    const timer = setTimeout(() => controller.abort(), job.timeoutMs);
    const startedAt = performance.now();

    try {
      const value = await job.run(controller.signal);
      this.#record(job.kind, performance.now() - startedAt);
      this.#completed[job.kind]++;
      job.resolve(value);
    } catch (error) {
      if (controller.signal.aborted) {
        this.#timeouts[job.kind]++;
        job.reject(new TimedOut(job.kind, job.timeoutMs));
      } else {
        this.#failures[job.kind]++;
        job.reject(error instanceof Error ? error : new Error(String(error)));
      }
    } finally {
      clearTimeout(timer);
      this.#current = null;
      this.#running = false;
      // Not recursion: the await above has already returned, so the stack is flat.
      void this.#drain();
    }
  }

  #record(kind: JobKind, ms: number): void {
    const window = this.#latencies[kind];
    window.push(ms);
    if (window.length > WINDOW) window.shift();
  }

  stats(): QueueStats {
    const median = (kind: JobKind) => {
      const sorted = [...this.#latencies[kind]].sort((a, b) => a - b);
      return sorted.length === 0 ? 0 : Math.round(sorted[Math.floor(sorted.length / 2)]);
    };
    const worst = (kind: JobKind) => Math.round(Math.max(0, ...this.#latencies[kind]));

    return {
      inFlight: this.#running,
      queued: this.#pending.length,
      completed: { ...this.#completed },
      timeouts: { ...this.#timeouts },
      failures: { ...this.#failures },
      medianMs: { decision: median('decision'), monologue: median('monologue') },
      worstMs: { decision: worst('decision'), monologue: worst('monologue') },
    };
  }

  logStats(): void {
    logger.info('inference', this.stats() as unknown as Record<string, unknown>);
  }
}
