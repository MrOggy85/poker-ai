import type { SeatView, ServerEvent, Snapshot } from '../../shared/events.ts';

/**
 * The whole client-side model: apply a server event to the last snapshot.
 *
 * There are no poker rules in here and there must never be any. It does not work out who won,
 * what is legal, what the pot should be or whose turn it is - every one of those arrives as a
 * fact from the server. The only thing this file decides is wording for the action log, which
 * is presentation. A `store_test` asserts the absence of rule-shaped code.
 */

export interface View extends Snapshot {
  /** Seats that just won a pot, so the table can flash them. Cleared on the next hand. */
  winners: number[];
  /** Hand names revealed at showdown, by seat. */
  shown: Record<number, string>;
  connected: boolean;
}

export function emptyView(): View {
  return {
    epoch: 0,
    seed: '',
    handNo: 0,
    level: 0,
    smallBlind: 0,
    bigBlind: 0,
    street: 'preflop',
    board: [],
    pots: [],
    potTotal: 0,
    seats: [],
    log: [],
    speed: 'normal',
    paused: false,
    finished: false,
    winners: [],
    shown: {},
    connected: false,
  };
}

function withSeat(view: View, seat: number, patch: Partial<View['seats'][number]>): View {
  return {
    ...view,
    seats: view.seats.map((entry) => (entry.seat === seat ? { ...entry, ...patch } : entry)),
  };
}

function note(view: View, text: string): View {
  const log = [...view.log, { handNo: view.handNo, text }];
  return { ...view, log: log.slice(-40) };
}

function nameOf(view: View, seat: number): string {
  return view.seats.find((entry) => entry.seat === seat)?.name ?? `seat ${seat}`;
}

export function reduce(view: View, event: ServerEvent): View {
  switch (event.type) {
    case 'snapshot': {
      return { ...view, ...event.snapshot, winners: [], shown: {}, connected: true };
    }

    case 'reset':
      return { ...emptyView(), epoch: event.epoch, seed: event.seed, connected: true };

    case 'hand_started': {
      const next: View = {
        ...view,
        handNo: event.handNo,
        smallBlind: event.smallBlind,
        bigBlind: event.bigBlind,
        street: 'preflop',
        board: [],
        pots: [],
        potTotal: 0,
        winners: [],
        shown: {},
        seats: view.seats.map((seat) => ({
          ...seat,
          streetBet: 0,
          hole: null,
          thought: null,
          thinking: false,
          lastAction: null,
          justActed: false,
          equity: null,
          status: seat.place !== null ? 'out' : 'active',
          isButton: seat.seat === event.button,
          isSmallBlind: false,
          isBigBlind: false,
        })),
      };
      return note(next, `--- hand ${event.handNo} ---`);
    }

    case 'cards_dealt':
      return {
        ...view,
        seats: view.seats.map((seat) => {
          const dealt = event.hands.find((entry) => entry.seat === seat.seat);
          return dealt ? { ...seat, hole: dealt.hole } : seat;
        }),
      };

    case 'board_dealt':
      return {
        ...view,
        street: event.street,
        board: [...view.board, ...event.cards],
        seats: view.seats.map((seat) => ({
          ...seat,
          streetBet: 0,
          // A fold stands for the rest of the hand - it is how you see who is still in.
          // Everything else belongs to the street that just ended.
          lastAction: seat.status === 'folded' ? seat.lastAction : null,
          justActed: false,
        })),
      };

    case 'player_thinking':
      return withSeat({ ...view, seats: view.seats.map((s) => ({ ...s, thinking: false })) }, event.seat, {
        thinking: true,
      });

    case 'player_thought':
      return withSeat(view, event.seat, { thought: event.text, thinking: false });

    case 'player_action': {
      const cleared = { ...view, seats: view.seats.map((seat) => ({ ...seat, justActed: false })) };
      const next = withSeat(cleared, event.seat, {
        stack: event.stackAfter,
        streetBet: event.to,
        thinking: false,
        status: event.kind === 'fold' ? 'folded' : event.allIn ? 'allin' : 'active',
        lastAction: { kind: event.kind, to: event.to, allIn: event.allIn },
        justActed: true,
      });
      return note(next, `${nameOf(view, event.seat)} ${describe(event)}`);
    }

    case 'mood_changed':
      return withSeat(view, event.seat, { mood: event.to });

    case 'pot_updated':
      return { ...view, pots: event.pots, potTotal: event.total };

    case 'equity_updated':
      return {
        ...view,
        seats: view.seats.map((seat) => {
          const found = event.equities.find((entry) => entry.seat === seat.seat);
          return { ...seat, equity: found ? found.equity : null };
        }),
      };

    case 'showdown': {
      const shown: Record<number, string> = {};
      for (const reveal of event.reveals) shown[reveal.seat] = reveal.hand;
      let next: View = { ...view, shown, winners: event.awards.map((award) => award.seat) };
      for (const reveal of event.reveals) next = note(next, `${nameOf(view, reveal.seat)} shows ${reveal.hand}`);
      for (const award of event.awards) next = note(next, `${nameOf(view, award.seat)} wins ${award.amount}`);
      return next;
    }

    case 'hand_finished': {
      let next: View = { ...view, winners: event.awards.map((award) => award.seat) };
      if (Object.keys(view.shown).length === 0) {
        for (const award of event.awards) next = note(next, `${nameOf(view, award.seat)} takes ${award.amount}`);
      }
      return next;
    }

    case 'player_eliminated': {
      const next = withSeat(view, event.seat, { status: 'out', place: event.place });
      return note(next, `${nameOf(view, event.seat)} is out`);
    }

    case 'blinds_increased':
      return note({ ...view, level: event.level, smallBlind: event.smallBlind, bigBlind: event.bigBlind },
        `blinds up to ${event.smallBlind}/${event.bigBlind}`);

    case 'tournament_finished':
      return note({ ...view, finished: true }, 'tournament over');

    case 'speed_changed':
      return { ...view, speed: event.speed };

    case 'paused':
      return { ...view, paused: true };

    case 'resumed':
      return { ...view, paused: false };
  }
}

function describe(event: Extract<ServerEvent, { type: 'player_action' }>): string {
  switch (event.kind) {
    case 'fold':
      return 'folds';
    case 'check':
      return 'checks';
    case 'call':
      return event.allIn ? `calls ${event.to} and is all in` : `calls ${event.to}`;
    case 'bet':
      return event.allIn ? `is all in for ${event.to}` : `bets ${event.to}`;
    case 'raise':
      return event.allIn ? `is all in for ${event.to}` : `raises to ${event.to}`;
  }
}

/**
 * Standings, derived rather than stored. They were briefly a field on the view, updated by a
 * couple of event handlers - which meant they showed stale stacks between hands. Deriving
 * them on render makes that class of bug impossible.
 */
export function standings(view: View): SeatView[] {
  return [...view.seats].sort((a, b) => {
    if ((a.place === null) !== (b.place === null)) return a.place === null ? -1 : 1;
    if (a.place !== null && b.place !== null) return a.place - b.place;
    return b.stack - a.stack;
  });
}

export function ordinal(n: number): string {
  const teens = n % 100;
  if (teens >= 11 && teens <= 13) return `${n}th`;
  return `${n}${['th', 'st', 'nd', 'rd'][n % 10] ?? 'th'}`;
}
