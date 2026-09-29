import { assert, assertEquals } from 'jsr:@std/assert@1';
import { cardFromString, type Card, DECK_SIZE } from '../../shared/cards.ts';
import { rngFromNumber } from '../../shared/rng.ts';
import {
  categoryOf,
  evaluate,
  FLUSH,
  FULL_HOUSE,
  HIGH_CARD,
  PAIR,
  QUADS,
  STRAIGHT,
  STRAIGHT_FLUSH,
  TRIPS,
  TWO_PAIR,
} from './evaluator.ts';

const hand = (text: string): Card[] => text.split(' ').map(cardFromString);

// --- the reference oracle --------------------------------------------------------------
// Deliberately the slow, obvious implementation: score all 21 five-card subsets and keep the
// best. It exists to prove the real evaluator right, so it must stay boring enough to read in
// one sitting. Its encoding matches evaluate()'s exactly so the two can be compared directly.

function scoreFive(cards: readonly Card[]): number {
  const rankCount = new Array(13).fill(0);
  let rankMask = 0;
  let suits = 0;
  for (const card of cards) {
    rankCount[card >> 2]++;
    rankMask |= 1 << (card >> 2);
    suits |= 1 << (card & 3);
  }
  const isFlush = (suits & (suits - 1)) === 0;

  const m = (rankMask << 1) | ((rankMask >> 12) & 1);
  const runs = m & (m >> 1) & (m >> 2) & (m >> 3) & (m >> 4);
  const straightTop = runs === 0 ? -1 : 31 - Math.clz32(runs) + 3;

  const byCount: number[][] = [[], [], [], [], []];
  for (let rank = 12; rank >= 0; rank--) byCount[rankCount[rank]].push(rank);

  const pack = (category: number, ranks: number[]) => {
    const r = [...ranks, 0, 0, 0, 0, 0].slice(0, 5);
    return (category << 20) | (r[0] << 16) | (r[1] << 12) | (r[2] << 8) | (r[3] << 4) | r[4];
  };

  if (isFlush && straightTop >= 0) return pack(STRAIGHT_FLUSH, [straightTop]);
  if (byCount[4].length) return pack(QUADS, [byCount[4][0], byCount[1][0]]);
  if (byCount[3].length && byCount[2].length) return pack(FULL_HOUSE, [byCount[3][0], byCount[2][0]]);
  if (isFlush) return pack(FLUSH, byCount[1]);
  if (straightTop >= 0) return pack(STRAIGHT, [straightTop]);
  if (byCount[3].length) return pack(TRIPS, [byCount[3][0], ...byCount[1]]);
  if (byCount[2].length === 2) return pack(TWO_PAIR, [byCount[2][0], byCount[2][1], byCount[1][0]]);
  if (byCount[2].length === 1) return pack(PAIR, [byCount[2][0], ...byCount[1]]);
  return pack(HIGH_CARD, byCount[1]);
}

function referenceEvaluate(cards: readonly Card[]): number {
  let best = 0;
  for (let a = 0; a < cards.length; a++) {
    for (let b = a + 1; b < cards.length; b++) {
      for (let c = b + 1; c < cards.length; c++) {
        for (let d = c + 1; d < cards.length; d++) {
          for (let e = d + 1; e < cards.length; e++) {
            const value = scoreFive([cards[a], cards[b], cards[c], cards[d], cards[e]]);
            if (value > best) best = value;
          }
        }
      }
    }
  }
  return best;
}

// --- categories ------------------------------------------------------------------------

Deno.test('recognises each category from seven cards', () => {
  const cases: [string, number][] = [
    ['Ah Kh Qh Jh Th 2c 3d', STRAIGHT_FLUSH],
    ['5h 4h 3h 2h Ah Kc Qd', STRAIGHT_FLUSH], // the steel wheel
    ['9c 9d 9h 9s Kc 2d 3h', QUADS],
    ['Kc Kd Ks 7h 7d 2c 3h', FULL_HOUSE],
    ['Ac Tc 8c 5c 2c Kd Qh', FLUSH],
    ['9c 8d 7h 6s 5c Ad Kh', STRAIGHT],
    ['Ah 2d 3c 4s 5h Kd Qc', STRAIGHT], // the wheel, ace playing low
    ['Qc Qd Qh 8s 5c 3d 2h', TRIPS],
    ['Jc Jd 6h 6s Kc 3d 2h', TWO_PAIR],
    ['Ac Ad Kh 8s 5c 3d 2h', PAIR],
    ['Ac Kd 9h 7s 5c 3d 2h', HIGH_CARD],
  ];
  for (const [text, expected] of cases) {
    assertEquals(categoryOf(evaluate(hand(text))), expected, text);
  }
});

Deno.test('a wheel straight is the lowest straight', () => {
  assert(evaluate(hand('Ah 2d 3c 4s 5h Kd Qc')) < evaluate(hand('2h 3d 4c 5s 6h Kd Qc')));
});

Deno.test('the third pair loses to a higher kicker', () => {
  // Two pair kings and jacks; the spare ace outranks the spare nine even though the nine is
  // itself paired. This is the case a naive "mask out every pair" kicker gets wrong.
  const withAce = evaluate(hand('Kc Kd Jh Js 9c 9d Ah'));
  const withEight = evaluate(hand('Kc Kd Jh Js 9c 9d 8h'));
  assert(withAce > withEight);
});

Deno.test('two trips make a full house from the higher one', () => {
  assertEquals(categoryOf(evaluate(hand('Kc Kd Ks 7h 7d 7s 2c'))), FULL_HOUSE);
  assert(evaluate(hand('Kc Kd Ks 7h 7d 7s 2c')) > evaluate(hand('Qc Qd Qs Jh Jd Js 2c')));
});

Deno.test('a flush beats a straight and loses to a full house', () => {
  assert(evaluate(hand('Ac Tc 8c 5c 2c Kd Qh')) > evaluate(hand('9c 8d 7h 6s 5c Ad Kh')));
  assert(evaluate(hand('Ac Tc 8c 5c 2c Kd Qh')) < evaluate(hand('Kc Kd Ks 7h 7d 2c 3h')));
});

// --- the property test that actually proves it ------------------------------------------

Deno.test('agrees with the brute-force reference on random hands', () => {
  const rng = rngFromNumber(20260929);
  const deck = Array.from({ length: DECK_SIZE }, (_, i) => i);

  for (let trial = 0; trial < 20_000; trial++) {
    rng.shuffle(deck);
    const cards = deck.slice(0, 7);
    const actual = evaluate(cards);
    const expected = referenceEvaluate(cards);
    if (actual !== expected) {
      throw new Error(
        `hand ${cards.map((c) => '23456789TJQKA'[c >> 2] + 'cdhs'[c & 3]).join(' ')}: ` +
          `got ${actual.toString(16)}, reference ${expected.toString(16)}`,
      );
    }
  }
});
