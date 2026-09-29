import type { Card } from '../../shared/cards.ts';

export type Street = 'preflop' | 'flop' | 'turn' | 'river' | 'showdown';

export const STREETS: Street[] = ['preflop', 'flop', 'turn', 'river', 'showdown'];

export type ActionKind = 'fold' | 'check' | 'call' | 'bet' | 'raise';

/**
 * `amount` is the TOTAL street commitment - the "raise to" number, not the increment - and it
 * is only present on `bet` and `raise`. `call` never carries one: how much a call costs is
 * always derivable from the state, and letting a caller pass it invites the two conventions to
 * drift apart. Every amount the bots produce is built by code from LegalActions.
 */
export interface Action {
  kind: ActionKind;
  amount?: number;
}

export interface Seat {
  id: string;
  stack: number;
  hole: [Card, Card] | null;
  folded: boolean;
  allIn: boolean;
  /** Chips put in on the current street. */
  street: number;
  /** Chips put in over the whole hand. Side pots are computed from this and nothing else. */
  hand: number;
  /** Has acted since the last full raise. Cleared whenever the betting is reopened. */
  acted: boolean;
  /**
   * May still make an aggressive action. Cleared when the seat acts, restored for everyone
   * else by a *full* raise. An all-in for less than a full raise does not restore it, which
   * is how "a short all-in does not reopen the betting" is enforced: seats who already acted
   * must respond to the larger bet but may only call or fold.
   */
  mayRaise: boolean;
}

export interface PublicAction {
  seat: number;
  id: string;
  street: Street;
  kind: ActionKind;
  /** Chips actually moved by this action, for the action log. */
  paid: number;
  /** The street total the seat is now at. */
  to: number;
  allIn: boolean;
}

export interface Pot {
  amount: number;
  /** Seat indices still eligible to win this layer. */
  eligible: number[];
}

export interface Award {
  seat: number;
  id: string;
  amount: number;
  /** Null when everyone else folded, so no hand was ever shown. */
  handScore: number | null;
}

export interface HandState {
  handNo: number;
  /** Seat index of the dealer button. */
  button: number;
  sb: number;
  bb: number;
  ante: number;
  deck: Card[];
  deckIx: number;
  board: Card[];
  street: Street;
  seats: Seat[];
  /** Seat index to act, or null when the hand needs to advance. */
  toAct: number | null;
  /** The highest street commitment anyone has made. */
  betToMatch: number;
  /** Size of the last full raise, which sets the minimum for the next one. */
  lastRaiseSize: number;
  history: PublicAction[];
  complete: boolean;
  awards: Award[];
}

export interface CallOption {
  /** Chips this seat must add to match. */
  toAdd: number;
  /** True when calling puts the seat all-in for less than the full amount. */
  allIn: boolean;
}

export interface AggressOption {
  kind: 'bet' | 'raise';
  /** Both are "raise to" totals for the street, not increments. */
  min: number;
  max: number;
  potSized: number;
  halfPot: number;
}

export interface LegalActions {
  canFold: boolean;
  canCheck: boolean;
  call: CallOption | null;
  aggress: AggressOption | null;
}
