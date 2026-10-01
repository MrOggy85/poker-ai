import type { Card } from './cards.ts';

/**
 * The contract between the server and the browser. The server owns every rule and every
 * decision; the client owns pixels. Anything the client would otherwise have to work out for
 * itself - who won, what the pot is, whose turn it is - is stated here explicitly, because the
 * moment the client infers something it has become a second implementation of the game.
 *
 * Kept dependency-free and DOM-free: both sides import it.
 */

export type Street = 'preflop' | 'flop' | 'turn' | 'river' | 'showdown';

export type Mood =
  | 'calm'
  | 'confident'
  | 'tilted'
  | 'bored'
  | 'nervous'
  | 'euphoric'
  | 'suspicious'
  | 'desperate';

export type Speed = 'slow' | 'normal' | 'fast' | 'turbo';

export type SeatStatus = 'active' | 'folded' | 'allin' | 'out';

export type ActionKind = 'fold' | 'check' | 'call' | 'bet' | 'raise';

/** The last thing a seat did, so the table shows it without anyone reading the log. */
export interface LastAction {
  kind: ActionKind;
  /** Street total after the action - what is in front of them. */
  to: number;
  allIn: boolean;
}

export interface SeatView {
  seat: number;
  id: string;
  name: string;
  avatar: string;
  stack: number;
  /** Chips in front of the seat on the current street. */
  streetBet: number;
  status: SeatStatus;
  /** The audience sees every hand face up; null before the deal and after a fold-out. */
  hole: [Card, Card] | null;
  mood: Mood;
  /** The latest inner monologue. Audience-only - no other bot ever sees this. */
  thought: string | null;
  isButton: boolean;
  isSmallBlind: boolean;
  isBigBlind: boolean;
  thinking: boolean;
  /** Cleared at the start of each street, except a fold, which stands for the whole hand. */
  lastAction: LastAction | null;
  /** True for the seat that acted most recently, so the newest action reads as the newest. */
  justActed: boolean;
  /** Audience-only win chance, like the bars on televised poker. */
  equity: number | null;
  /** Finishing place once eliminated. */
  place: number | null;
}

export interface PotView {
  amount: number;
  eligible: number[];
}

export interface LogLine {
  handNo: number;
  text: string;
}

export interface Snapshot {
  /** Bumped by a new tournament. The client throws away anything from a previous epoch. */
  epoch: number;
  seed: string;
  handNo: number;
  level: number;
  smallBlind: number;
  bigBlind: number;
  street: Street;
  board: Card[];
  pots: PotView[];
  potTotal: number;
  seats: SeatView[];
  log: LogLine[];
  speed: Speed;
  paused: boolean;
  finished: boolean;
}

export interface Reveal {
  seat: number;
  hole: [Card, Card];
  hand: string;
}

export interface Award {
  seat: number;
  amount: number;
}

export type ServerEvent =
  | { type: 'snapshot'; snapshot: Snapshot }
  | { type: 'reset'; epoch: number; seed: string }
  | { type: 'hand_started'; handNo: number; button: number; smallBlind: number; bigBlind: number }
  | { type: 'cards_dealt'; hands: { seat: number; hole: [Card, Card] }[] }
  | { type: 'board_dealt'; street: Street; cards: Card[] }
  | { type: 'player_thinking'; seat: number }
  | { type: 'player_thought'; seat: number; text: string; source: 'llm' | 'template' }
  | { type: 'player_action'; seat: number; kind: ActionKind; paid: number; to: number; stackAfter: number; allIn: boolean }
  | { type: 'mood_changed'; seat: number; from: Mood; to: Mood; reason: string }
  | { type: 'pot_updated'; pots: PotView[]; total: number }
  | { type: 'equity_updated'; equities: { seat: number; equity: number }[] }
  | { type: 'showdown'; reveals: Reveal[]; awards: Award[] }
  | { type: 'hand_finished'; handNo: number; awards: Award[] }
  | { type: 'player_eliminated'; seat: number; place: number }
  | { type: 'blinds_increased'; level: number; smallBlind: number; bigBlind: number }
  | { type: 'tournament_finished' }
  | { type: 'speed_changed'; speed: Speed }
  | { type: 'paused' }
  | { type: 'resumed' };

export type ServerEventType = ServerEvent['type'];

export type ClientCommand =
  | { cmd: 'pause' }
  | { cmd: 'resume' }
  | { cmd: 'set_speed'; speed: Speed }
  | { cmd: 'new_tournament'; seed?: string };

export const MOOD_EMOJI: Record<Mood, string> = {
  calm: '\u{1F610}',
  confident: '\u{1F60E}',
  tilted: '\u{1F621}',
  bored: '\u{1F971}',
  nervous: '\u{1F613}',
  euphoric: '\u{1F929}',
  suspicious: '\u{1F914}',
  desperate: '\u{1F628}',
};

export const SPEEDS: Speed[] = ['slow', 'normal', 'fast', 'turbo'];

/**
 * Every event name, because the SSE frames are named and EventSource only delivers named
 * events to a matching listener. Exhaustive by construction: the ServerEventType annotation
 * makes a missing entry a type error the moment a new event is added to the union.
 */
export const SERVER_EVENT_TYPES: ServerEventType[] = [
  'snapshot',
  'reset',
  'hand_started',
  'cards_dealt',
  'board_dealt',
  'player_thinking',
  'player_thought',
  'player_action',
  'mood_changed',
  'pot_updated',
  'equity_updated',
  'showdown',
  'hand_finished',
  'player_eliminated',
  'blinds_increased',
  'tournament_finished',
  'speed_changed',
  'paused',
  'resumed',
];
