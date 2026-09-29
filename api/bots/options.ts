import type { Action } from '../engine/types.ts';
import type { BotView } from './view.ts';

/**
 * The fixed menu of things a bot can do, and the only place a bet size is ever computed.
 *
 * Keys are semantic and stable (`R2` is always "raise big"), not positional. With `"1".."5"`
 * numbering, "3" would mean call in one spot and raise in another depending on which actions
 * happened to be legal - exactly the inconsistency Jeff's README reports measurably changes
 * game results. The wording is fixed for the same reason: it is an interface, not copy.
 *
 * Eight options is comfortably under the model's 26-option ceiling.
 */

export type OptionKey = 'F' | 'X' | 'C' | 'B1' | 'B2' | 'R1' | 'R2' | 'A';

export interface Option {
  key: OptionKey;
  /** Describes the consequence, not the mechanic - the classifier reads it as plain English. */
  text: string;
  action: Action;
}

/**
 * The wording is load-bearing, in both directions.
 *
 * An early version read "Fold: give up the pot and lose nothing more", which sounds like an
 * admission of defeat next to "Call: pay the price and stay in the hand" - the model folded
 * seven-deuce only six percent of the time. The fix overcorrected: "Fold: keep your chips and
 * wait for a better hand" nearly echoed The Rock's own description, and it folded pocket aces.
 * Each line now states its cost as plainly as its upside, and none of them borrows a phrase
 * from any personality.
 *
 * Measured on the sanity set, against Jeff:
 *   two raise sizes, "heavy pressure, a lot of chips at risk"   8/12, confidence 0.08-0.58
 *   one raise size,  "put real money at risk to push them out"  9/12, confidence 0.02-0.79
 *   one raise size,  "build the pot and make them pay"          8/12, confidence collapsed
 *
 * The third is the interesting one: reframing the bet as value rather than risk read better to
 * a human and made the model markedly *less* certain about everything. Do not tune these by
 * ear - run `deno run -A scripts/sanity.ts --source jeff` and keep the number.
 */
const TEXT: Record<OptionKey, string> = {
  F: 'Fold: give up this hand and keep the rest of your chips',
  X: 'Check: stay in for free and see the next card',
  C: 'Call: pay to stay in, and lose those chips if you are behind',
  B1: 'Bet a small amount: cheap to try, easy to give up later',
  B2: 'Bet into the pot: put real money at risk to push them out',
  R1: 'Raise a small amount: pressure without risking much',
  R2: 'Raise: put real money at risk to push them out',
  A: 'Go all in: win the pot now or be knocked out of the tournament',
};

export function buildOptions(view: BotView): Option[] {
  const { legal } = view;
  const options: Option[] = [];

  if (legal.canFold) options.push({ key: 'F', text: TEXT.F, action: { kind: 'fold' } });
  if (legal.canCheck) options.push({ key: 'X', text: TEXT.X, action: { kind: 'check' } });
  if (legal.call) options.push({ key: 'C', text: TEXT.C, action: { kind: 'call' } });

  if (legal.aggress) {
    const { kind, min, max, halfPot, potSized } = legal.aggress;
    const opening = kind === 'bet';

    // Exactly ONE sized aggressive option, never two.
    //
    // Offering a small raise and a large raise puts twice as much probability mass on "be
    // aggressive" as on fold or call, and a classifier splits its answer across the menu it is
    // given. Measured on the sanity set, two sizes had the model raising seven-deuce against a
    // big raise and betting an air-ball flop it could check for free; one size fixed both
    // without touching a word of the state text.
    //
    // The size itself comes from the personality rather than from the model - an aggressive
    // bot bets bigger. That is code deciding how much, which it already does, not code
    // deciding whether.
    const aggression = view.self.personality.aggression;
    const sized = Math.max(min, Math.min(aggression > 0.55 ? potSized : halfPot, max));

    if (sized < max * 0.85) options.push({ key: opening ? 'B2' : 'R2', text: TEXT[opening ? 'B2' : 'R2'], action: { kind, amount: sized } });

    // All-in is only offered when it is a real option. With deep stacks preflop it is a bet of
    // a hundred big blinds into a pot of one and a half, which no player would consider - but
    // the classifier will happily pick it, and it ended a six-player tournament in a single
    // hand. Offering it only when the stack is short or the pot is already big keeps all-ins
    // for the moments they belong to.
    const potAfterCall = view.table.pot + view.table.toCall;
    const shortStacked = view.self.stack <= view.table.bigBlind * 15;
    if (shortStacked || max <= potAfterCall * 3) {
      options.push({ key: 'A', text: TEXT.A, action: { kind, amount: max } });
    }
  }

  return options;
}

export function optionFor(options: readonly Option[], key: string): Option | undefined {
  return options.find((option) => option.key === key);
}
