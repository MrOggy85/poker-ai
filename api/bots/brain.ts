import { makeRng } from '../../shared/rng.ts';
import type { Config } from '../config.ts';
import { estimateEquity } from '../engine/equity.ts';
import type { HandState } from '../engine/types.ts';
import { JeffClient, type DecisionClient } from '../inference/decision.ts';
import { LlamaClient, type MonologueClient } from '../inference/monologue.ts';
import { InferenceQueue } from '../inference/queue.ts';
import logger from '../logger.ts';
import type { Brain, Decision, DecisionRequest } from '../tournament/director.ts';
import { temperatureFor } from './mood.ts';
import { OpponentNotes } from './notes.ts';
import { buildOptions, type Option, type OptionKey } from './options.ts';
import { buildInstructions, buildMonologuePrompt, buildState, MONOLOGUE_EXAMPLES } from './prompt.ts';
import { ruleDecision } from './rules.ts';
import { sample } from './sampling.ts';
import { templateThought } from './templates.ts';
import { buildBotView, type BotView } from './view.ts';
import { equityWords } from './words.ts';

/**
 * One decision, end to end: filtered view, equity, choose, narrate.
 *
 * Everything here works from a `BotView`, which by construction cannot contain another
 * player's cards, mood or thoughts - so information hiding is a property of the types rather
 * than a rule people have to remember.
 *
 * Both models are optional at every step. Jeff falls back to the rule bot, the monologue LLM
 * falls back to a template, and a full tournament completes with neither running. On a machine
 * where a decision costs about four seconds, that is not defensive programming, it is the
 * difference between a game and a slideshow.
 */
export class BotBrain implements Brain {
  #config: Config;
  #notes = new OpponentNotes();
  #decision: DecisionClient | null;
  #monologue: MonologueClient | null;
  #queue: InferenceQueue;
  #ruleFallbacks = 0;
  #illegalChoices = 0;
  #lowConfidence = 0;

  constructor(config: Config, queue = new InferenceQueue()) {
    this.#config = config;
    this.#queue = queue;
    this.#decision = config.decision.enabled ? new JeffClient(config, queue) : null;
    this.#monologue = config.monologue.enabled ? new LlamaClient(config, queue) : null;
  }

  get queue(): InferenceQueue {
    return this.#queue;
  }

  stats(): Record<string, unknown> {
    return {
      queue: this.#queue.stats(),
      decision: this.#decision?.stats() ?? 'disabled',
      ruleFallbacks: this.#ruleFallbacks,
      lowConfidence: this.#lowConfidence,
      illegalChoices: this.#illegalChoices,
    };
  }

  #viewFor(request: DecisionRequest): BotView {
    const { state, seat, handNo, personality, mood } = request;
    const live = state.seats.filter((candidate) => !candidate.folded).length;
    const equity = estimateEquity(
      state.seats[seat].hole!,
      state.board,
      Math.max(1, live - 1),
      this.#config.equity.samples,
      makeRng(this.#config.seed, `equity:${personality.id}:h${handNo}:${state.street}:${state.history.length}`),
    );

    return buildBotView(state, seat, {
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
  }

  async decide(request: DecisionRequest): Promise<Decision> {
    const view = this.#viewFor(request);
    const options = buildOptions(view);
    const rng = makeRng(
      this.#config.seed,
      `choice:${request.personality.id}:h${request.handNo}:${view.table.street}:${request.state.history.length}`,
    );

    const { key, option, source } = await this.#choose(view, options, rng);
    const thought = await this.#narrate(view, key, option, source, request);

    return { action: option.action, thought };
  }

  async #choose(
    view: BotView,
    options: Option[],
    rng: ReturnType<typeof makeRng>,
  ): Promise<{ key: OptionKey; option: Option; source: 'jeff' | 'rules' }> {
    if (!this.#decision || !this.#decision.available() || options.length < 2) {
      return { ...ruleDecision(view, rng), source: 'rules' };
    }

    try {
      const criteria: Record<string, string> = {};
      for (const entry of options) criteria[entry.key] = entry.text;

      const answer = await this.#decision.ask({
        state: buildState(view),
        instructions: buildInstructions(view),
        criteria,
      });

      // Jeff's confidence is chance-corrected: 0 means a uniform distribution, i.e. no
      // opinion at all. Sampling from that is not "surprising play", it is noise - and with a
      // low-temperature bot like The Shark, p^7 turns the largest speck of noise into a
      // deterministic choice. Measured on a real preflop spot the confidence was 0.097 and
      // every bot shoved, ending a six-player tournament in one hand. Below the floor, poker
      // logic decides instead.
      if (answer.confidence < this.#config.decision.minConfidence) {
        this.#lowConfidence++;
        return { ...ruleDecision(view, rng), source: 'rules' };
      }

      const temperature = temperatureFor(view.self.personality, view.self.mood);
      const chosen = sample(answer.probabilities, temperature, rng, options.map((entry) => entry.key));
      const option = options.find((entry) => entry.key === chosen);

      if (!option) {
        // Should be unreachable - `sample` only ever returns a key we offered - but a wrong
        // action is a crash, so it gets a branch rather than a non-null assertion.
        this.#illegalChoices++;
        logger.warn('jeff chose an option that was not offered', { chosen, offered: options.map((e) => e.key) });
        return { ...ruleDecision(view, rng), source: 'rules' };
      }

      return { key: option.key, option, source: 'jeff' };
    } catch (error) {
      this.#ruleFallbacks++;
      logger.warn('decision fell back to rules', {
        reason: error instanceof Error ? error.message : String(error),
      });
      return { ...ruleDecision(view, rng), source: 'rules' };
    }
  }

  async #narrate(
    view: BotView,
    key: OptionKey,
    option: Option,
    _source: 'jeff' | 'rules',
    request: DecisionRequest,
  ): Promise<Decision['thought']> {
    // Not every routine action deserves a line, or the table becomes a wall of text - and on
    // this machine every line costs a second of CPU.
    const notable = key === 'A' || key.startsWith('R') || key.startsWith('B');
    const rng = makeRng(
      this.#config.seed,
      `thought:${request.personality.id}:h${request.handNo}:${view.table.street}:${request.state.history.length}`,
    );
    if (!notable && !rng.chance(this.#config.monologue.routineChance)) return null;

    const template = { text: templateThought(request.personality, request.mood, key, rng), source: 'template' as const };
    if (!this.#monologue || !this.#monologue.available()) return template;

    try {
      const text = await this.#monologue.write(
        buildMonologuePrompt(view, describeChoice(option), equityWords(view.equity.share, view.table.live)),
      );
      // A small model sometimes just hands back the nearest example. That is not a thought,
      // and a template line is better than a borrowed one.
      if (MONOLOGUE_EXAMPLES.some((example) => text.startsWith(example))) return template;
      return { text, source: 'llm' };
    } catch {
      // Expected often enough on this hardware that it is not worth a warning.
      return template;
    }
  }

  /** Public information only: what everyone at the table saw. */
  onHandFinished(state: HandState): void {
    this.#notes.observeHand(state.history, state.seats.map((seat) => seat.id));

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
}

function describeChoice(option: Option): string {
  switch (option.action.kind) {
    case 'fold':
      return 'folded';
    case 'check':
      return 'checked';
    case 'call':
      return 'called';
    case 'bet':
      return 'bet';
    case 'raise':
      return 'raised';
  }
}

export function makeBrain(config: Config): BotBrain {
  logger.info('bots ready', {
    decisions: config.decision.enabled ? config.decision.url : 'rules only',
    monologues: config.monologue.enabled ? config.monologue.url : 'templates only',
  });
  return new BotBrain(config);
}
