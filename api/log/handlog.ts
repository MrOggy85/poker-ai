import { cardsToStrings } from '../../shared/cards.ts';
import type { HandState } from '../engine/types.ts';
import logger from '../logger.ts';

/**
 * One JSON line per hand, for debugging bots and tuning option wording.
 *
 * What makes it worth the disk is the decision record: the exact state string and options that
 * were sent, the probabilities that came back, and which option was sampled. Wording changes
 * have large and non-obvious effects on this model - the sanity set showed a rephrasing that
 * read better to a human collapsing its confidence - so the only way to know what a bot was
 * actually looking at when it did something strange is to have kept it.
 */

export interface DecisionRecord {
  seat: number;
  name: string;
  street: string;
  mood: string;
  /** Exactly what was sent, not a reconstruction. */
  state: string;
  options: Record<string, string>;
  probabilities: Record<string, number> | null;
  confidence: number | null;
  chosen: string;
  source: 'jeff' | 'rules';
  thought: string | null;
  thoughtSource: 'llm' | 'template' | null;
  ms: number;
}

export interface HandRecord {
  seed: string;
  handNo: number;
  button: number;
  smallBlind: number;
  bigBlind: number;
  hole: Record<string, string[]>;
  board: string[];
  decisions: DecisionRecord[];
  awards: { name: string; amount: number }[];
  stacks: Record<string, number>;
}

export class HandLog {
  #path: string | null = null;
  #pending: DecisionRecord[] = [];

  constructor(dir: string, seed: string) {
    // An empty directory means "do not log" - used by the headless simulation, which would
    // otherwise write a file per tournament.
    if (!dir) return;
    try {
      Deno.mkdirSync(dir, { recursive: true });
      const stamp = new Date().toISOString().replace(/[:.]/g, '-');
      this.#path = `${dir}/${stamp}-${seed}.jsonl`;
    } catch (error) {
      // A read-only volume is not a reason to stop playing poker.
      logger.warn('hand log disabled', { error: error instanceof Error ? error.message : String(error) });
    }
  }

  get path(): string | null {
    return this.#path;
  }

  record(decision: DecisionRecord): void {
    if (this.#path) this.#pending.push(decision);
  }

  finishHand(state: HandState, seed: string, nameOf: (handSeat: number) => string): void {
    if (!this.#path) return;

    const record: HandRecord = {
      seed,
      handNo: state.handNo,
      button: state.button,
      smallBlind: state.sb,
      bigBlind: state.bb,
      hole: Object.fromEntries(
        state.seats.map((seat, index) => [nameOf(index), seat.hole ? cardsToStrings(seat.hole) : []]),
      ),
      board: cardsToStrings(state.board),
      decisions: this.#pending,
      awards: state.awards.map((award) => ({ name: nameOf(award.seat), amount: award.amount })),
      stacks: Object.fromEntries(state.seats.map((seat, index) => [nameOf(index), seat.stack])),
    };
    this.#pending = [];

    try {
      Deno.writeTextFileSync(this.#path, `${JSON.stringify(record)}\n`, { append: true });
    } catch (error) {
      logger.warn('could not write the hand log', {
        error: error instanceof Error ? error.message : String(error),
      });
      this.#path = null;
    }
  }

  reset(): void {
    this.#pending = [];
  }
}
