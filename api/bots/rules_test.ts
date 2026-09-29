import { assert } from 'jsr:@std/assert@1';
import { simulate } from '../../scripts/simulate.ts';

/**
 * PROJECT.md section 18 requires each bot's behaviour to be visibly distinct. That is not a
 * thing you can eyeball reliably, so it is measured: play real tournaments and compare the
 * numbers.
 *
 * The bounds are deliberately generous - this is guarding against the personalities quietly
 * collapsing into one another, which is what happened when the rule bot compared win chance
 * against an absolute threshold. Six-handed, every hand averages a one-in-six share, so an
 * absolute cutoff folded everything preflop for everybody and the six bots played identically.
 */
Deno.test('the personalities are measurably different', async () => {
  const tallies = await simulate(2, 'personality-test');

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
});
