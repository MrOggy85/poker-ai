import { assert } from 'jsr:@std/assert@1';
import { simulate } from '../../scripts/simulate.ts';

/**
 * Each bot's behaviour has to be visibly distinct - an acceptance criterion. That is not a
 * thing you can eyeball reliably, so it is measured: play real tournaments and compare the
 * numbers.
 *
 * The bounds are deliberately generous - this is guarding against the personalities quietly
 * collapsing into one another, which is what happened when the rule bot compared win chance
 * against an absolute threshold. Six-handed, every hand averages a one-in-six share, so an
 * absolute cutoff folded everything preflop for everybody and the six bots played identically.
 */
Deno.test('the personalities are measurably different', async () => {
  const { tallies, handsPerTournament } = await simulate(2, 'personality-test');

  const vpip = (id: string) => {
    const entry = tallies.get(id)!;
    return entry.voluntary / entry.handsDealt;
  };
  const aggression = (id: string) => {
    const entry = tallies.get(id)!;
    return entry.aggressive / entry.decisions;
  };
  const calling = (id: string) => {
    const entry = tallies.get(id)!;
    return entry.call / entry.decisions;
  };

  assert(
    vpip('maniac') > vpip('rock') + 0.2,
    `the maniac should play far more hands than the rock: ${vpip('maniac')} vs ${vpip('rock')}`,
  );
  assert(
    vpip('station') > vpip('rookie'),
    `the calling station should play more hands than the rookie: ${vpip('station')} vs ${vpip('rookie')}`,
  );
  assert(
    aggression('maniac') > aggression('station') + 0.15,
    `the maniac should raise far more than the calling station: ${aggression('maniac')} vs ${aggression('station')}`,
  );
  assert(
    calling('station') > calling('rock'),
    `the calling station should call more than the rock: ${calling('station')} vs ${calling('rock')}`,
  );
  assert(aggression('rookie') < 0.15, `the rookie should rarely be aggressive: ${aggression('rookie')}`);

  // A tournament that ends in a few hands means everyone is shoving, which is both bad poker
  // and unwatchable. It happened for real once, so it is guarded.
  for (const hands of handsPerTournament) {
    assert(hands > 15, `a tournament lasted only ${hands} hands - the bots are shoving`);
  }
});
