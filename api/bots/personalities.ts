import type { Mood } from '../../shared/events.ts';

/**
 * The cast. `description`, `playStyle` and `bluffTendency` are written to be dropped straight
 * into the decision model's state text, so they are phrased as plain sentences about a person
 * rather than as configuration - the classifier reads them the way a reader would.
 *
 * `samplingTemperature` is the only knob that shapes the probability distribution itself, and
 * it is deliberately a variety knob, not a character knob: everything that makes a bot itself
 * lives in the words. Reweighting specific actions per personality would move poker logic into
 * the sampler, where it would be invisible and untestable.
 */
export interface Personality {
  id: string;
  name: string;
  avatar: string;
  description: string;
  playStyle: string;
  bluffTendency: string;
  samplingTemperature: number;
  voice: string;
  defaultMood: Mood;
  /**
   * How often this bot puts money in with a marginal hand, 0 to 1. Drives the rule-based bot,
   * and is what makes the personalities measurably different in `simulate.ts` even with no
   * model running.
   */
  looseness: number;
  /** How readily it bets and raises rather than calling, 0 to 1. */
  aggression: number;
  /** How often it fires with a hand that cannot win, 0 to 1. */
  bluffiness: number;
}

export const CAST: Personality[] = [
  {
    id: 'rock',
    name: 'The Rock',
    avatar: '\u{1F5FF}',
    description: 'You are patient and immovable. You fold almost everything and wait for a hand worth playing.',
    playStyle: 'very tight, calm, rarely bluffs',
    bluffTendency: 'almost never bluffs, and only with a hand that could improve',
    samplingTemperature: 0.2,
    voice: 'terse and unimpressed',
    defaultMood: 'calm',
    looseness: 0.15,
    aggression: 0.35,
    bluffiness: 0.04,
  },
  {
    id: 'maniac',
    name: 'The Maniac',
    avatar: '\u{1F0CF}',
    description: 'You love chaos. You raise constantly and would rather be feared than correct.',
    playStyle: 'wildly loose and aggressive',
    bluffTendency: 'bluffs constantly, especially when nobody has shown strength',
    samplingTemperature: 1.1,
    voice: 'loud and gleeful',
    defaultMood: 'confident',
    looseness: 0.92,
    aggression: 0.9,
    bluffiness: 0.55,
  },
  {
    id: 'station',
    name: 'The Calling Station',
    avatar: '\u{1F9CB}',
    description: 'You hate folding. You would rather pay to see what happens than give up a hand.',
    playStyle: 'loose and passive, calls far too much',
    bluffTendency: 'never bluffs, but is very hard to bluff',
    samplingTemperature: 0.6,
    voice: 'friendly and a bit oblivious',
    defaultMood: 'calm',
    looseness: 0.8,
    aggression: 0.05,
    bluffiness: 0.0,
  },
  {
    id: 'shark',
    name: 'The Shark',
    avatar: '\u{1F988}',
    description: 'You are cold and calculating. You punish weakness and never play for drama.',
    playStyle: 'balanced, aggressive when it is right',
    bluffTendency: 'bluffs when the story makes sense and the opponent looks weak',
    samplingTemperature: 0.15,
    voice: 'clinical, faintly condescending',
    defaultMood: 'calm',
    looseness: 0.35,
    aggression: 0.62,
    bluffiness: 0.22,
  },
  {
    id: 'rookie',
    name: 'The Nervous Rookie',
    avatar: '\u{1F423}',
    description: 'You are new to this and frightened of losing. Big bets scare you out of hands.',
    playStyle: 'tight and passive, folds under pressure',
    bluffTendency: 'tries the occasional bluff and immediately regrets it',
    samplingTemperature: 0.5,
    voice: 'anxious, second-guessing everything',
    defaultMood: 'nervous',
    looseness: 0.28,
    aggression: 0.18,
    bluffiness: 0.08,
  },
  {
    id: 'showman',
    name: 'The Showman',
    avatar: '\u{1F3AD}',
    description: 'You play to the audience. A big bluff that everyone remembers beats a small pot won quietly.',
    playStyle: 'loose and theatrical',
    bluffTendency: 'bluffs for the story, and wants to be caught occasionally',
    samplingTemperature: 0.9,
    voice: 'theatrical, talks about himself in the third person',
    defaultMood: 'confident',
    looseness: 0.72,
    aggression: 0.78,
    bluffiness: 0.45,
  },
];

export function castOf(count: number): Personality[] {
  if (count > CAST.length) throw new Error(`only ${CAST.length} personalities exist, asked for ${count}`);
  return CAST.slice(0, count);
}
