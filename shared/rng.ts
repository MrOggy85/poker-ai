/**
 * One seeded PRNG for the whole tournament: the shuffle, the mood drift and the action
 * sampling all draw from it. That is what makes a game replayable from its seed - so never
 * reach for Math.random anywhere in api/.
 */
export interface Rng {
  /** Uniform in [0, 1). */
  next(): number;
  /** Uniform integer in [0, max). */
  int(max: number): number;
  /** Fisher-Yates, in place. */
  shuffle<T>(items: T[]): T[];
  /** Current internal state, so a hand log can record and resume it. */
  state(): number;
}

/** mulberry32 - small, fast, and good enough for dealing cards. */
export function makeRng(seed: number): Rng {
  let a = seed >>> 0;

  const next = () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };

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
    state: () => a,
  };
}

/** Turns a human-typed seed ('friday-night') into the number makeRng wants. */
export function seedFromString(text: string): number {
  let h = 2166136261;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}
