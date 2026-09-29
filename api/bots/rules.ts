import type { Rng } from '../../shared/rng.ts';
import { potOdds } from '../engine/equity.ts';
import { buildOptions, type Option, type OptionKey } from './options.ts';
import type { BotView } from './view.ts';

/**
 * Is this a decision at all?
 *
 * Asking the classifier costs about four seconds of three cores, so it is worth not asking when
 * no personality would answer differently. The two cases here are genuinely not decisions: a
 * hand with essentially no chance facing a real price, and a free look with a hand that is
 * almost certain to be best. Everything with any judgement in it - marginal calls, bluffs,
 * slow-plays, thin value - still goes to the model, because that is where the character comes
 * from.
 *
 * Deliberately conservative. The temptation is to skip "check with nothing", which is most of
 * the remaining calls, but checking with nothing is exactly where The Maniac bluffs and The
 * Rock does not, and taking it away would flatten the table.
 */
export function isObvious(view: BotView): boolean {
  const share = view.equity.share;
  const price = potOdds(view.table.toCall, view.table.pot);
  const { bluffiness } = view.self.personality;

  if (view.table.toCall > 0) {
    // Facing a bet with a hand that cannot justify half the price. Nobody calls this.
    return share < price * 0.5;
  }

  // A free card with a hand that is almost certainly already best, and something to bet with.
  if (share > 0.93 && view.legal.aggress !== null) return true;

  // Checking behind with a weak hand, for a character who does not bluff. For The Maniac or
  // The Showman this is exactly where the interesting decision is, so they are excluded by
  // the bluffiness test rather than by the hand.
  const strength = share * Math.max(2, view.table.live);
  return strength < 0.75 && bluffiness < 0.2;
}

/**
 * Poker without a model.
 *
 * This is both the fallback when Jeff is unreachable and a first-class way to run the whole
 * game, so it has to play recognisably and keep the six personalities visibly distinct. It
 * decides from equity, the price of a call, and the three numeric traits on the personality -
 * nothing else. It is deliberately simple: the interesting behaviour is supposed to come from
 * the classifier, and a rule bot good enough to be interesting would make it impossible to
 * tell whether Jeff was contributing anything.
 */
export function ruleDecision(view: BotView, rng: Rng): { key: OptionKey; option: Option } {
  const options = buildOptions(view);
  const pick = (key: OptionKey): { key: OptionKey; option: Option } | null => {
    const option = options.find((candidate) => candidate.key === key);
    return option ? { key, option } : null;
  };
  const first = (...keys: OptionKey[]) => {
    for (const key of keys) {
      const found = pick(key);
      if (found) return found;
    }
    // Something is always legal: check if it is free, otherwise fold.
    return pick('X') ?? pick('F') ?? pick('C') ?? { key: options[0].key, option: options[0] };
  };

  const { looseness, aggression, bluffiness } = view.self.personality;
  const share = view.equity.share;
  const price = potOdds(view.table.toCall, view.table.pot);
  const desperate = view.self.stack < view.table.bigBlind * 8;

  // Strength relative to an average hand at this table, not the raw win chance. Six-handed,
  // every hand averages a 1-in-6 share, so an absolute threshold would fold everything
  // preflop and then call everything heads up. This is the number that actually separates the
  // personalities: an average hand scores 1.0 whatever the table size.
  const fairShare = 1 / Math.max(2, view.table.live);
  const strength = share / fairShare;

  // A short stack has to gamble: the blinds will eat it otherwise.
  if (desperate && strength > 1.15) return first('A', 'R2', 'C', 'X');

  const continueAt = 1.4 - looseness * 0.75;
  const raiseAt = 2.0 - aggression * 0.85;

  if (strength >= raiseAt && rng.chance(0.4 + aggression * 0.55)) {
    if (share > 0.8 && rng.chance(aggression * 0.45)) return first('A', 'R2', 'B2', 'C', 'X');
    return first(rng.chance(0.5 + aggression * 0.3) ? 'R2' : 'R1', 'B2', 'B1', 'C', 'X');
  }

  if (view.table.toCall === 0) {
    // Nothing to call. Betting with nothing is the only bluff this bot knows, and it only
    // tries it when nobody has shown strength this street.
    const quiet = view.table.recent.every((action) => action.kind === 'check');
    if (quiet && strength < 0.9 && rng.chance(bluffiness)) return first('B1', 'B2', 'X');
    if (strength >= 1.2 && rng.chance(aggression)) return first('B1', 'B2', 'X');
    return first('X');
  }

  // Never call a price the hand cannot possibly justify, however loose the bot is.
  if (share < price * 0.55) return first('F', 'X');

  if (strength >= continueAt) return first('C', 'X');

  // A cheap look with something live is worth it to almost anyone.
  if (price < 0.2 && strength > 0.7 && rng.chance(looseness)) return first('C', 'X');

  return first('F', 'X');
}
