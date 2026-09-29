import type { Rng } from '../../shared/rng.ts';

/**
 * Turning Jeff's probabilities into a choice.
 *
 * Never just take the top option: a classifier that always plays its favourite line makes six
 * bots that play the same line. Reshaping by temperature is what produces bluffs, mistakes and
 * variety - low for The Rock and The Shark, high for The Maniac.
 *
 * Temperature is deliberately the *only* knob applied to the distribution. Everything that
 * makes a bot itself lives in the words of the state text. Reweighting particular options per
 * personality would move poker logic into the sampler, where it is invisible and untestable.
 */
export function sample(
  probabilities: Record<string, number>,
  temperature: number,
  rng: Rng,
  allowed: readonly string[],
): string {
  const keys = allowed.filter((key) => key in probabilities);
  if (keys.length === 0) throw new Error('jeff returned no probability for any legal option');

  const t = Math.max(0.05, temperature);
  const weights = keys.map((key) => Math.pow(Math.max(0, probabilities[key]), 1 / t));
  const total = weights.reduce((sum, weight) => sum + weight, 0);

  // Every legal option came back at zero. Rare, but falling over here would be absurd.
  if (!(total > 0)) return rng.pick(keys);

  let roll = rng.next() * total;
  for (let index = 0; index < keys.length; index++) {
    roll -= weights[index];
    if (roll <= 0) return keys[index];
  }
  return keys[keys.length - 1];
}
