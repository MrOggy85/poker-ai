import { assert, assertEquals } from 'jsr:@std/assert@1';
import { parseDistribution } from './logprob.ts';

const body = (entries: [string, number][]) => ({
  completion_probabilities: [{ top_logprobs: entries.map(([token, p]) => ({ token, logprob: Math.log(p) })) }],
});

Deno.test('reads a distribution over the answer letters', () => {
  const answer = parseDistribution(body([[' A', 0.6], [' B', 0.3], [' C', 0.05]]), ['F', 'C', 'R']);
  assertEquals(answer.choice, 'F');
  assert(answer.probabilities.F > answer.probabilities.C);
  assert(Math.abs(Object.values(answer.probabilities).reduce((a, b) => a + b, 0) - 1) < 1e-9);
});

Deno.test('ignores everything the model would rather have said', () => {
  // A base model asked a multiple-choice question often wants to write prose instead.
  const answer = parseDistribution(
    body([['The', 0.5], ['\n', 0.2], [' B', 0.2], [' A', 0.1]]),
    ['F', 'C'],
  );
  assertEquals(answer.choice, 'C', 'B maps to the second option, whatever else was on offer');
});

Deno.test('a letter inside a longer token is not an answer', () => {
  // ' Apple' starts with A but is not the model answering A.
  const answer = parseDistribution(body([[' Apple', 0.9], [' B', 0.05]]), ['F', 'C']);
  assertEquals(answer.choice, 'C');
});

Deno.test('every option stays reachable by the sampler', () => {
  const answer = parseDistribution(body([[' A', 0.99]]), ['F', 'C', 'R']);
  assert(answer.probabilities.C > 0, 'an option the model never considered must still be possible');
  assert(answer.probabilities.R > 0);
});

Deno.test('confidence is chance-corrected, so uniform means no opinion', () => {
  const uniform = parseDistribution(body([[' A', 0.25], [' B', 0.25], [' C', 0.25], [' D', 0.25]]), [
    'F',
    'C',
    'R',
    'A',
  ]);
  assert(uniform.confidence < 0.01, `expected ~0, got ${uniform.confidence}`);

  const certain = parseDistribution(body([[' A', 1.0]]), ['F', 'C', 'R', 'A']);
  assert(certain.confidence > 0.9, `expected ~1, got ${certain.confidence}`);
});
