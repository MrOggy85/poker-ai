import type { HandState, LegalActions, Seat } from './types.ts';

/** Total chips committed to the pot so far this hand, across every seat. */
export function potSize(state: HandState): number {
  return state.seats.reduce((sum, seat) => sum + seat.hand, 0);
}

/** Seats that can still be dealt to and can still win: not folded, not busted out of the hand. */
export function livePlayers(state: HandState): number[] {
  return state.seats.map((_, index) => index).filter((index) => !state.seats[index].folded);
}

/** Seats that can still put chips in: live and not already all-in. */
export function actingPlayers(state: HandState): number[] {
  return livePlayers(state).filter((index) => !state.seats[index].allIn);
}

function clamp(value: number, low: number, high: number): number {
  return Math.max(low, Math.min(high, value));
}

/**
 * What the seat to act is allowed to do. This is the only source of legal actions and of bet
 * sizes - a bot never invents an amount, it picks one of these.
 *
 * Folding is only offered when there is something to call. Folding for free is legal at a real
 * table, but it is never anything but a mistake, and offering it to a classifier that samples
 * from a probability distribution means it will occasionally happen.
 */
export function legalActions(state: HandState): LegalActions {
  if (state.toAct === null) return { canFold: false, canCheck: false, call: null, aggress: null };

  const seat = state.seats[state.toAct];
  const toAdd = state.betToMatch - seat.street;

  const call = toAdd > 0 ? { toAdd: Math.min(toAdd, seat.stack), allIn: toAdd >= seat.stack } : null;

  let aggress: LegalActions['aggress'] = null;
  if (seat.mayRaise && seat.stack > toAdd) {
    const maxTo = seat.street + seat.stack;
    const opening = state.betToMatch === 0;
    // A raise must lift the bet by at least the last full raise, or the big blind if there
    // has not been one. Clamped to the stack, because an all-in for less is still legal.
    const minTo = clamp(opening ? state.bb : state.betToMatch + Math.max(state.lastRaiseSize, state.bb), 0, maxTo);

    // Pot-sized means: call first, then bet what the pot would then be.
    const potAfterCall = potSize(state) + toAdd;
    aggress = {
      kind: opening ? 'bet' : 'raise',
      min: minTo,
      max: maxTo,
      potSized: clamp(state.betToMatch + potAfterCall, minTo, maxTo),
      halfPot: clamp(state.betToMatch + Math.round(potAfterCall / 2), minTo, maxTo),
    };
  }

  return { canFold: toAdd > 0, canCheck: toAdd === 0, call, aggress };
}

/**
 * Is the betting round over? Every seat that can still act must have acted since the last
 * reopening *and* be level with the bet. The second half is what makes a short all-in work:
 * it leaves everyone behind the new bet, so the round stays open even though they have acted.
 */
export function roundClosed(state: HandState): boolean {
  const acting = actingPlayers(state);
  if (livePlayers(state).length <= 1) return true;
  if (acting.length === 0) return true;
  // One player left to act with everyone else all-in has nothing to call and no one to bet
  // into, so the round is over the moment they are level.
  return acting.every((index) => {
    const seat = state.seats[index];
    return seat.acted && seat.street === state.betToMatch;
  });
}

/** Reopens the betting: everyone else must act again, and may raise. */
export function reopen(seats: Seat[], aggressor: number): void {
  for (let index = 0; index < seats.length; index++) {
    const seat = seats[index];
    if (seat.folded || seat.allIn) continue;
    if (index === aggressor) {
      seat.acted = true;
      seat.mayRaise = false;
    } else {
      seat.acted = false;
      seat.mayRaise = true;
    }
  }
}

/**
 * An all-in that does not reach a full raise. Seats behind the new number have to respond, but
 * whoever had already acted may only call or fold - their `mayRaise` is deliberately untouched.
 */
export function reopenShort(seats: Seat[], betToMatch: number): void {
  for (const seat of seats) {
    if (seat.folded || seat.allIn) continue;
    if (seat.street < betToMatch) seat.acted = false;
  }
}

/** The next seat clockwise that still has a decision to make, or null. */
export function nextToAct(state: HandState, from: number): number | null {
  const count = state.seats.length;
  for (let step = 1; step <= count; step++) {
    const index = (from + step) % count;
    const seat = state.seats[index];
    if (seat.folded || seat.allIn) continue;
    if (!seat.acted || seat.street < state.betToMatch) return index;
  }
  return null;
}
