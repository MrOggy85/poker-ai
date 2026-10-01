/**
 * How long does one poker decision actually cost on this machine?
 *
 * This was specified for an Apple Silicon MacBook, where Jeff answers in ~28 ms on the MLX
 * backend. Here it is PyTorch on four N100 cores. Jeff's own README reports 463 ms on 32
 * threads, so the honest expectation is seconds - and whether it is 2 s or 20 s decides
 * whether Jeff sits in the hot path or only answers the interesting decisions.
 *
 *   deno run --allow-net --allow-env --allow-read scripts/bench-jeff.ts [--runs 10]
 */
import { loadConfig } from '../api/config.ts';
import { report, timed } from './bench.ts';

const config = loadConfig();
const runs = Number(Deno.args[Deno.args.indexOf('--runs') + 1]) || 10;

// Deliberately the shape the real game sends: a few sentences of state and five worded
// options. Benchmarking a toy prompt would flatter the numbers - input length is most of
// the cost for a one-pass classifier.
const request = {
  model: config.decision.model,
  state:
    'You are Viktor, a reckless player who loves bluffing. Mood: tilted, you just lost a big pot. ' +
    'Your hand is strong, probably ahead. The flop is out. Anna raised; she plays very tight. ' +
    'Calling is cheap compared to the pot. You have a medium stack.',
  questions: {
    action: {
      type: 'choice',
      instructions: 'What does Viktor do now?',
      criteria: {
        '1': 'Fold: lose nothing more, give up the pot',
        '2': 'Call: stay in and see the next card',
        '3': 'Raise half the pot: put some pressure on Anna',
        '4': 'Raise the full pot: big pressure, risk many chips',
        '5': 'All-in: risk everything to win the pot now',
      },
    },
  },
};

async function once(): Promise<string> {
  const res = await fetch(`${config.decision.url}/v1/systemone`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(request),
    signal: AbortSignal.timeout(120_000),
  });
  if (!res.ok) throw new Error(`${res.status} ${await res.text()}`);
  const body = await res.json();
  return JSON.stringify(body.answers?.action ?? body);
}

console.log(`jeff at ${config.decision.url}, ${runs} runs`);

const timings: number[] = [];
let failures = 0;
let sample = '';

// The first call pays for lazy initialisation, so it is reported but excluded.
try {
  const [warm] = await timed(once);
  console.log(`  warmup    ${warm.toFixed(0)} ms (excluded)`);
} catch (error) {
  console.error(`  unreachable: ${error instanceof Error ? error.message : error}`);
  console.error('  start it with `make models-up`');
  Deno.exit(1);
}

for (let i = 0; i < runs; i++) {
  try {
    const [ms, answer] = await timed(once);
    timings.push(ms);
    sample = answer;
  } catch (error) {
    failures++;
    console.error(`  run ${i + 1} failed: ${error instanceof Error ? error.message : error}`);
  }
}

report('decision latency', timings, failures);
console.log(`\n  sample answer: ${sample}`);
