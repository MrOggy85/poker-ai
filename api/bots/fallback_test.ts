import { assert } from 'jsr:@std/assert@1';
import { Hub } from '../broadcast/hub.ts';
import { loadConfig } from '../config.ts';
import { Director } from '../tournament/director.ts';
import { BotBrain } from './brain.ts';

/**
 * The game must still work with Jeff unavailable and with the monologue model disabled. On a machine where a decision costs about four seconds and both models are
 * containers that can be stopped, this is an everyday condition rather than a disaster - so it
 * is tested as one, by running whole tournaments to a winner against a broken service.
 */

async function playThrough(label: string, handler: (request: Request) => Promise<Response> | Response) {
  const controller = new AbortController();
  const server = Deno.serve(
    { port: 0, signal: controller.signal, onListen: () => {} },
    handler,
  );
  const port = (server.addr as Deno.NetAddr).port;

  const config = loadConfig();
  config.seed = `fallback-${label}`;
  config.pacing.speed = 'turbo';
  config.pacing.idleWhenUnwatched = false;
  config.table.autoRestart = false;
  config.decision.enabled = true;
  config.decision.url = `http://127.0.0.1:${port}`;
  // Short, so a hanging service does not make the test take minutes.
  config.decision.timeoutMs = 150;
  config.decision.busyRetries = 1;
  config.monologue.enabled = false;

  const director = new Director(config, new Hub(), new BotBrain(config));
  await director.run();
  const snapshot = director.snapshot();

  controller.abort();
  await server.finished;

  assert(snapshot.finished, `${label}: the tournament did not finish`);
  const winners = snapshot.seats.filter((seat) => seat.place === 1);
  assert(winners.length === 1, `${label}: expected exactly one winner, got ${winners.length}`);
  const chips = snapshot.seats.reduce((sum, seat) => sum + seat.stack, 0);
  assert(chips === config.table.players * config.table.startingChips, `${label}: chips leaked`);
  return snapshot;
}

Deno.test('a tournament finishes when the decision service refuses every request', async () => {
  await playThrough('refused', () => new Response('nope', { status: 500 }));
});

Deno.test('a tournament finishes when the decision service is permanently busy', async () => {
  // Jeff answers one request at a time and rejects the rest with 529 + Retry-After: 1.
  await playThrough(
    'busy',
    () =>
      new Response(JSON.stringify({ detail: 'The model is busy. Retry shortly.' }), {
        status: 529,
        headers: { 'retry-after': '1', 'content-type': 'application/json' },
      }),
  );
});

Deno.test('a tournament finishes when the decision service hangs', async () => {
  await playThrough('hangs', () => new Promise<Response>(() => {}));
});

Deno.test('a tournament finishes with no models at all', async () => {
  const config = loadConfig();
  config.seed = 'fallback-none';
  config.pacing.speed = 'turbo';
  config.pacing.idleWhenUnwatched = false;
  config.table.autoRestart = false;
  config.decision.enabled = false;
  config.monologue.enabled = false;

  const director = new Director(config, new Hub(), new BotBrain(config));
  await director.run();
  assert(director.snapshot().finished);
});
