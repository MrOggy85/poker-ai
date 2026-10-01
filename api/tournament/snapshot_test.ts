import { assert, assertEquals } from 'jsr:@std/assert@1';
import { cardsToStrings } from '../../shared/cards.ts';
import { Hub } from '../broadcast/hub.ts';
import { loadConfig } from '../config.ts';
import { BotBrain } from '../bots/brain.ts';
import { Director, type Brain } from './director.ts';

/**
 * The snapshot has to describe the right player in the right seat.
 *
 * Only players with chips are dealt in, so the engine's seat array is compacted while the table
 * keeps every seat for the whole tournament. The snapshot used to index the engine's array by
 * table seat, which is correct right up until the first elimination and quietly wrong after it:
 * seats showed another player's cards, bets and blind markers. It survived review because
 * everything looks fine for the first few hands.
 */
Deno.test('the snapshot describes each seat correctly after eliminations', async () => {
  const config = loadConfig();
  config.seed = 'snapshot-seats';
  config.pacing.speed = 'turbo';
  config.pacing.idleWhenUnwatched = false;
  config.table.autoRestart = false;
  config.decision.enabled = false;
  config.monologue.enabled = false;

  let checks = 0;
  let checkedAfterElimination = 0;

  // The real brain, so the bots play differently from each other and the tournament resolves.
  // An earlier version of this test stubbed every bot's equity at a constant, which made all
  // six play identically and ran past 3,900 hands without an elimination.
  const real = new BotBrain(config);

  const brain: Brain = {
    async decide(request) {
      // The seat about to act, as the audience sees it, found by name so the test does not
      // reimplement the mapping it is checking.
      const name = request.nameOf(request.seat);
      const snapshot = director.snapshot();
      const shown = snapshot.seats.find((entry) => entry.name === name);
      const truth = request.state.seats[request.seat];

      assert(shown, `${name} is missing from the snapshot`);
      assertEquals(cardsToStrings(shown.hole ?? []), cardsToStrings(truth.hole!), `${name}'s cards`);
      assertEquals(shown.stack, truth.stack, `${name}'s stack`);
      assertEquals(shown.streetBet, truth.street, `${name}'s bet`);

      checks++;
      if (snapshot.seats.some((entry) => entry.place !== null)) checkedAfterElimination++;

      // Exactly one button, and it belongs to someone still in the hand.
      assertEquals(snapshot.seats.filter((entry) => entry.isButton).length, 1, 'exactly one button');

      return await real.decide(request);
    },
    onHandFinished: (state, nameOf) => real.onHandFinished(state, nameOf),
  };

  const director = new Director(config, new Hub(), brain);
  await director.run();

  assert(checks > 100, `expected a full tournament, got ${checks} decisions`);
  assert(
    checkedAfterElimination > 20,
    `expected plenty of checks after an elimination, got ${checkedAfterElimination}`,
  );
});
