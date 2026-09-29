import type { Card } from '../../shared/cards.ts';
import { DECK_SIZE } from '../../shared/cards.ts';
import type { Rng } from '../../shared/rng.ts';
import { evaluate } from './evaluator.ts';
import { actingPlayers, legalActions, livePlayers, nextToAct, reopen, reopenShort, roundClosed } from './betting.ts';
import { awardPots, buildPots } from './pots.ts';
import type { Action, Award, HandState, PublicAction, Seat, Street } from './types.ts';

/**
 * Texas Hold'em, as a pure function of state and action. No AI, no timing, no network, no
 * clock - given the same seed and the same sequence of actions this produces byte-identical
 * results, which is what makes a tournament replayable from its log.
 *
 * `applyAction` handles one player's decision. When it returns a state with `toAct === null`
 * the hand needs to move on, which is `advance`'s job: deal the next street, run out the board
 * when everyone is all-in, or settle up.
 */

export interface StartOptions {
  handNo: number;
  button: number;
  sb: number;
  bb: number;
  ante?: number;
  players: { id: string; stack: number }[];
}

export type EngineEvent =
  | { type: 'action'; action: PublicAction }
  | { type: 'board'; street: Street; cards: Card[] }
  | { type: 'showdown'; reveals: { seat: number; id: string; hole: [Card, Card]; score: number }[]; awards: Award[] }
  | { type: 'hand_finished'; awards: Award[] };

export interface Step {
  state: HandState;
  events: EngineEvent[];
}

function cloneState(state: HandState): HandState {
  return {
    ...state,
    board: [...state.board],
    seats: state.seats.map((seat) => ({ ...seat })),
    history: [...state.history],
    awards: [...state.awards],
  };
}

/** Moves chips from a seat into the pot, capping at the stack and marking all-in. */
function commit(seat: Seat, amount: number): number {
  const paid = Math.min(amount, seat.stack);
  seat.stack -= paid;
  seat.street += paid;
  seat.hand += paid;
  if (seat.stack === 0) seat.allIn = true;
  return paid;
}

export function startHand(options: StartOptions, rng: Rng): Step {
  const { handNo, button, sb, bb, players } = options;
  const ante = options.ante ?? 0;

  const deck = rng.shuffle(Array.from({ length: DECK_SIZE }, (_, index) => index as Card));

  const seats: Seat[] = players.map((player) => ({
    id: player.id,
    stack: player.stack,
    hole: null,
    folded: false,
    allIn: false,
    street: 0,
    hand: 0,
    acted: false,
    mayRaise: true,
  }));

  let deckIx = 0;
  for (const seat of seats) {
    seat.hole = [deck[deckIx++], deck[deckIx++]];
  }

  const state: HandState = {
    handNo,
    button,
    sb,
    bb,
    ante,
    deck,
    deckIx,
    board: [],
    street: 'preflop',
    seats,
    toAct: null,
    betToMatch: bb,
    lastRaiseSize: bb,
    history: [],
    complete: false,
    awards: [],
  };

  if (ante > 0) {
    for (const seat of seats) {
      const paid = commit(seat, ante);
      // Antes are hand money, not street money - they do not count toward matching the blind.
      seat.street -= paid;
    }
  }

  // Heads-up is the exception everywhere: the button posts the small blind and acts first
  // before the flop, then acts last on every later street.
  const headsUp = seats.length === 2;
  const sbSeat = headsUp ? button : (button + 1) % seats.length;
  const bbSeat = headsUp ? (button + 1) % seats.length : (button + 2) % seats.length;

  commit(seats[sbSeat], sb);
  commit(seats[bbSeat], bb);

  state.toAct = nextToAct(state, bbSeat);
  return { state, events: [] };
}

export class IllegalActionError extends Error {}

export function applyAction(previous: HandState, action: Action): Step {
  if (previous.toAct === null) throw new IllegalActionError('no seat is to act');

  const legal = legalActions(previous);
  const state = cloneState(previous);
  const index = previous.toAct;
  const seat = state.seats[index];

  let paid = 0;

  switch (action.kind) {
    case 'fold': {
      if (!legal.canFold) throw new IllegalActionError('cannot fold when checking is free');
      seat.folded = true;
      seat.acted = true;
      break;
    }
    case 'check': {
      if (!legal.canCheck) throw new IllegalActionError('cannot check facing a bet');
      seat.acted = true;
      seat.mayRaise = false;
      break;
    }
    case 'call': {
      if (!legal.call) throw new IllegalActionError('nothing to call');
      paid = commit(seat, legal.call.toAdd);
      seat.acted = true;
      seat.mayRaise = false;
      break;
    }
    case 'bet':
    case 'raise': {
      if (!legal.aggress) throw new IllegalActionError('cannot bet or raise here');
      const target = action.amount;
      if (typeof target !== 'number') throw new IllegalActionError('bet and raise need an amount');
      if (target < legal.aggress.min || target > legal.aggress.max) {
        throw new IllegalActionError(`${target} is outside [${legal.aggress.min}, ${legal.aggress.max}]`);
      }
      paid = commit(seat, target - seat.street);

      const raiseSize = seat.street - state.betToMatch;
      const fullRaise = raiseSize >= Math.max(state.lastRaiseSize, state.bb);
      state.betToMatch = Math.max(state.betToMatch, seat.street);

      if (fullRaise) {
        state.lastRaiseSize = raiseSize;
        reopen(state.seats, index);
      } else {
        // An all-in for less than a full raise. Everyone behind it has to respond, but nobody
        // who has already acted gets the right to raise back.
        seat.acted = true;
        seat.mayRaise = false;
        reopenShort(state.seats, state.betToMatch);
      }
      break;
    }
  }

  const record: PublicAction = {
    seat: index,
    id: seat.id,
    street: state.street,
    kind: action.kind,
    paid,
    to: seat.street,
    allIn: seat.allIn,
  };
  state.history.push(record);

  state.toAct = roundClosed(state) ? null : nextToAct(state, index);

  return { state, events: [{ type: 'action', action: record }] };
}

const NEXT_STREET: Record<Street, Street> = {
  preflop: 'flop',
  flop: 'turn',
  turn: 'river',
  river: 'showdown',
  showdown: 'showdown',
};

const CARDS_DEALT: Record<Street, number> = { preflop: 0, flop: 3, turn: 1, river: 1, showdown: 0 };

/** Everyone still in the hand is all-in, so there is nothing left to decide. */
function noDecisionsLeft(state: HandState): boolean {
  return actingPlayers(state).length <= 1 && livePlayers(state).length > 1;
}

/**
 * Moves the hand on when nobody is to act: deals the next street, runs the board out when the
 * betting is finished, or settles. Call it repeatedly until `state.complete`.
 */
export function advance(previous: HandState): Step {
  if (previous.complete) return { state: previous, events: [] };
  if (previous.toAct !== null) throw new Error('advance called while a seat is still to act');

  const live = livePlayers(previous);
  if (live.length <= 1) return settle(previous);
  if (previous.street === 'river' || previous.street === 'showdown') return settle(previous);

  const state = cloneState(previous);
  const street = NEXT_STREET[state.street];
  const count = CARDS_DEALT[street];

  // The burn card, kept only because a real deal has one and reproducing a hand from its log
  // should match a real deal card for card.
  state.deckIx++;
  const cards: Card[] = [];
  for (let i = 0; i < count; i++) cards.push(state.deck[state.deckIx++]);
  state.board.push(...cards);
  state.street = street;

  for (const seat of state.seats) {
    seat.street = 0;
    seat.acted = false;
    seat.mayRaise = true;
  }
  state.betToMatch = 0;
  state.lastRaiseSize = 0;

  // With everyone all-in there is no betting to do; the caller keeps advancing and the rest of
  // the board runs out.
  state.toAct = noDecisionsLeft(state) ? null : nextToAct(state, state.button);

  return { state, events: [{ type: 'board', street, cards }] };
}

/**
 * Returns the part of a bet nobody matched. If one seat is in for more than every other seat
 * put together could call, that excess was never at risk and must come back before the pots
 * are built.
 *
 * Without this, stacks still come out right - the uncalled chips form a layer only the bettor
 * is eligible for, so they win them straight back - but the audience sees an inflated pot and
 * a showdown where someone "wins" their own money. That is wrong on screen, which is the only
 * place it shows.
 */
function refundUncalled(state: HandState): void {
  const commitments = state.seats.map((seat) => seat.hand).sort((a, b) => b - a);
  const excess = commitments[0] - (commitments[1] ?? 0);
  if (excess <= 0) return;

  const seat = state.seats.find((candidate) => candidate.hand === commitments[0]);
  if (!seat) return;
  seat.hand -= excess;
  seat.stack += excess;
  // Getting chips back means the seat is no longer all-in, which matters for the view.
  if (seat.stack > 0) seat.allIn = false;
}

function settle(previous: HandState): Step {
  const state = cloneState(previous);
  refundUncalled(state);
  const live = livePlayers(state);
  const pots = buildPots(state.seats);

  const scores = new Map<number, number>();
  if (live.length > 1) {
    for (const index of live) {
      const seat = state.seats[index];
      scores.set(index, evaluate([...seat.hole!, ...state.board]));
    }
  }

  const awards = awardPots(state, pots, (index) => scores.get(index) ?? null);
  for (const award of awards) state.seats[award.seat].stack += award.amount;

  state.awards = awards;
  state.complete = true;
  state.toAct = null;
  state.street = 'showdown';

  if (live.length > 1) {
    const reveals = live.map((index) => ({
      seat: index,
      id: state.seats[index].id,
      hole: state.seats[index].hole!,
      score: scores.get(index)!,
    }));
    return { state, events: [{ type: 'showdown', reveals, awards }, { type: 'hand_finished', awards }] };
  }

  return { state, events: [{ type: 'hand_finished', awards }] };
}

export { legalActions };
