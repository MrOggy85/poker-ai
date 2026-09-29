/**
 * How long does one inner monologue cost on this machine?
 *
 * The monologue is flavour, so the bar is different from Jeff's: if this is slow the game
 * falls back to template lines and nothing stalls. Still worth knowing.
 *
 *   deno run --allow-net --allow-env --allow-read scripts/bench-llm.ts [--runs 10]
 */
import { loadConfig } from '../api/config.ts';
import { report, timed } from './bench.ts';

const config = loadConfig();
const runs = Number(Deno.args[Deno.args.indexOf('--runs') + 1]) || 10;

const messages = [
  {
    role: 'system',
    content: 'You write one short inner thought in first person, in character. Never mention probabilities.',
  },
  {
    role: 'user',
    content:
      'Viktor is a reckless player who loves bluffing. His voice is sarcastic. He is tilted after ' +
      'losing a big pot. He just raised the full pot, because his hand is strong and Anna looks weak. ' +
      'Write his thought in at most 20 words.',
  },
];

async function once(): Promise<string> {
  const res = await fetch(`${config.monologue.url}/v1/chat/completions`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ messages, max_tokens: config.monologue.maxTokens, temperature: 0.9 }),
    signal: AbortSignal.timeout(120_000),
  });
  if (!res.ok) throw new Error(`${res.status} ${await res.text()}`);
  const body = await res.json();
  return (body.choices?.[0]?.message?.content ?? '').trim();
}

console.log(`monologue llm at ${config.monologue.url}, ${runs} runs`);

const timings: number[] = [];
const samples: string[] = [];
let failures = 0;

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
    const [ms, text] = await timed(once);
    timings.push(ms);
    samples.push(text);
  } catch (error) {
    failures++;
    console.error(`  run ${i + 1} failed: ${error instanceof Error ? error.message : error}`);
  }
}

report('monologue latency', timings, failures);
console.log('\n  samples:');
for (const line of samples.slice(0, 3)) console.log(`    ${line.replace(/\s+/g, ' ')}`);
