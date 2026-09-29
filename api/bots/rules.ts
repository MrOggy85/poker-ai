import type { Rng } from '../../shared/rng.ts';
import { potOdds } from '../engine/equity.ts';
import { buildOptions, type Option, type OptionKey } from './options.ts';
import type { BotView } from './view.ts';

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
