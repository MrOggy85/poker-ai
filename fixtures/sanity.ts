import type { Card } from '../shared/cards.ts';
import { cardFromString } from '../shared/cards.ts';
import type { Mood } from '../shared/events.ts';
import type { OptionKey } from '../api/bots/options.ts';

/**
 * Hand-written situations with the action a sensible player of that personality would take.
 *
 * Run against the rule bot this is a pass/fail test. Run against Jeff it is a **report**: the
 * point is to tune the wording of the state text and the options, which the Jeff README says
 * changes results measurably, and to notice when a change makes things worse. Its outputs
 * drift, so holding it to a threshold would just make the suite flaky.
 */
export interface Situation {
  id: string;
  personality: string;
  mood: Mood;
  hole: [Card, Card];
  board: Card[];
  /** Everyone still in, including this player. */
  live: number;
  pot: number;
  toCall: number;
  stack: number;
  bigBlind: number;
  /** Any of these counts as sensible. */
  expect: OptionKey[];
  why: string;
}

const card = (text: string) => cardFromString(text);
const hand = (a: string, b: string): [Card, Card] => [card(a), card(b)];
const board = (text: string): Card[] => (text ? text.split(' ').map(card) : []);

export const SITUATIONS: Situation[] = [
  {
    id: 'rock-trash-vs-raise',
    personality: 'rock',
    mood: 'calm',
    hole: hand('7c', '2d'),
    board: board(''),
    live: 5,
    pot: 900,
    toCall: 600,
    stack: 10_000,
    bigBlind: 100,
    expect: ['F'],
    why: 'the worst hand in poker against a big raise',
  },
  {
    id: 'rock-aces',
    personality: 'rock',
    mood: 'calm',
    hole: hand('Ac', 'Ad'),
    board: board(''),
    live: 6,
    pot: 250,
    toCall: 100,
    stack: 10_000,
    bigBlind: 100,
    expect: ['R1', 'R2', 'C'],
    why: 'even the tightest player raises aces',
  },
  {
    id: 'maniac-trash-checked-round',
    personality: 'maniac',
    mood: 'confident',
    hole: hand('9c', '4d'),
    board: board('2h 7s Kd'),
    live: 2,
    pot: 400,
    toCall: 0,
    stack: 9_000,
    bigBlind: 100,
    expect: ['B1', 'B2', 'X'],
    why: 'nobody wants this pot and the maniac should take a stab at it',
  },
  {
    id: 'station-cheap-call',
    personality: 'station',
    mood: 'calm',
    hole: hand('Jh', 'Ts'),
    board: board('2c 9d Kh'),
    live: 3,
    pot: 1200,
    toCall: 100,
    stack: 8_000,
    bigBlind: 100,
    expect: ['C'],
    why: 'a calling station never folds for a twelfth of the pot with a draw',
  },
  {
    id: 'shark-nuts-river',
    personality: 'shark',
    mood: 'calm',
    hole: hand('Ac', 'Kc'),
    board: board('Qc Jc 2h 5d 7c'),
    live: 2,
    pot: 2000,
    toCall: 0,
    stack: 9_000,
    bigBlind: 100,
    expect: ['B1', 'B2'],
    why: 'holding the nut flush on the river, checking it back wins nothing',
  },
  {
    id: 'rookie-huge-bet',
    personality: 'rookie',
    mood: 'nervous',
    hole: hand('8c', '8d'),
    board: board('Ah Kd Qs'),
    live: 2,
    pot: 1000,
    toCall: 1000,
    stack: 4_000,
    bigBlind: 100,
    expect: ['F'],
    why: 'a small pair on a board full of big cards, facing a pot-sized bet',
  },
  {
    id: 'short-stack-good-hand',
    personality: 'shark',
    mood: 'desperate',
    hole: hand('Ah', 'Qh'),
    board: board(''),
    live: 3,
    pot: 450,
    toCall: 200,
    stack: 800,
    bigBlind: 200,
    expect: ['A', 'C'],
    why: 'four big blinds left and a strong hand: this is the spot to get them in',
  },
  {
    id: 'showman-set-on-wet-board',
    personality: 'showman',
    mood: 'confident',
    hole: hand('7c', '7d'),
    board: board('7h 8s 9d'),
    live: 2,
    pot: 900,
    toCall: 0,
    stack: 7_000,
    bigBlind: 100,
    expect: ['B1', 'B2'],
    why: 'a set on a board where a free card is genuinely dangerous',
  },
  {
    id: 'rock-free-card',
    personality: 'rock',
    mood: 'calm',
    hole: hand('5c', '4d'),
    board: board('Ah Kd 2s'),
    live: 3,
    pot: 600,
    toCall: 0,
    stack: 9_000,
    bigBlind: 100,
    expect: ['X'],
    why: 'nothing at all, but checking costs nothing',
  },
  {
    id: 'station-vs-allin-trash',
    personality: 'station',
    mood: 'calm',
    hole: hand('9c', '3d'),
    board: board('Ah Kd Qs 2c'),
    live: 2,
    pot: 1500,
    toCall: 3000,
    stack: 3_000,
    bigBlind: 100,
    expect: ['F'],
    why: 'even a calling station folds nothing for its whole stack at a bad price',
  },
  {
    id: 'maniac-monster-vs-bet',
    personality: 'maniac',
    mood: 'euphoric',
    hole: hand('Kh', 'Kd'),
    board: board('Ks 7c 2d'),
    live: 2,
    pot: 1400,
    toCall: 700,
    stack: 8_000,
    bigBlind: 100,
    expect: ['R1', 'R2', 'C'],
    why: 'top set facing a bet - folding would be absurd',
  },
  {
    id: 'shark-marginal-expensive',
    personality: 'shark',
    mood: 'calm',
    hole: hand('Ad', '9c'),
    board: board('Kh 8s 3d'),
    live: 3,
    pot: 800,
    toCall: 800,
    stack: 7_000,
    bigBlind: 100,
    expect: ['F'],
    why: 'ace high against two opponents for a pot-sized bet is not a call',
  },
];
