import type { Card } from '../../shared/cards.ts';
import type { Mood, SeatStatus, Street } from '../../shared/events.ts';
import type { Equity } from '../engine/equity.ts';
import type { HandState, LegalActions, PublicAction } from '../engine/types.ts';
import { legalActions, potSize } from '../engine/betting.ts';
import type { Personality } from './personalities.ts';

/**
 * The information-hiding boundary, and one of the project's hard requirements.
 *
 * `buildBotView` is the ONLY way to turn game state into something a bot can reason about, and
 * everything downstream - the prompt builder, the option builder, the rule bot, the sampler -
 * takes a `BotView` rather than a `HandState`. There is no field here that could carry another
 * player's hole cards, mood or monologue, so the leak is not merely forbidden, it is
 * unrepresentable. Widening this type is how that guarantee gets lost.
 */

export interface OpponentView {
  seat: number;
  name: string;
  stack: number;
  streetBet: number;
  status: SeatStatus;
  isButton: boolean;
}

export interface OpponentNote {
  seat: number;
  name: string;
  /** Already worded for the model - see notes.ts. */
  text: string;
}

export interface BotView {
  self: {
    seat: number;
    name: string;
    hole: [Card, Card];
    stack: number;
    streetBet: number;
    mood: Mood;
    personality: Personality;
  };
  table: {
    street: Street;
    board: Card[];
    pot: number;
    toCall: number;
    bigBlind: number;
    opponents: OpponentView[];
    /** Public actions on this street, oldest first. Never includes anyone's thoughts. */
    recent: PublicAction[];
    /** How many players are still in the hand, including this one. */
    live: number;
  };
  legal: LegalActions;
  equity: Equity;
  notes: OpponentNote[];
}

export function buildBotView(
  state: HandState,
  seatIndex: number,
  context: {
    personality: Personality;
    mood: Mood;
    equity: Equity;
    notes: OpponentNote[];
    nameOf: (handSeat: number) => string;
  },
): BotView {
  const seat = state.seats[seatIndex];
  if (!seat.hole) throw new Error('cannot build a view for a seat with no cards');

  const legal = legalActions(state);
  const live = state.seats.filter((candidate) => !candidate.folded).length;

  return {
    self: {
      seat: seatIndex,
      name: context.nameOf(seatIndex),
      hole: seat.hole,
      stack: seat.stack,
      streetBet: seat.street,
      mood: context.mood,
      personality: context.personality,
    },
    table: {
      street: state.street,
      board: [...state.board],
      pot: potSize(state),
      toCall: Math.max(0, state.betToMatch - seat.street),
      bigBlind: state.bb,
      opponents: state.seats
        .map((other, index) => ({ other, index }))
        .filter(({ index }) => index !== seatIndex)
        .map(({ other, index }) => ({
          seat: index,
          name: context.nameOf(index),
          stack: other.stack,
          streetBet: other.street,
          status: other.folded ? 'folded' as const : other.allIn ? 'allin' as const : 'active' as const,
          isButton: state.button === index,
        })),
      recent: state.history.filter((action) => action.street === state.street),
      live,
    },
    legal,
    equity: context.equity,
    notes: context.notes,
  };
}
