import type { Award, HandState, Pot, Seat } from './types.ts';

/**
 * Side pots are computed, never maintained. During play each seat only tracks `hand`, the
 * chips it has put in over the whole hand; the layering is derived from those numbers at award
 * time. Incrementally maintained side pots are where hobby engines go wrong, and there is no
 * reason to carry the state when it is twenty lines to recover it.
 *
 * Every distinct commitment level is a layer. A folded seat's chips still fill the layers it
 * paid for - that is the dead money - but it is never eligible to win one.
 */
export function buildPots(seats: readonly Seat[]): Pot[] {
  const levels = [...new Set(seats.map((seat) => seat.hand).filter((amount) => amount > 0))].sort((a, b) => a - b);

  const pots: Pot[] = [];
  let previous = 0;

  for (const level of levels) {
    let amount = 0;
    const eligible: number[] = [];

    for (let index = 0; index < seats.length; index++) {
      const seat = seats[index];
      if (seat.hand >= level) {
        amount += level - previous;
        if (!seat.folded) eligible.push(index);
      } else if (seat.hand > previous) {
        // A seat that committed part-way into this layer - it went all-in or folded mid-street.
        amount += seat.hand - previous;
      }
    }

    if (amount > 0) {
      // A layer nobody is eligible for (everyone who paid into it folded) cannot vanish - it
      // rolls into the next layer up, which by construction has eligible seats.
      const previousPot = pots[pots.length - 1];
      if (eligible.length === 0 && previousPot) previousPot.amount += amount;
      else pots.push({ amount, eligible });
    }
    previous = level;
  }

  return pots;
}

export function potTotal(pots: readonly Pot[]): number {
  return pots.reduce((sum, pot) => sum + pot.amount, 0);
}

/**
 * Splits each pot between its best eligible hands. `scoreOf` returns null for a seat that
 * never showed a hand, which only happens when everyone else folded.
 *
 * Odd chips go to the first winner clockwise from the button, which is the standard rule and
 * the only reason `button` is a parameter.
 */
export function awardPots(
  state: HandState,
  pots: readonly Pot[],
  scoreOf: (seatIndex: number) => number | null,
): Award[] {
  const bySeat = new Map<number, Award>();

  for (const pot of pots) {
    if (pot.eligible.length === 0) continue;

    let best = -1;
    let winners: number[] = [];
    for (const seatIndex of pot.eligible) {
      const score = scoreOf(seatIndex) ?? -1;
      if (score > best) {
        best = score;
        winners = [seatIndex];
      } else if (score === best) {
        winners.push(seatIndex);
      }
    }

    const each = Math.floor(pot.amount / winners.length);
    let remainder = pot.amount - each * winners.length;

    // Clockwise from the button: seat button+1 first, wrapping.
    const ordered = [...winners].sort((a, b) => {
      const da = (a - state.button + state.seats.length - 1) % state.seats.length;
      const db = (b - state.button + state.seats.length - 1) % state.seats.length;
      return da - db;
    });

    for (const seatIndex of ordered) {
      let amount = each;
      if (remainder > 0) {
        amount++;
        remainder--;
      }
      const existing = bySeat.get(seatIndex);
      if (existing) existing.amount += amount;
      else {
        bySeat.set(seatIndex, {
          seat: seatIndex,
          id: state.seats[seatIndex].id,
          amount,
          handScore: scoreOf(seatIndex),
        });
      }
    }
  }

  return [...bySeat.values()].sort((a, b) => b.amount - a.amount);
}
