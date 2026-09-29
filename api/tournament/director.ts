import type { Card } from '../../shared/cards.ts';
import type { LogLine, Mood, PotView, ServerEvent, Snapshot, Speed } from '../../shared/events.ts';
import { makeRng } from '../../shared/rng.ts';
import type { Config } from '../config.ts';
import logger from '../logger.ts';
import { Cancelled, Pacer } from '../broadcast/pacing.ts';
import type { Hub } from '../broadcast/hub.ts';
import { advance, applyAction, startHand } from '../engine/engine.ts';
import { legalActions, potSize } from '../engine/betting.ts';
import { buildPots } from '../engine/pots.ts';
import { estimateEquity } from '../engine/equity.ts';
import { describe } from '../engine/evaluator.ts';
import type { Action, HandState } from '../engine/types.ts';
import { castOf, type Personality } from '../bots/personalities.ts';
import { Moods } from '../bots/mood.ts';

/**
 * Runs the tournament: seating, blinds, eliminations, and the loop that turns one decision at
 * a time into a stream of events for the audience.
 *
 * It does not decide anything itself. `decide` is injected, which is what lets the same loop
 * run random bots, rule-based bots and Jeff-backed bots without changing a line here.
 */

export interface DecisionRequest {
  state: HandState;
  /** Index within the hand, which is not the table seat once players have been eliminated. */
  seat: number;
  handNo: number;
  personality: Personality;
  mood: Mood;
  /** Hand seat index to display name, so a brain never has to know the seating map. */
  nameOf: (handSeat: number) => string;
}

export interface Decision {
  action: Action;
  thought: { text: string; source: 'llm' | 'template' } | null;
}

/**
 * Everything the director needs from the bots. Keeping it this narrow is what lets random
 * bots, rule-based bots and Jeff-backed bots share one loop.
 */
export interface Brain {
  decide(request: DecisionRequest): Promise<Decision>;
  /** Public information only - called once per hand so opponent notes can be updated. */
  onHandFinished?(state: HandState, nameOf: (handSeat: number) => string): void;
  /** Queue depth, latencies and fallback counters, for /api/debug. */
  stats?(): Record<string, unknown>;
}

interface Player {
  seat: number;
  personality: Personality;
  stack: number;
  mood: Mood;
  thought: string | null;
  place: number | null;
}

const LOG_LIMIT = 200;

export class Director {
  #config: Config;
  #hub: Hub;
  #brain: Brain;
  #pacer: Pacer;
  #moods: Moods;

  #epoch = 0;
  #seed: string;
  #players: Player[] = [];
  #button = 0;
  #handNo = 0;
  #level = 0;
  #log: LogLine[] = [];
  #finished = false;
  #running = false;

  /** The hand in progress, kept only so a reconnecting viewer can be handed the current table. */
  #hand: HandState | null = null;
  #thinking: number | null = null;
  #equities = new Map<number, number>();

  constructor(config: Config, hub: Hub, brain: Brain) {
    this.#config = config;
    this.#hub = hub;
    this.#brain = brain;
    this.#seed = config.seed;
    this.#pacer = new Pacer(config.pacing.speed);
    this.#moods = new Moods(config.mood.driftChancePerHand, config.mood.decayHands);
    this.#seatPlayers();
  }

  get pacer(): Pacer {
    return this.#pacer;
  }

  /**
   * PROJECT.md section 16 asks for measured resource use. On a machine where a decision costs
   * about four seconds, "is Jeff actually answering, or has everything quietly fallen back to
   * the rule bot?" is the question you want answerable without reading logs.
   */
  debug(): Record<string, unknown> {
    return {
      seed: this.#seed,
      epoch: this.#epoch,
      handNo: this.#handNo,
      speed: this.#pacer.speed,
      paused: this.#pacer.paused,
      bots: this.#brain.stats?.() ?? 'not reported',
      memory: {
        rssMb: Math.round(Deno.memoryUsage().rss / 1024 / 1024),
        heapMb: Math.round(Deno.memoryUsage().heapUsed / 1024 / 1024),
      },
    };
  }

  #seatPlayers(): void {
    this.#players = castOf(this.#config.table.players).map((personality, seat) => ({
      seat,
      personality,
      stack: this.#config.table.startingChips,
      mood: personality.defaultMood,
      thought: null,
      place: null,
    }));
    this.#button = 0;
    this.#handNo = 0;
    this.#level = 0;
    this.#log = [];
    this.#finished = false;
    this.#hand = null;
    this.#thinking = null;
    this.#equities.clear();
    this.#moods?.reset();
  }

  // --- blinds ---------------------------------------------------------------------------

  #blinds(): [number, number] {
    const schedule = this.#config.table.blindSchedule;
    return schedule[Math.min(this.#level, schedule.length - 1)];
  }

  #levelFor(handNo: number): number {
    return Math.floor((handNo - 1) / this.#config.table.handsPerLevel);
  }

  // --- the view the audience gets -------------------------------------------------------

  /**
   * Pots as the audience should see them. buildPots layers by commitment level, so mid-street
   * it reports several "pots" whenever players are simply in for different amounts. Those are
   * not side pots and showing them is just confusing: real side pots only exist once someone
   * is all-in, so below that they collapse into one number.
   */
  #pots(): PotView[] {
    if (!this.#hand) return [];
    const layers = buildPots(this.#hand.seats).map((pot) => ({ amount: pot.amount, eligible: pot.eligible }));
    const anyAllIn = this.#hand.seats.some((seat) => seat.allIn);
    if (anyAllIn || layers.length <= 1) return layers;
    const total = layers.reduce((sum, pot) => sum + pot.amount, 0);
    return [{ amount: total, eligible: layers[0].eligible }];
  }

  snapshot(): Snapshot {
    const hand = this.#hand;
    const [smallBlind, bigBlind] = this.#blinds();
    const seatCount = this.#players.length;

    const smallBlindSeat = hand ? (seatCount === 2 ? hand.button : (hand.button + 1) % seatCount) : -1;
    const bigBlindSeat = hand
      ? (seatCount === 2 ? (hand.button + 1) % seatCount : (hand.button + 2) % seatCount)
      : -1;

    return {
      epoch: this.#epoch,
      seed: this.#seed,
      handNo: this.#handNo,
      level: this.#level,
      smallBlind,
      bigBlind,
      street: hand?.street ?? 'preflop',
      board: hand?.board ?? [],
      pots: this.#pots(),
      potTotal: hand ? potSize(hand) : 0,
      seats: this.#players.map((player) => {
        const seat = hand?.seats[player.seat];
        const inHand = Boolean(seat) && player.place === null;
        return {
          seat: player.seat,
          id: player.personality.id,
          name: player.personality.name,
          avatar: player.personality.avatar,
          stack: player.stack,
          streetBet: seat?.street ?? 0,
          status: player.place !== null
            ? 'out' as const
            : seat?.folded
            ? 'folded' as const
            : seat?.allIn
            ? 'allin' as const
            : 'active' as const,
          hole: inHand && seat?.hole ? seat.hole : null,
          mood: player.mood,
          thought: player.thought,
          isButton: hand ? hand.button === player.seat : false,
          isSmallBlind: smallBlindSeat === player.seat,
          isBigBlind: bigBlindSeat === player.seat,
          thinking: this.#thinking === player.seat,
          equity: this.#equities.get(player.seat) ?? null,
          place: player.place,
        };
      }),
      log: this.#log.slice(-40),
      speed: this.#pacer.speed,
      paused: this.#pacer.paused,
      finished: this.#finished,
    };
  }

  #emit(event: ServerEvent): void {
    this.#hub.emit(event);
  }

  #note(text: string): void {
    this.#log.push({ handNo: this.#handNo, text });
    if (this.#log.length > LOG_LIMIT) this.#log.shift();
  }

  // --- controls -------------------------------------------------------------------------

  pause(): void {
    this.#pacer.pause();
    this.#emit({ type: 'paused' });
  }

  resume(): void {
    this.#pacer.resume();
    this.#emit({ type: 'resumed' });
  }

  setSpeed(speed: Speed): void {
    this.#pacer.setSpeed(speed);
    this.#emit({ type: 'speed_changed', speed });
  }

  /** Abandons the current tournament and starts a new one. Safe to call while paused. */
  restart(seed?: string): void {
    this.#seed = seed || `seed-${Date.now().toString(36)}`;
    this.#epoch++;
    this.#running = false;
    this.#pacer.cancel();
    this.#pacer.resume();
    this.#seatPlayers();
    this.#hub.clearHistory();
    this.#emit({ type: 'reset', epoch: this.#epoch, seed: this.#seed });
    this.#emit({ type: 'snapshot', snapshot: this.snapshot() });
    queueMicrotask(() => void this.run());
  }

  // --- the loop -------------------------------------------------------------------------

  async run(): Promise<void> {
    if (this.#running) return;
    this.#running = true;
    const epoch = this.#epoch;

    try {
      while (this.#running && this.#epoch === epoch && this.#players.filter((p) => p.stack > 0).length > 1) {
        await this.#playHand(epoch);
      }
      if (this.#epoch === epoch && this.#running) this.#finish();
    } catch (error) {
      if (error instanceof Cancelled) return; // a restart cancelled us; the new run takes over
      logger.error('director stopped', { error: error instanceof Error ? error.message : String(error) });
    } finally {
      if (this.#epoch === epoch) this.#running = false;
    }
  }

  #finish(): void {
    // Whoever is left standing takes first place.
    const survivor = this.#players.find((player) => player.stack > 0 && player.place === null);
    if (survivor) survivor.place = 1;
    this.#finished = true;
    this.#note('tournament over');
    this.#emit({ type: 'tournament_finished' });
    logger.info('tournament finished', { seed: this.#seed, hands: this.#handNo });
  }

  async #playHand(epoch: number): Promise<void> {
    this.#handNo++;

    const level = this.#levelFor(this.#handNo);
    if (level !== this.#level) {
      this.#level = level;
      const [smallBlind, bigBlind] = this.#blinds();
      this.#note(`blinds up to ${smallBlind}/${bigBlind}`);
      this.#emit({ type: 'blinds_increased', level, smallBlind, bigBlind });
    }

    const contenders = this.#players.filter((player) => player.stack > 0);
    if (contenders.length < 2) return;

    // The button moves to the next seat that still has chips.
    this.#button = this.#nextLiveSeat(this.#button);

    const [smallBlind, bigBlind] = this.#blinds();
    const seatIds = this.#players.map((player) => player.personality.id);
    const rng = makeRng(this.#seed, `deck:h${this.#handNo}`);

    // Only players with chips are dealt in. Seat indices in the hand are compacted, so this
    // map keeps the audience-facing seat number stable across eliminations.
    const dealtIn = contenders.map((player) => player.seat);
    const toTableSeat = (handSeat: number) => dealtIn[handSeat];
    const buttonInHand = dealtIn.indexOf(this.#button);

    let { state } = startHand({
      handNo: this.#handNo,
      button: buttonInHand < 0 ? 0 : buttonInHand,
      sb: smallBlind,
      bb: bigBlind,
      players: contenders.map((player) => ({ id: seatIds[player.seat], stack: player.stack })),
    }, rng);

    this.#hand = state;
    for (const player of this.#players) player.thought = null;
    const stacksBefore = new Map(contenders.map((player) => [player.seat, player.stack]));

    this.#note(`hand ${this.#handNo}`);
    this.#emit({
      type: 'hand_started',
      handNo: this.#handNo,
      button: this.#button,
      smallBlind,
      bigBlind,
    });
    this.#emit({
      type: 'cards_dealt',
      hands: state.seats.map((seat, index) => ({ seat: toTableSeat(index), hole: seat.hole as [Card, Card] })),
    });
    this.#syncStacks(state, toTableSeat);
    this.#emitPot(state);
    this.#updateEquities(state, toTableSeat);

    while (!state.complete) {
      await this.#pacer.gate();
      // A restart cannot interrupt an in-flight model call, so re-check before every turn.
      if (this.#epoch !== epoch) return;

      if (state.toAct === null) {
        const step = advance(state);
        state = step.state;
        this.#hand = state;
        for (const event of step.events) {
          if (event.type === 'board') {
            this.#emit({ type: 'board_dealt', street: event.street, cards: event.cards });
            this.#note(`${event.street}: ${event.cards.length} card${event.cards.length > 1 ? 's' : ''}`);
            this.#updateEquities(state, toTableSeat);
            await this.#pacer.beat('street');
          } else if (event.type === 'showdown') {
            this.#emit({
              type: 'showdown',
              reveals: event.reveals.map((reveal) => ({
                seat: toTableSeat(reveal.seat),
                hole: reveal.hole,
                hand: describe(reveal.score),
              })),
              awards: event.awards.map((award) => ({ seat: toTableSeat(award.seat), amount: award.amount })),
            });
            for (const award of event.awards) {
              const name = this.#players[toTableSeat(award.seat)].personality.name;
              this.#note(`${name} wins ${award.amount}`);
            }
            this.#syncStacks(state, toTableSeat);
            await this.#pacer.beat('showdown');
          } else if (event.type === 'hand_finished') {
            this.#syncStacks(state, toTableSeat);
            const awards = event.awards.map((award) => ({ seat: toTableSeat(award.seat), amount: award.amount }));
            this.#emit({ type: 'hand_finished', handNo: this.#handNo, awards });
            // A showdown has already announced its winners; this line is for the far more
            // common case where everyone folded and no hand was ever shown.
            const shown = state.seats.filter((seat) => !seat.folded).length > 1;
            if (!shown) {
              for (const award of awards) {
                this.#note(`${this.#players[award.seat].personality.name} takes ${award.amount}`);
              }
            }
          }
        }
        continue;
      }

      state = await this.#takeTurn(state, toTableSeat);
      this.#hand = state;
    }

    this.#syncStacks(state, toTableSeat);
    this.#brain.onHandFinished?.(state, (index) => this.#players[toTableSeat(index)].personality.name);
    this.#updateMoods(state, toTableSeat, stacksBefore);
    this.#eliminate();
    this.#equities.clear();
    await this.#pacer.beat('handEnd');
  }

  async #takeTurn(state: HandState, toTableSeat: (handSeat: number) => number): Promise<HandState> {
    const handSeat = state.toAct!;
    const tableSeat = toTableSeat(handSeat);
    const player = this.#players[tableSeat];

    this.#thinking = tableSeat;
    this.#emit({ type: 'player_thinking', seat: tableSeat });

    const startedAt = performance.now();
    let decision: Decision;
    try {
      decision = await this.#brain.decide({
        state,
        seat: handSeat,
        handNo: this.#handNo,
        personality: player.personality,
        mood: player.mood,
        nameOf: (index) => this.#players[toTableSeat(index)].personality.name,
      });
    } finally {
      this.#thinking = null;
    }

    // A fast decision still gets a visible pause; a slow one has already paid for it.
    await this.#pacer.untilAtLeast(startedAt, 'think');

    if (decision.thought && this.#pacer.speed !== 'turbo') {
      player.thought = decision.thought.text;
      this.#emit({
        type: 'player_thought',
        seat: tableSeat,
        text: decision.thought.text,
        source: decision.thought.source,
      });
      await this.#pacer.beat('thought');
    }

    const legal = legalActions(state);
    let action = decision.action;
    if (!isLegal(legal, action)) {
      logger.warn('illegal action from decider', { seat: tableSeat, action });
      action = legal.canCheck ? { kind: 'check' } : { kind: 'fold' };
    }

    const step = applyAction(state, action);
    const next = step.state;
    const seat = next.seats[handSeat];

    this.#emit({
      type: 'player_action',
      seat: tableSeat,
      kind: action.kind,
      paid: seat.hand - state.seats[handSeat].hand,
      to: seat.street,
      stackAfter: seat.stack,
      allIn: seat.allIn,
    });
    this.#note(`${player.personality.name} ${describeAction(action, seat.street)}`);
    this.#syncStacks(next, toTableSeat);
    this.#emitPot(next);
    await this.#pacer.beat('action');

    return next;
  }

  #emitPot(state: HandState): void {
    this.#emit({ type: 'pot_updated', pots: this.#pots(), total: potSize(state) });
  }

  /** Audience-only win chances, like the bars on televised poker. Bots never see these. */
  #updateEquities(state: HandState, toTableSeat: (handSeat: number) => number): void {
    const live = state.seats.map((seat, index) => ({ seat, index })).filter(({ seat }) => !seat.folded);
    if (live.length < 2) {
      this.#equities.clear();
      return;
    }
    const equities: { seat: number; equity: number }[] = [];
    for (const { seat, index } of live) {
      const rng = makeRng(this.#seed, `audience:h${this.#handNo}:${state.street}:${index}`);
      const { share } = estimateEquity(seat.hole!, state.board, live.length - 1, this.#config.equity.samples, rng);
      this.#equities.set(toTableSeat(index), share);
      equities.push({ seat: toTableSeat(index), equity: share });
    }
    this.#emit({ type: 'equity_updated', equities });
  }

  #updateMoods(
    state: HandState,
    toTableSeat: (handSeat: number) => number,
    stacksBefore: Map<number, number>,
  ): void {
    const [, bigBlind] = this.#blinds();
    const winners = new Set(state.awards.map((award) => award.seat));

    for (let index = 0; index < state.seats.length; index++) {
      const tableSeat = toTableSeat(index);
      const player = this.#players[tableSeat];
      const seat = state.seats[index];
      const before = stacksBefore.get(tableSeat) ?? seat.stack;

      // A bluff got through only if the pot was taken without anyone seeing the hand.
      const shown = state.seats.filter((candidate) => !candidate.folded).length > 1;
      const wonWithBluff = winners.has(index) && !shown &&
        state.history.some((action) => action.id === seat.id && (action.kind === 'bet' || action.kind === 'raise'));

      const changed = this.#moods.update(player.personality, {
        stackBefore: before,
        stackAfter: seat.stack,
        bigBlind,
        foldedEarly: seat.folded && seat.hand <= bigBlind,
        wonWithBluff,
      }, makeRng(this.#seed, `mood:h${this.#handNo}:${player.personality.id}`));

      if (changed) {
        const from = player.mood;
        player.mood = changed.mood;
        this.#emit({ type: 'mood_changed', seat: tableSeat, from, to: changed.mood, reason: changed.reason });
        this.#note(`${player.personality.name} is ${changed.mood} - ${changed.reason}`);
      }
    }
  }

  #syncStacks(state: HandState, toTableSeat: (handSeat: number) => number): void {
    for (let index = 0; index < state.seats.length; index++) {
      this.#players[toTableSeat(index)].stack = state.seats[index].stack;
    }
  }

  #eliminate(): void {
    const remaining = this.#players.filter((player) => player.place === null).length;
    let place = remaining;
    for (const player of this.#players) {
      if (player.place !== null || player.stack > 0) continue;
      player.place = place--;
      this.#note(`${player.personality.name} is out in ${ordinal(player.place)}`);
      this.#emit({ type: 'player_eliminated', seat: player.seat, place: player.place });
    }
    // `place` counted down from the number still in, so busting two players at once gives them
    // distinct places; the survivor's first place is assigned when the tournament ends.
  }

  #nextLiveSeat(from: number): number {
    const count = this.#players.length;
    for (let step = 1; step <= count; step++) {
      const index = (from + step) % count;
      if (this.#players[index].stack > 0) return index;
    }
    return from;
  }
}

function isLegal(legal: ReturnType<typeof legalActions>, action: Action): boolean {
  switch (action.kind) {
    case 'fold':
      return legal.canFold;
    case 'check':
      return legal.canCheck;
    case 'call':
      return legal.call !== null;
    case 'bet':
    case 'raise':
      return legal.aggress !== null &&
        typeof action.amount === 'number' &&
        action.amount >= legal.aggress.min &&
        action.amount <= legal.aggress.max;
  }
}

function describeAction(action: Action, to: number): string {
  switch (action.kind) {
    case 'fold':
      return 'folds';
    case 'check':
      return 'checks';
    case 'call':
      return `calls ${to}`;
    case 'bet':
      return `bets ${action.amount}`;
    case 'raise':
      return `raises to ${action.amount}`;
  }
}

function ordinal(n: number): string {
  // 11th, 12th and 13th are the exceptions that make the naive version wrong.
  const teens = n % 100;
  if (teens >= 11 && teens <= 13) return `${n}th`;
  return `${n}${['th', 'st', 'nd', 'rd'][n % 10] ?? 'th'}`;
}
