import { assert, assertEquals } from 'jsr:@std/assert@1';
import type { Card } from '../../shared/cards.ts';
import { makeRng } from '../../shared/rng.ts';
import { Hub } from '../broadcast/hub.ts';
import { loadConfig } from '../config.ts';
import { startHand } from '../engine/engine.ts';
import { Director, type Brain, type DecisionRequest } from '../tournament/director.ts';
import { BotBrain } from './brain.ts';
import { CAST } from './personalities.ts';
import { buildBotView } from './view.ts';

/**
 * PROJECT.md section 10: a bot may never see another player's hole cards, mood or inner
 * monologue. The type system does most of the work - `BotView` has no field that could carry
 * them - but a test has to prove it end to end, because the leak that matters is the one
 * somebody adds later.
 */

/**
 * Every card code anywhere in a view, found structurally rather than by searching the JSON
 * text. Substring matching looked tempting and was wrong twice over: card strings collide
 * with ordinary keys ("toAdd" contains "Ad"), and single-digit card codes collide with every
 * other number in the object.
 */
function cardsIn(value: unknown, path: string[] = []): Card[] {
  if (typeof value === 'number') {
    const field = path[path.length - 1];
    const parent = path[path.length - 2];
    const isCard = parent === 'hole' || parent === 'board' || field === 'hole' || field === 'board';
    return isCard ? [value] : [];
  }
  if (Array.isArray(value)) return value.flatMap((entry, index) => cardsIn(entry, [...path, String(index)]));
  if (value && typeof value === 'object') {
    return Object.entries(value).flatMap(([key, entry]) => cardsIn(entry, [...path, key]));
  }
  return [];
}

Deno.test('a bot view contains its own cards and nobody else\'s', () => {
  const rng = makeRng('hiding', 'deck:h1');
  const { state } = startHand({
    handNo: 1,
    button: 0,
    sb: 50,
    bb: 100,
    players: CAST.map((personality) => ({ id: personality.id, stack: 10_000 })),
  }, rng);

  const view = buildBotView(state, 3, {
    personality: CAST[3],
    mood: 'calm',
    equity: { win: 0.5, tie: 0, share: 0.5 },
    notes: [],
    nameOf: (index) => CAST[index].name,
  });

  assertEquals(view.self.hole, state.seats[3].hole);
  assertEquals(cardsIn(view).sort(), [...view.self.hole, ...view.table.board].sort());
});

Deno.test('nothing a bot is told during a whole tournament mentions another hand', async () => {
  const config = loadConfig();
  config.seed = 'hiding-e2e';
  config.pacing.speed = 'turbo';
  config.decision.enabled = false;
  config.monologue.enabled = false;

  const brain = new BotBrain(config);

  // Every view any bot is built, kept with the cards it was legitimately allowed to see.
  const seen: { allowed: Card[]; exposed: Card[] }[] = [];
  const thoughts: string[] = [];

  const recording: Brain = {
    async decide(request: DecisionRequest) {
      const view = buildBotView(request.state, request.seat, {
        personality: request.personality,
        mood: request.mood,
        equity: { win: 0, tie: 0, share: 0.5 },
        notes: [],
        nameOf: request.nameOf,
      });
      seen.push({
        allowed: [...request.state.seats[request.seat].hole!, ...request.state.board],
        exposed: cardsIn(view),
      });

      const decision = await brain.decide(request);
      if (decision.thought) thoughts.push(decision.thought.text);
      return decision;
    },
    onHandFinished: (state, nameOf) => brain.onHandFinished(state, nameOf),
  };

  const director = new Director(config, new Hub(), recording);
  await director.run();

  assert(seen.length > 100, `expected a full tournament of decisions, got ${seen.length}`);

  for (const record of seen) {
    for (const card of record.exposed) {
      assert(
        record.allowed.includes(card),
        `a bot was shown card ${card}, which is neither its own nor on the board`,
      );
    }
  }

  // Monologues are audience-only. None of them may name a card at all, which is the simplest
  // sufficient check: a thought that mentions no card cannot leak one into a note.
  for (const thought of thoughts) {
    assert(!/\b[2-9TJQKA][cdhs]\b/.test(thought), `a monologue named a card: ${thought}`);
  }
  assertEquals(typeof thoughts[0], 'string');
});
