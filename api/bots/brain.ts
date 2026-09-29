import { makeRng } from '../../shared/rng.ts';
import type { Config } from '../config.ts';
import { estimateEquity } from '../engine/equity.ts';
import type { HandState } from '../engine/types.ts';
import type { Brain, DecisionRequest, Decision } from '../tournament/director.ts';
import { OpponentNotes } from './notes.ts';
import { buildOptions } from './options.ts';
import { ruleDecision } from './rules.ts';
import { templateThought } from './templates.ts';
import { buildBotView } from './view.ts';
import logger from '../logger.ts';

/**
 * One decision, end to end: filtered view, equity, choose, narrate.
 *
 * The pipeline is the point. Everything here works from a `BotView`, which by construction
 * cannot contain another player's cards, mood or thoughts - so information hiding is a
 * property of the types rather than a rule people have to remember.
 */
export class BotBrain implements Brain {
  #config: Config;
  #notes = new OpponentNotes();

  constructor(config: Config) {
    this.#config = config;
  }

  decide(request: DecisionRequest): Promise<Decision> {
    const { state, seat, handNo, personality, mood } = request;

    const equityRng = makeRng(this.#config.seed, `equity:${personality.id}:h${handNo}:${state.street}`);
    const live = state.seats.filter((candidate) => !candidate.folded).length;
    const equity = estimateEquity(
      state.seats[seat].hole!,
      state.board,
      Math.max(1, live - 1),
      this.#config.equity.samples,
      equityRng,
    );

    const view = buildBotView(state, seat, {
      personality,
      mood,
      equity,
      notes: this.#notes.notesFor(
        state.seats
          .map((other, index) => ({ seat: index, name: request.nameOf(index), id: other.id, folded: other.folded }))
          .filter((other) => other.seat !== seat && !other.folded),
      ),
      nameOf: request.nameOf,
    });

    const choiceRng = makeRng(
      this.#config.seed,
      `choice:${personality.id}:h${handNo}:${state.street}:${state.history.length}`,
    );
    const { key, option } = ruleDecision(view, choiceRng);

    // Not every routine action deserves a line, or the table turns into a wall of text.
    const talkative = key === 'A' || key === 'R1' || key === 'R2' || key === 'B1' || key === 'B2';
    const thoughtRng = makeRng(
      this.#config.seed,
      `thought:${personality.id}:h${handNo}:${state.street}:${state.history.length}`,
    );
    const speaks = talkative || thoughtRng.chance(this.#config.monologue.routineChance);

    return Promise.resolve({
      action: option.action,
      thought: speaks
        ? { text: templateThought(personality, mood, key, thoughtRng), source: 'template' as const }
        : null,
    });
  }

  /** Public information only: what everyone at the table saw. */
  onHandFinished(state: HandState): void {
    this.#notes.observeHand(state.history, state.seats.map((seat) => seat.id));

    // A player who reached a showdown and lost with a hand they had bet hard is the only
    // "caught bluffing" signal available from public information.
    const shown = state.seats.filter((seat) => !seat.folded);
    if (shown.length < 2) return;
    const winners = new Set(state.awards.map((award) => state.seats[award.seat].id));
    for (const seat of shown) {
      if (winners.has(seat.id)) continue;
      const wasAggressive = state.history.some(
        (action) => action.id === seat.id && (action.kind === 'bet' || action.kind === 'raise'),
      );
      if (wasAggressive) this.#notes.observeShowdown(seat.id, true);
    }
  }

  /** Exposed so the sanity script and tests can inspect what a bot was actually offered. */
  optionsFor(state: HandState, seat: number, request: Omit<DecisionRequest, 'state' | 'seat'>) {
    const equity = { win: 0, tie: 0, share: 0.5 };
    return buildOptions(buildBotView(state, seat, {
      personality: request.personality,
      mood: request.mood,
      equity,
      notes: [],
      nameOf: request.nameOf,
    }));
  }
}

export function ruleBrain(config: Config): Brain {
  logger.info('using rule-based bots', { seed: config.seed });
  return new BotBrain(config);
}
