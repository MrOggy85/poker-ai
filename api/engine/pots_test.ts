import { assertEquals } from 'jsr:@std/assert@1';
import { awardPots, buildPots, potTotal } from './pots.ts';
import type { HandState, Seat } from './types.ts';

function seat(hand: number, folded = false): Seat {
  return { id: `p${hand}`, stack: 0, hole: null, folded, allIn: false, street: 0, hand, acted: true, mayRaise: false };
}

function stateWith(seats: Seat[], button = 0): HandState {
  return {
    handNo: 1,
    button,
    sb: 50,
    bb: 100,
    ante: 0,
    deck: [],
    deckIx: 0,
    board: [],
    street: 'showdown',
    seats: seats.map((s, i) => ({ ...s, id: `p${i}` })),
    toAct: null,
    betToMatch: 0,
    lastRaiseSize: 0,
    history: [],
    complete: true,
    awards: [],
  };
}

Deno.test('equal commitments make exactly one pot', () => {
  const pots = buildPots([seat(100), seat(100), seat(100)]);
  assertEquals(pots.length, 1);
  assertEquals(pots[0], { amount: 300, eligible: [0, 1, 2] });
});

Deno.test('a short all-in makes a main pot and a side pot', () => {
  // 100 / 500 / 500: main pot is 300 with everyone in it, side pot is 800 between the two
  // players who could cover it.
  const pots = buildPots([seat(100), seat(500), seat(500)]);
  assertEquals(pots.length, 2);
  assertEquals(pots[0], { amount: 300, eligible: [0, 1, 2] });
  assertEquals(pots[1], { amount: 800, eligible: [1, 2] });
  assertEquals(potTotal(pots), 1100);
});

Deno.test('a folded seat pays into the layers it covered but wins none of them', () => {
  const pots = buildPots([seat(100, true), seat(500), seat(500)]);
  assertEquals(pots[0], { amount: 300, eligible: [1, 2] });
  assertEquals(pots[1], { amount: 800, eligible: [1, 2] });
  assertEquals(potTotal(pots), 1100);
});

Deno.test('three all-ins at different depths make three layers', () => {
  const pots = buildPots([seat(50), seat(200), seat(1000), seat(1000)]);
  assertEquals(pots.map((p) => p.amount), [200, 450, 1600]);
  assertEquals(pots.map((p) => p.eligible), [[0, 1, 2, 3], [1, 2, 3], [2, 3]]);
  assertEquals(potTotal(pots), 2250);
});

Deno.test('every chip put in is in some pot', () => {
  const seats = [seat(75, true), seat(340), seat(1200), seat(1200), seat(20, true)];
  assertEquals(potTotal(buildPots(seats)), 75 + 340 + 1200 + 1200 + 20);
});

Deno.test('the whole pot goes to the best hand', () => {
  const state = stateWith([seat(100), seat(100), seat(100)]);
  const awards = awardPots(state, buildPots(state.seats), (i) => [10, 50, 30][i]);
  assertEquals(awards.length, 1);
  assertEquals(awards[0].seat, 1);
  assertEquals(awards[0].amount, 300);
});

Deno.test('a short stack can only win the main pot', () => {
  // Seat 0 is all-in for 100 and has the best hand: it takes the 300 main pot, and the 800
  // side pot goes to the better of the two who kept betting.
  const state = stateWith([seat(100), seat(500), seat(500)]);
  const awards = awardPots(state, buildPots(state.seats), (i) => [90, 50, 70][i]);
  assertEquals(awards.find((a) => a.seat === 0)?.amount, 300);
  assertEquals(awards.find((a) => a.seat === 2)?.amount, 800);
  assertEquals(awards.reduce((sum, a) => sum + a.amount, 0), 1100);
});

Deno.test('a split pot divides evenly and the odd chip goes clockwise from the button', () => {
  // 101 chips between two winners. The button is seat 0, so seat 1 is first clockwise and
  // takes the extra chip.
  const state = stateWith([seat(1), seat(50), seat(50)], 0);
  const awards = awardPots(state, buildPots(state.seats), (i) => (i === 0 ? -1 : 50));
  const first = awards.find((a) => a.seat === 1)!;
  const second = awards.find((a) => a.seat === 2)!;
  assertEquals(first.amount + second.amount, 101);
  assertEquals(first.amount, 51);
  assertEquals(second.amount, 50);
});

Deno.test('chips are conserved across every award', () => {
  const state = stateWith([seat(50), seat(200), seat(1000), seat(1000, true)]);
  const pots = buildPots(state.seats);
  const awards = awardPots(state, pots, (i) => [5, 90, 40, -1][i]);
  assertEquals(awards.reduce((sum, a) => sum + a.amount, 0), potTotal(pots));
});
