import { assert, assertEquals } from 'jsr:@std/assert@1';
import { loadConfig } from '../config.ts';
import { Director } from '../tournament/director.ts';
import { Hub } from './hub.ts';
import type { Brain } from '../tournament/director.ts';
import { ruleDecision } from '../bots/rules.ts';
import { makeRng } from '../../shared/rng.ts';
import { buildBotView } from '../bots/view.ts';

/**
 * A tournament in progress costs about half this machine, sustained for hours, and most of the
 * time nobody is looking at it. The loop therefore holds until a browser connects - which is
 * only worth anything if it actually holds, hence this test.
 */

function instantBrain(): Brain {
  return {
    decide(request) {
      const view = buildBotView(request.state, request.seat, {
        personality: request.personality,
        mood: request.mood,
        equity: { win: 0.4, tie: 0, share: 0.4 },
        notes: [],
        nameOf: request.nameOf,
      });
      const { option } = ruleDecision(view, makeRng('idle', `${request.handNo}:${request.seat}`));
      return Promise.resolve({ action: option.action, thought: null });
    },
  };
}

Deno.test('the game does not run while nobody is watching', async () => {
  const config = loadConfig();
  config.seed = 'idle-test';
  config.pacing.speed = 'turbo';
  config.pacing.idleWhenUnwatched = true;
  config.table.autoRestart = false;
  config.decision.enabled = false;
  config.monologue.enabled = false;

  const hub = new Hub();
  const director = new Director(config, hub, instantBrain());
  void director.run();

  await new Promise((resolve) => setTimeout(resolve, 150));
  assertEquals(director.snapshot().handNo, 0, 'no hand should have started without an audience');

  // A viewer arrives: the same loop picks up where it was holding.
  const request = new Request('http://localhost/api/stream');
  const response = hub.subscribe(request, () => director.snapshot());
  const reader = response.body!.getReader();

  await new Promise((resolve) => setTimeout(resolve, 400));
  const playing = director.snapshot().handNo;
  assert(playing > 0, 'the game should start when someone connects');

  // And stops again when they leave.
  await reader.cancel();
  await new Promise((resolve) => setTimeout(resolve, 250));
  const atStop = director.snapshot().handNo;
  await new Promise((resolve) => setTimeout(resolve, 400));
  assertEquals(director.snapshot().handNo, atStop, 'the game should hold once the last viewer leaves');
});
