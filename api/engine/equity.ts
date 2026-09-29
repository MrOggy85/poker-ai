import { type Card, DECK_SIZE } from '../../shared/cards.ts';
import type { Rng } from '../../shared/rng.ts';
import { evaluate } from './evaluator.ts';

/**
 * All of the poker maths in this project lives here. Nothing else estimates a win chance, and
 * nothing anywhere computes one from scratch.
 *
 * Opponents are modelled as holding random cards, which is deliberately naive: a bot's read on
 * an opponent belongs in its notes and its state text, not smuggled into the arithmetic. The
 * numbers are turned into words before a model ever sees them (see bots/words.ts), and the
 * word buckets are 20 points wide - so a few hundred samples is not a compromise, it is the
 * right precision for what it feeds.
 */

export interface Equity {
  /** Probability of winning the pot outright. */
  win: number;
  /** Probability of splitting it. */
  tie: number;
  /** Expected share of the pot - the number the word buckets use. */
  share: number;
}

export function estimateEquity(
  hole: readonly [Card, Card],
  board: readonly Card[],
  opponents: number,
  samples: number,
  rng: Rng,
): Equity {
  if (opponents < 1) return { win: 1, tie: 0, share: 1 };

  const known = new Uint8Array(DECK_SIZE);
  known[hole[0]] = 1;
  known[hole[1]] = 1;
  for (const card of board) known[card] = 1;

  const deck: Card[] = [];
  for (let card = 0; card < DECK_SIZE; card++) {
    if (!known[card]) deck.push(card);
  }

  const boardToCome = 5 - board.length;
  const needed = opponents * 2 + boardToCome;

  // Reused across samples so the hot loop allocates nothing.
  const heroCards: Card[] = [hole[0], hole[1], ...board, 0, 0, 0, 0, 0].slice(0, 7);
  const villainCards: Card[] = new Array(7).fill(0);

  let wins = 0;
  let ties = 0;
  let share = 0;

  for (let sample = 0; sample < samples; sample++) {
    // Partial Fisher-Yates: only the cards actually dealt get shuffled into place.
    for (let i = 0; i < needed; i++) {
      const j = i + rng.int(deck.length - i);
      const tmp = deck[i];
      deck[i] = deck[j];
      deck[j] = tmp;
    }

    for (let i = 0; i < boardToCome; i++) heroCards[board.length + 2 + i] = deck[i];
    const heroScore = evaluate(heroCards);

    let best = heroScore;
    let tiedWith = 0;

    for (let opponent = 0; opponent < opponents; opponent++) {
      const at = boardToCome + opponent * 2;
      villainCards[0] = deck[at];
      villainCards[1] = deck[at + 1];
      for (let i = 0; i < board.length; i++) villainCards[2 + i] = board[i];
      for (let i = 0; i < boardToCome; i++) villainCards[2 + board.length + i] = deck[i];

      const villainScore = evaluate(villainCards);
      if (villainScore > best) {
        best = villainScore;
        tiedWith = 0;
      } else if (villainScore === best) {
        tiedWith++;
      }
    }

    if (best > heroScore) continue;
    if (tiedWith === 0) {
      wins++;
      share += 1;
    } else {
      ties++;
      share += 1 / (tiedWith + 1);
    }
  }

  return { win: wins / samples, tie: ties / samples, share: share / samples };
}

/**
 * The fraction of the pot you have to put in to call - `toCall / (pot + toCall)`. Beating this
 * number with your equity is what makes a call correct, which is why it is worded alongside
 * hand strength rather than left as a bare ratio.
 */
export function potOdds(toCall: number, pot: number): number {
  if (toCall <= 0) return 0;
  return toCall / (pot + toCall);
}
