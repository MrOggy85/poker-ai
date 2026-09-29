import type { Card } from '../../shared/cards.ts';

/**
 * Seven-card hand ranking, collapsed into one comparable integer:
 *
 *     (category << 20) | r0 << 16 | r1 << 12 | r2 << 8 | r3 << 4 | r4
 *
 * so a plain `a > b` decides any two hands. The five rank nibbles are the significant ranks
 * in descending importance - for a straight or a straight flush only the top card matters, so
 * the rest are zero.
 *
 * This does not enumerate the 21 five-card subsets: it reads the rank mask and the suit masks
 * directly. `evaluator_test.ts` keeps the brute-force 21-subset version as a reference oracle
 * and checks the two agree over tens of thousands of random hands - that comparison is the
 * only real proof either one is right.
 */

export const HIGH_CARD = 0;
export const PAIR = 1;
export const TWO_PAIR = 2;
export const TRIPS = 3;
export const STRAIGHT = 4;
export const FLUSH = 5;
export const FULL_HOUSE = 6;
export const QUADS = 7;
export const STRAIGHT_FLUSH = 8;

export const CATEGORY_NAMES = [
  'high card',
  'a pair',
  'two pair',
  'three of a kind',
  'a straight',
  'a flush',
  'a full house',
  'four of a kind',
  'a straight flush',
];

function score(category: number, ranks: readonly number[]): number {
  return (category << 20) | (ranks[0] << 16) | (ranks[1] << 12) | (ranks[2] << 8) | (ranks[3] << 4) | ranks[4];
}

export function categoryOf(handScore: number): number {
  return handScore >> 20;
}

export function describe(handScore: number): string {
  return CATEGORY_NAMES[categoryOf(handScore)];
}

/**
 * Top rank index of a five-card run in a 13-bit rank mask, or -1.
 * The mask is re-based so bit 0 is the ace playing low, which is what makes the wheel
 * (A-2-3-4-5) fall out of the same shift-and test as every other straight.
 */
function straightHigh(rankMask: number): number {
  const m = (rankMask << 1) | ((rankMask >> 12) & 1);
  const runs = m & (m >> 1) & (m >> 2) & (m >> 3) & (m >> 4);
  if (runs === 0) return -1;
  return 31 - Math.clz32(runs) + 3;
}

/** The n highest set bits of a rank mask, descending, zero-padded to n. */
function topN(rankMask: number, n: number): number[] {
  const out: number[] = [];
  for (let r = 12; r >= 0 && out.length < n; r--) {
    if (rankMask & (1 << r)) out.push(r);
  }
  while (out.length < n) out.push(0);
  return out;
}

export function evaluate(cards: readonly Card[]): number {
  const rankCount = [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0];
  const suitMask = [0, 0, 0, 0];
  const suitCount = [0, 0, 0, 0];
  let rankMask = 0;

  for (const card of cards) {
    const rank = card >> 2;
    const suit = card & 3;
    rankCount[rank]++;
    suitCount[suit]++;
    suitMask[suit] |= 1 << rank;
    rankMask |= 1 << rank;
  }

  // Seven cards can only ever make one flush suit, so the first match is the only match.
  let flushSuit = -1;
  for (let suit = 0; suit < 4; suit++) {
    if (suitCount[suit] >= 5) flushSuit = suit;
  }

  if (flushSuit >= 0) {
    const high = straightHigh(suitMask[flushSuit]);
    if (high >= 0) return score(STRAIGHT_FLUSH, [high, 0, 0, 0, 0]);
  }

  const quads: number[] = [];
  const trips: number[] = [];
  const pairs: number[] = [];
  for (let rank = 12; rank >= 0; rank--) {
    if (rankCount[rank] === 4) quads.push(rank);
    else if (rankCount[rank] === 3) trips.push(rank);
    else if (rankCount[rank] === 2) pairs.push(rank);
  }

  if (quads.length > 0) {
    const kicker = topN(rankMask & ~(1 << quads[0]), 1)[0];
    return score(QUADS, [quads[0], kicker, 0, 0, 0]);
  }

  // Seven cards can hold two trips; the lower one plays as the pair.
  if (trips.length >= 2) return score(FULL_HOUSE, [trips[0], trips[1], 0, 0, 0]);
  if (trips.length === 1 && pairs.length > 0) return score(FULL_HOUSE, [trips[0], pairs[0], 0, 0, 0]);

  if (flushSuit >= 0) return score(FLUSH, topN(suitMask[flushSuit], 5));

  const straight = straightHigh(rankMask);
  if (straight >= 0) return score(STRAIGHT, [straight, 0, 0, 0, 0]);

  if (trips.length === 1) {
    const kickers = topN(rankMask & ~(1 << trips[0]), 2);
    return score(TRIPS, [trips[0], kickers[0], kickers[1], 0, 0]);
  }

  if (pairs.length >= 2) {
    // With three pairs the lowest is not part of the hand, but its rank still competes to be
    // the kicker, so mask out only the two that play.
    const kicker = topN(rankMask & ~(1 << pairs[0]) & ~(1 << pairs[1]), 1)[0];
    return score(TWO_PAIR, [pairs[0], pairs[1], kicker, 0, 0]);
  }

  if (pairs.length === 1) {
    const kickers = topN(rankMask & ~(1 << pairs[0]), 3);
    return score(PAIR, [pairs[0], kickers[0], kickers[1], kickers[2], 0]);
  }

  return score(HIGH_CARD, topN(rankMask, 5));
}
