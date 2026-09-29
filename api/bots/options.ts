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

const TEXT: Record<OptionKey, string> = {
  F: 'Fold: give up the pot and lose nothing more',
  X: 'Check: stay in for free and see what happens',
  C: 'Call: pay the price and stay in the hand',
  B1: 'Bet small: a cheap probe that is easy to give up',
  B2: 'Bet the size of the pot: real pressure',
  R1: 'Raise small: pressure without risking much',
  R2: 'Raise big: heavy pressure, many chips at risk',
  A: 'All in: risk every chip to win the pot now',
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
    const small = Math.max(min, Math.min(halfPot, max));
    const large = Math.max(min, Math.min(potSized, max));

    const push = (key: OptionKey, amount: number) => options.push({ key, text: TEXT[key], action: { kind, amount } });

    // Two sizes and a shove, deduplicated. Splitting probability mass across options that mean
    // the same thing distorts the distribution and is invisible in the logs, so near-duplicates
    // are dropped rather than offered.
    const shoveish = (amount: number) => amount >= max * 0.85;

    if (!shoveish(small)) push(opening ? 'B1' : 'R1', small);
    if (large > small && !shoveish(large)) push(opening ? 'B2' : 'R2', large);
    options.push({ key: 'A', text: TEXT.A, action: { kind, amount: max } });
  }

  return options;
}

export function optionFor(options: readonly Option[], key: string): Option | undefined {
  return options.find((option) => option.key === key);
}
