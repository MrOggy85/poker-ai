import { assert, assertEquals, assertThrows } from 'jsr:@std/assert@1';
import { makeRng } from '../../shared/rng.ts';
import { legalActions, potSize } from './betting.ts';
import { advance, applyAction, IllegalActionError, startHand, type Step } from './engine.ts';
import type { Action, HandState } from './types.ts';

const players = (count: number, stack = 10_000) =>
  Array.from({ length: count }, (_, index) => ({ id: `p${index}`, stack }));

function start(count: number, stacks?: number[], button = 0): HandState {
  const seats = stacks
    ? stacks.map((stack, index) => ({ id: `p${index}`, stack }))
    : players(count);
  return startHand({ handNo: 1, button, sb: 50, bb: 100, players: seats }, makeRng('test', 'deck:h1')).state;
}

/** Applies actions in order, advancing streets whenever nobody is to act. */
function play(state: HandState, actions: Action[]): HandState {
  let current = state;
  for (const action of actions) {
    while (current.toAct === null && !current.complete) current = advance(current).state;
    if (current.complete) break;
    current = applyAction(current, action).state;
  }
  while (current.toAct === null && !current.complete) current = advance(current).state;
  return current;
}

Deno.test('blinds are posted and the seat after the big blind acts first', () => {
  const state = start(6);
  assertEquals(state.seats[1].hand, 50);
  assertEquals(state.seats[2].hand, 100);
  assertEquals(state.betToMatch, 100);
  assertEquals(state.toAct, 3);
});

Deno.test('the big blind gets the option when everyone limps', () => {
  let state = start(6);
  // Everyone calls round to the big blind.
  state = play(state, [
    { kind: 'call' },
    { kind: 'call' },
    { kind: 'call' },
    { kind: 'call' },
    { kind: 'call' },
  ]);
  // Seat 2 is the big blind: level with the bet, but still owed a decision.
  assertEquals(state.toAct, 2);
  assertEquals(state.seats[2].street, 100);
  assert(legalActions(state).canCheck);
  assert(legalActions(state).aggress !== null, 'the big blind may still raise');
});

Deno.test('heads-up the button posts the small blind and acts first, then last', () => {
  let state = start(2);
  assertEquals(state.seats[0].hand, 50, 'the button posts the small blind');
  assertEquals(state.seats[1].hand, 100);
  assertEquals(state.toAct, 0, 'the button acts first before the flop');

  state = applyAction(state, { kind: 'call' }).state;
  state = applyAction(state, { kind: 'check' }).state;
  state = advance(state).state;
  assertEquals(state.street, 'flop');
  assertEquals(state.toAct, 1, 'the big blind acts first after the flop');
});

Deno.test('a full raise reopens the betting for everyone', () => {
  let state = start(6);
  state = applyAction(state, { kind: 'call' }).state; // seat 3
  state = applyAction(state, { kind: 'raise', amount: 300 }).state; // seat 4
  assert(legalActions(state).aggress !== null);
  // Seat 3 already called, but the full raise gives the right to raise back.
  const backTo3 = play(state, [{ kind: 'fold' }, { kind: 'fold' }, { kind: 'fold' }, { kind: 'fold' }]);
  assertEquals(backTo3.toAct, 3);
  assert(legalActions(backTo3).aggress !== null, 'seat 3 may re-raise after a full raise');
});

Deno.test('an all-in for less than a full raise does not reopen the betting', () => {
  // Seat 4 has only 380 chips: raising all-in over a 300 bet is a raise of 80, short of the
  // 200 needed for a full one. Seat 3, who already called 300, must respond but may not raise.
  let state = start(6, [10_000, 10_000, 10_000, 10_000, 380, 10_000]);
  state = applyAction(state, { kind: 'raise', amount: 300 }).state; // seat 3
  state = applyAction(state, { kind: 'raise', amount: 380 }).state; // seat 4, all-in short
  assert(state.seats[4].allIn);

  state = play(state, [{ kind: 'fold' }, { kind: 'fold' }, { kind: 'fold' }, { kind: 'fold' }]);
  assertEquals(state.toAct, 3, 'seat 3 has to answer the extra 80');
  const legal = legalActions(state);
  assertEquals(legal.call?.toAdd, 80);
  assertEquals(legal.aggress, null, 'but may not raise back');
});

Deno.test('a full re-raise after a short all-in is still possible for a player yet to act', () => {
  let state = start(6, [10_000, 10_000, 10_000, 10_000, 380, 10_000]);
  state = applyAction(state, { kind: 'raise', amount: 300 }).state; // seat 3
  state = applyAction(state, { kind: 'raise', amount: 380 }).state; // seat 4, short all-in
  assertEquals(state.toAct, 5);
  assert(legalActions(state).aggress !== null, 'seat 5 has not acted yet, so it may raise');
});

Deno.test('an illegal action throws and leaves the state untouched', () => {
  const state = start(6);
  const before = JSON.stringify(state);
  assertThrows(() => applyAction(state, { kind: 'check' }), IllegalActionError);
  assertThrows(() => applyAction(state, { kind: 'raise', amount: 120 }), IllegalActionError);
  assertThrows(() => applyAction(state, { kind: 'raise' }), IllegalActionError);
  assertEquals(JSON.stringify(state), before);
});

Deno.test('folding is not offered when checking is free', () => {
  let state = start(6);
  state = play(state, [{ kind: 'call' }, { kind: 'call' }, { kind: 'call' }, { kind: 'call' }, { kind: 'call' }]);
  assertEquals(legalActions(state).canFold, false);
});

Deno.test('everyone folding ends the hand and the last player takes the pot', () => {
  let state = start(6);
  state = play(state, Array(5).fill({ kind: 'fold' }));
  assert(state.complete);
  assertEquals(state.awards.length, 1);
  assertEquals(state.awards[0].seat, 2, 'the big blind wins when it folds round');
  // 100, not 150: the big blind's own 50 of overhang was never called, so it comes back
  // rather than being won. Same net result, and it is what real clients report - "uncalled
  // bet (50) returned, wins pot (100)".
  assertEquals(state.awards[0].amount, 100);
  assertEquals(state.seats[2].stack, 10_000 + 50, 'net winnings are the small blind');
  assertEquals(state.awards[0].handScore, null, 'no hand was ever shown');
});

Deno.test('a hand played to showdown deals a full board', () => {
  let state = start(3);
  state = play(state, [
    { kind: 'call' }, { kind: 'call' }, { kind: 'check' }, // preflop
    { kind: 'check' }, { kind: 'check' }, { kind: 'check' }, // flop
    { kind: 'check' }, { kind: 'check' }, { kind: 'check' }, // turn
    { kind: 'check' }, { kind: 'check' }, { kind: 'check' }, // river
  ]);
  assert(state.complete);
  assertEquals(state.board.length, 5);
  assertEquals(state.awards.every((a) => a.handScore !== null), true);
});

// --- the properties that matter more than any single case ---------------------------------

function randomLegalAction(state: HandState, rng: ReturnType<typeof makeRng>): Action {
  const legal = legalActions(state);
  const choices: Action[] = [];
  if (legal.canCheck) choices.push({ kind: 'check' });
  if (legal.canFold) choices.push({ kind: 'fold' });
  if (legal.call) choices.push({ kind: 'call' });
  if (legal.aggress) {
    const { kind, min, max, halfPot, potSized } = legal.aggress;
    choices.push({ kind, amount: min });
    choices.push({ kind, amount: halfPot });
    choices.push({ kind, amount: potSized });
    choices.push({ kind, amount: max });
  }
  return rng.pick(choices);
}

function playRandomHand(stacks: number[], button: number, label: string): HandState {
  const rng = makeRng('chips', label);
  let state = startHand(
    { handNo: 1, button, sb: 50, bb: 100, players: stacks.map((stack, i) => ({ id: `p${i}`, stack })) },
    rng,
  ).state;

  let guard = 0;
  while (!state.complete) {
    if (guard++ > 500) throw new Error('hand did not terminate');
    if (state.toAct === null) {
      state = advance(state).state;
      continue;
    }
    state = applyAction(state, randomLegalAction(state, rng)).state;
  }
  return state;
}

Deno.test('chips are conserved over a thousand random hands', () => {
  for (let trial = 0; trial < 1000; trial++) {
    const count = 2 + (trial % 8);
    const stacks = Array.from({ length: count }, (_, i) => 200 + ((trial * 137 + i * 911) % 9000));
    const before = stacks.reduce((a, b) => a + b, 0);
    const state = playRandomHand(stacks, trial % count, `hand:${trial}`);
    const after = state.seats.reduce((sum, seat) => sum + seat.stack, 0);
    assertEquals(after, before, `hand ${trial} leaked chips`);
  }
});

Deno.test('the same seed and actions reproduce the hand exactly', () => {
  const a = playRandomHand([5000, 5000, 5000, 5000], 1, 'repeat');
  const b = playRandomHand([5000, 5000, 5000, 5000], 1, 'repeat');
  assertEquals(JSON.stringify(a), JSON.stringify(b));
});

Deno.test('the pot never exceeds what players put in', () => {
  const state = playRandomHand([3000, 3000, 3000], 0, 'potsize');
  assertEquals(potSize(state), state.seats.reduce((sum, seat) => sum + seat.hand, 0));
});

Deno.test('an uncalled bet is returned rather than won', () => {
  // Seat 3 raises to 3000 and everyone folds. The pot it wins is the blinds plus its own 100
  // big-blind-matching chips - not its whole 3000, which nobody ever called.
  let state = start(6);
  state = play(state, [{ kind: 'raise', amount: 3000 }, ...Array(5).fill({ kind: 'fold' })]);
  assert(state.complete);
  assertEquals(state.awards.length, 1);
  assertEquals(state.awards[0].seat, 3);
  // The raise is returned down to the next-highest commitment, the big blind's 100, so the
  // pot is 50 + 100 + 100 rather than anything involving the uncalled 2900.
  assertEquals(state.awards[0].amount, 250);
  assertEquals(state.seats[3].stack, 10_000 + 150, 'net winnings are the two blinds');
});

Deno.test('an uncalled portion of a call-for-less is returned', () => {
  // Seat 3 bets 5000; seat 4 can only cover 1200 and is all-in; everyone else folds. Seat 3
  // risked 1200, not 5000.
  let state = start(6, [10_000, 10_000, 10_000, 10_000, 1200, 10_000]);
  state = play(state, [
    { kind: 'raise', amount: 5000 }, // seat 3
    { kind: 'call' }, // seat 4, all-in for 1200
    { kind: 'fold' }, // seat 5
    { kind: 'fold' }, // seat 0
    { kind: 'fold' }, // seat 1
    { kind: 'fold' }, // seat 2
  ]);
  assert(state.complete);
  const total = state.seats.reduce((sum, seat) => sum + seat.stack, 0);
  assertEquals(total, 10_000 * 5 + 1200, 'chips conserved');
  // Whoever won, the pot at stake was 1200 + 1200 + the two blinds.
  assertEquals(state.awards.reduce((sum, award) => sum + award.amount, 0), 1200 + 1200 + 150);
});
