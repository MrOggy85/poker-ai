/**
 * Runs the hand-written situations through the real prompt and option builders and reports
 * what each decision source does with them.
 *
 *   deno run -A scripts/sanity.ts --source rules
 *   deno run -A scripts/sanity.ts --source jeff
 *
 * Against `rules` this is pass/fail. Against `jeff` it is a report to tune wording by - see
 * fixtures/sanity.ts for why.
 */
import { makeRng } from '../shared/rng.ts';
import { SITUATIONS, type Situation } from '../fixtures/sanity.ts';
import { CAST } from '../api/bots/personalities.ts';
import { buildOptions } from '../api/bots/options.ts';
import { buildInstructions, buildState } from '../api/bots/prompt.ts';
import { ruleDecision } from '../api/bots/rules.ts';
import { estimateEquity } from '../api/engine/equity.ts';
import { loadConfig } from '../api/config.ts';
import { InferenceQueue } from '../api/inference/queue.ts';
import { JeffClient } from '../api/inference/decision.ts';
import { LogprobClient } from '../api/inference/logprob.ts';
import type { BotView } from '../api/bots/view.ts';

function viewFor(situation: Situation): BotView {
  const personality = CAST.find((entry) => entry.id === situation.personality)!;
  const equity = estimateEquity(
    situation.hole,
    situation.board,
    situation.live - 1,
    3000,
    makeRng('sanity', situation.id),
  );

  const maxTo = situation.toCall + situation.stack;
  const potAfterCall = situation.pot + situation.toCall;
  const betToMatch = situation.toCall;

  return {
    self: {
      seat: 0,
      name: personality.name,
      hole: situation.hole,
      stack: situation.stack,
      streetBet: 0,
      mood: situation.mood,
      personality,
    },
    table: {
      street: ['preflop', 'preflop', 'preflop', 'flop', 'turn', 'river'][situation.board.length] as BotView['table']['street'],
      board: situation.board,
      pot: situation.pot,
      toCall: situation.toCall,
      bigBlind: situation.bigBlind,
      opponents: Array.from({ length: situation.live - 1 }, (_, index) => ({
        seat: index + 1,
        name: CAST[(index + 1) % CAST.length].name,
        stack: situation.stack,
        streetBet: situation.toCall,
        status: 'active' as const,
        isButton: index === 0,
      })),
      recent: [],
      live: situation.live,
    },
    legal: {
      canFold: situation.toCall > 0,
      canCheck: situation.toCall === 0,
      call: situation.toCall > 0 ? { toAdd: Math.min(situation.toCall, situation.stack), allIn: situation.toCall >= situation.stack } : null,
      aggress: {
        kind: situation.toCall === 0 ? 'bet' : 'raise',
        min: Math.min(betToMatch + situation.bigBlind, maxTo),
        max: maxTo,
        potSized: Math.min(betToMatch + potAfterCall, maxTo),
        halfPot: Math.min(betToMatch + Math.round(potAfterCall / 2), maxTo),
      },
    },
    equity,
    notes: [],
  };
}

const source = Deno.args.includes('--source') ? Deno.args[Deno.args.indexOf('--source') + 1] : 'rules';
const config = loadConfig();
if (source === 'logprob') {
  config.decision.provider = 'logprob';
  config.decision.url = config.monologue.url;
}

const queue = new InferenceQueue();
const client = source === 'jeff'
  ? new JeffClient(config, queue)
  : source === 'logprob'
  ? new LogprobClient(config, queue)
  : null;

const timings: number[] = [];

let agreed = 0;
const failures: string[] = [];

for (const situation of SITUATIONS) {
  const view = viewFor(situation);
  const options = buildOptions(view);
  if (Deno.args.includes('--show')) {
    console.log(`\n=== ${situation.id} ===\n${buildState(view)}`);
    for (const option of options) console.log('   ', option.key, '-', option.text);
  }
  let chosen: string;
  let detail = '';

  if (client) {
    const criteria: Record<string, string> = {};
    for (const option of options) criteria[option.key] = option.text;
    const startedAt = performance.now();
    try {
      const answer = await client.ask({
        state: buildState(view),
        instructions: buildInstructions(view),
        criteria,
      });
      timings.push(performance.now() - startedAt);
      chosen = answer.choice;
      detail = `conf ${answer.confidence.toFixed(2)}`;
    } catch (error) {
      console.error(`${situation.id}: ${error instanceof Error ? error.message : error}`);
      continue;
    }
  } else {
    chosen = ruleDecision(view, makeRng('sanity', `rule:${situation.id}`)).key;
  }

  const ok = situation.expect.includes(chosen as never);
  if (ok) agreed++;
  else failures.push(`${situation.id}: got ${chosen}, expected ${situation.expect.join('/')} - ${situation.why}`);

  console.log(
    `${ok ? 'ok  ' : 'MISS'} ${situation.id.padEnd(28)} ${chosen.padEnd(3)} ` +
      `(expected ${situation.expect.join('/')}) equity ${(view.equity.share * 100).toFixed(0)}% ${detail}`,
  );
}

const median = timings.length === 0
  ? 0
  : [...timings].sort((a, b) => a - b)[Math.floor(timings.length / 2)];
console.log(
  `\n${agreed}/${SITUATIONS.length} sensible (${source})` +
    (median ? ` - median ${median.toFixed(0)} ms per decision` : ''),
);
for (const failure of failures) console.log(`  ${failure}`);
