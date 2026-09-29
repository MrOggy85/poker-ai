import type { Mood } from '../../shared/events.ts';
import type { Rng } from '../../shared/rng.ts';
import type { Personality } from './personalities.ts';

/**
 * Mood is the "make it interesting" knob. It shifts on what happened, drifts at random, and
 * decays back toward the personality's resting state over a few hands, so a bot that gets
 * stacked plays angry for a while and then settles.
 *
 * It reaches the decision model as a plain phrase in the state text and nothing more - it
 * never reweights probabilities directly. The one exception is sampling temperature, where a
 * tilted bot genuinely is more erratic.
 */

const DRIFTABLE: Mood[] = ['calm', 'confident', 'tilted', 'bored', 'nervous', 'euphoric', 'suspicious'];

export interface HandOutcome {
  stackBefore: number;
  stackAfter: number;
  bigBlind: number;
  /** True if the bot put no money in voluntarily. */
  foldedEarly: boolean;
  /** True if it won a pot at showdown with a hand that was behind. */
  wonWithBluff: boolean;
}

interface Entry {
  mood: Mood;
  /** Hands spent in a mood that is not the resting one. */
  age: number;
  foldStreak: number;
}

export class Moods {
  #entries = new Map<string, Entry>();
  #driftChance: number;
  #decayHands: number;

  constructor(driftChance: number, decayHands: number) {
    this.#driftChance = driftChance;
    this.#decayHands = decayHands;
  }

  moodOf(personality: Personality): Mood {
    return this.#entries.get(personality.id)?.mood ?? personality.defaultMood;
  }

  /**
   * Returns the new mood and why, or null if nothing changed - the caller only announces a
   * change, so an unchanged mood should produce no event.
   */
  update(personality: Personality, outcome: HandOutcome, rng: Rng): { mood: Mood; reason: string } | null {
    const entry = this.#entries.get(personality.id) ??
      { mood: personality.defaultMood, age: 0, foldStreak: 0 };

    const before = entry.mood;
    const swing = outcome.stackAfter - outcome.stackBefore;
    entry.foldStreak = outcome.foldedEarly ? entry.foldStreak + 1 : 0;

    let next: Mood | null = null;
    let reason = '';

    if (outcome.stackAfter > 0 && outcome.stackAfter < outcome.bigBlind * 8) {
      next = 'desperate';
      reason = 'down to a short stack';
    } else if (outcome.wonWithBluff) {
      next = 'euphoric';
      reason = 'got away with a bluff';
    } else if (swing < 0 && Math.abs(swing) > outcome.stackBefore * 0.35) {
      next = 'tilted';
      reason = 'just lost a big pot';
    } else if (swing > outcome.stackBefore * 0.5) {
      next = 'confident';
      reason = 'just won a big pot';
    } else if (entry.foldStreak >= 6) {
      next = 'bored';
      reason = 'has folded six hands in a row';
    } else if (rng.chance(this.#driftChance)) {
      next = rng.pick(DRIFTABLE);
      reason = 'for no particular reason';
    } else if (entry.mood !== personality.defaultMood && entry.age >= this.#decayHands) {
      next = personality.defaultMood;
      reason = 'has settled down';
    }

    if (next === null || next === before) {
      entry.age++;
      this.#entries.set(personality.id, entry);
      return null;
    }

    entry.mood = next;
    entry.age = 0;
    this.#entries.set(personality.id, entry);
    return { mood: next, reason };
  }

  reset(): void {
    this.#entries.clear();
  }
}

/**
 * Mood's one mechanical effect: an agitated bot samples more erratically. Everything else a
 * mood does happens through the words it puts in the state text.
 */
export function temperatureFor(personality: Personality, mood: Mood): number {
  const multiplier: Record<Mood, number> = {
    tilted: 1.5,
    desperate: 1.4,
    euphoric: 1.3,
    bored: 1.2,
    confident: 1.05,
    calm: 0.9,
    suspicious: 0.95,
    nervous: 0.85,
  };
  return Math.max(0.05, Math.min(2, personality.samplingTemperature * multiplier[mood]));
}
