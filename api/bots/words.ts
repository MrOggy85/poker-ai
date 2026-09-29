import type { Card } from '../../shared/cards.ts';
import { rankIndex, suitIndex } from '../../shared/cards.ts';
import type { Street } from '../../shared/events.ts';
import type { BotView } from './view.ts';

/**
 * Numbers into words.
 *
 * The decision model is a classifier, not a calculator: it cannot compare 1,325 against 8,400
 * usefully, and digits cost tokens while adding variance. So **no raw number ever reaches it**
 * except the bot's own hole cards. Pot, stack, bet and equity all arrive as phrases.
 *
 * The phrasing is fixed here, in one place, because the Jeff README reports that inconsistent
 * wording between turns changes game outcomes measurably. Rewriting a bucket rewrites every
 * bot's behaviour, so treat these strings as an interface.
 */

/**
 * Hand strength relative to an average hand at this table, not the raw win chance.
 *
 * Absolute thresholds are wrong multiway and it is not a subtle error: six-handed, every hand
 * averages a one-in-six share, so aces and seven-deuce both came out as "very weak, almost
 * certainly behind". The model was told every hand was garbage and had nothing to work with -
 * it answered with a near-uniform distribution. `live` includes the reader.
 */
export function equityWords(share: number, live: number): string {
  const strength = share * Math.max(2, live);
  if (strength >= 2.0) return 'very strong, almost certainly ahead';
  if (strength >= 1.45) return 'strong, probably ahead';
  if (strength >= 1.05) return 'playable, about average for this table';
  if (strength >= 0.7) return 'weak, probably behind';
  return 'very weak, almost certainly behind';
}

export function potOddsWords(toCall: number, pot: number): string {
  if (toCall <= 0) return 'It costs nothing to stay in';
  const price = toCall / (pot + toCall);
  if (price < 0.1) return 'Calling is almost free';
  if (price < 0.25) return 'Calling is cheap compared to the pot';
  if (price < 0.4) return 'Calling is a fair price';
  if (price < 0.6) return 'Calling is expensive';
  return 'Calling is very expensive';
}

export function stackWords(stack: number, bigBlind: number): string {
  const blinds = stack / bigBlind;
  if (blinds < 10) return 'you are short stacked and close to being knocked out';
  if (blinds < 25) return 'your stack is below average';
  if (blinds < 60) return 'your stack is comfortable';
  return 'you have one of the big stacks';
}

export function positionWords(view: BotView): string {
  const actingAfter = view.table.opponents.filter((opponent) => opponent.status === 'active').length;
  if (view.table.opponents.some((opponent) => opponent.isButton)) {
    if (actingAfter === 0) return 'you act last';
    if (actingAfter <= 1) return 'you act late';
    return 'you act early';
  }
  return 'you are on the button and act last';
}

export function streetWords(street: Street): string {
  switch (street) {
    case 'preflop':
      return 'Nothing has been dealt yet.';
    case 'flop':
      return 'The flop is out.';
    case 'turn':
      return 'The turn is out.';
    case 'river':
      return 'Every card is out.';
    case 'showdown':
      return 'The hand is over.';
  }
}

/**
 * Board texture only - never an evaluation of how it hits anyone's hand. Whether the board is
 * dangerous is the model's job; what is on it is a fact.
 */
export function boardWords(board: readonly Card[]): string {
  if (board.length === 0) return '';

  const parts: string[] = [];
  const suits = [0, 0, 0, 0];
  const ranks = new Array(13).fill(0);
  for (const card of board) {
    suits[suitIndex(card)]++;
    ranks[rankIndex(card)]++;
  }

  const flushiest = Math.max(...suits);
  if (flushiest >= 3) parts.push(flushiest >= 4 ? 'four cards of one suit are showing' : 'three cards of one suit are showing');

  if (ranks.some((count) => count >= 3)) parts.push('the board is tripled');
  else if (ranks.some((count) => count === 2)) parts.push('the board is paired');

  const present = ranks.map((count, rank) => (count > 0 ? rank : -1)).filter((rank) => rank >= 0);
  let run = 1;
  let longest = 1;
  for (let i = 1; i < present.length; i++) {
    run = present[i] === present[i - 1] + 1 ? run + 1 : 1;
    longest = Math.max(longest, run);
  }
  if (longest >= 3) parts.push('there are straight cards on the board');

  if (parts.length === 0) return 'The board looks unconnected.';
  return `${parts.join(', ')}.`.replace(/^./, (c) => c.toUpperCase());
}

/** How many opponents are still contesting the pot, in words. */
export function fieldWords(live: number): string {
  if (live <= 2) return 'You are heads up';
  if (live === 3) return 'Two opponents are still in';
  return `${live - 1} opponents are still in the hand`;
}
