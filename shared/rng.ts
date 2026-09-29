/**
 * Seeded randomness for the whole tournament: the shuffle, the equity Monte Carlo, the mood
 * drift and the action sampling all draw from here. Nothing in api/ may call Math.random, or
 * games stop replaying from their seed.
 *
 * Streams are *derived and named*, never one global sequence. The deck for hand 12 comes from
 * `deck:h12`, an equity estimate from `equity:p3:h12:river`, a sampled action from
 * `sample:p3:h12:flop:0`. That independence is what lets you change the equity sample count,
 * or add a new randomised feature, without reshuffling every deck in every historical seed -
 * and it is why starting a bot's decision early (pacing lookahead) cannot change the game.
 */
export interface Rng {
  /** Uniform in [0, 1). */
  next(): number;
  /** Uniform integer in [0, max). */
  int(max: number): number;
  /** Fisher-Yates, in place. */
  shuffle<T>(items: T[]): T[];
  /** One item, uniformly. */
  pick<T>(items: readonly T[]): T;
  /** True with probability p. */
  chance(p: number): boolean;
}

/** FNV-1a. Also used on its own to turn a human-typed seed into a number. */
export function hashString(text: string): number {
  let h = 2166136261;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

/** mulberry32 - small, fast, and far better than a card game needs. */
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function build(next: () => number): Rng {
  return {
    next,
    int: (max: number) => Math.floor(next() * max),
    shuffle<T>(items: T[]): T[] {
      for (let i = items.length - 1; i > 0; i--) {
        const j = Math.floor(next() * (i + 1));
        [items[i], items[j]] = [items[j], items[i]];
      }
      return items;
    },
    pick<T>(items: readonly T[]): T {
      return items[Math.floor(next() * items.length)];
    },
    chance: (p: number) => next() < p,
  };
}

/**
 * The one way to get randomness. `label` names the purpose - see the module comment for the
 * naming scheme. Two calls with the same (seed, label) produce the same sequence, which is
 * the point: callers get a fresh stream per purpose rather than sharing one.
 */
export function makeRng(seed: string, label: string): Rng {
  return build(mulberry32(hashString(`${seed}/${label}`)));
}

/** For tests and micro-benchmarks that only need *some* randomness. */
export function rngFromNumber(seed: number): Rng {
  return build(mulberry32(seed));
}
