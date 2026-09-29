/**
 * Plays whole tournaments headlessly at turbo speed and reports how each bot behaved.
 *
 * This is the check behind "each bot's behaviour is visibly distinct" in PROJECT.md section
 * 18. Personality is supposed to come from the words, so it has to be measurable in the
 * actions - if The Rock and The Maniac produce similar numbers here, no amount of model
 * output will make them feel different on screen.
 *
 *   deno run -A scripts/simulate.ts [--tournaments 3] [--seed friday-night]
 */
import { Hub } from '../api/broadcast/hub.ts';
import { BotBrain } from '../api/bots/brain.ts';
import { loadConfig } from '../api/config.ts';
import { Director, type Brain, type Decision, type DecisionRequest } from '../api/tournament/director.ts';

export interface Tally {
  name: string;
  decisions: number;
  fold: number;
  check: number;
  call: number;
  aggressive: number;
  allIn: number;
  /** Hands where this bot put chips in voluntarily. */
  voluntary: number;
  /** Hands this bot was actually dealt into - the only correct VPIP denominator. */
  handsDealt: number;
  places: number[];
}

export async function simulate(
  tournaments: number,
  baseSeed: string,
): Promise<{ tallies: Map<string, Tally>; handsPerTournament: number[] }> {
const tallies = new Map<string, Tally>();
const handsPerTournament: number[] = [];

function tally(id: string, name: string): Tally {
  let entry = tallies.get(id);
  if (!entry) {
    entry = {
      name,
      decisions: 0,
      fold: 0,
      check: 0,
      call: 0,
      aggressive: 0,
      allIn: 0,
      voluntary: 0,
      handsDealt: 0,
      places: [],
    };
    tallies.set(id, entry);
  }
  return entry;
}

for (let run = 0; run < tournaments; run++) {
  const config = loadConfig();
  config.seed = `${baseSeed}-${run}`;
  config.pacing.speed = 'turbo';
  config.monologue.enabled = false;
  config.decision.enabled = false;

  const brain = new BotBrain(config);
  const voluntaryThisHand = new Set<string>();
  const dealtThisHand = new Set<string>();

  const counting: Brain = {
    async decide(request: DecisionRequest): Promise<Decision> {
      const decision = await brain.decide(request);
      const entry = tally(request.personality.id, request.personality.name);
      entry.decisions++;

      const { kind, amount } = decision.action;
      const seat = request.state.seats[request.seat];
      const allIn = typeof amount === 'number' && amount >= seat.street + seat.stack;

      if (kind === 'fold') entry.fold++;
      else if (kind === 'check') entry.check++;
      else if (kind === 'call') entry.call++;
      else entry.aggressive++;
      if (allIn) entry.allIn++;

      dealtThisHand.add(request.personality.id);
      if (kind !== 'fold' && kind !== 'check') voluntaryThisHand.add(request.personality.id);
      return decision;
    },
    onHandFinished(state) {
      brain.onHandFinished(state);
      for (const id of dealtThisHand) {
        const entry = tallies.get(id)!;
        entry.handsDealt++;
        if (voluntaryThisHand.has(id)) entry.voluntary++;
      }
      voluntaryThisHand.clear();
      dealtThisHand.clear();
    },
  };

  const director = new Director(config, new Hub(), counting);
  await director.run();
  handsPerTournament.push(director.snapshot().handNo);

  for (const seat of director.snapshot().seats) {
    tally(seat.id, seat.name).places.push(seat.place ?? 1);
  }
}

  return { tallies, handsPerTournament };
}

if (import.meta.main) {
  const arg = (name: string, fallback: string) => {
    const index = Deno.args.indexOf(`--${name}`);
    return index >= 0 ? Deno.args[index + 1] : fallback;
  };
  const tournaments = Number(arg('tournaments', '3'));
  const { tallies, handsPerTournament } = await simulate(tournaments, arg('seed', 'sim'));

  const pct = (part: number, whole: number) => whole === 0 ? '   -' : `${((part / whole) * 100).toFixed(0).padStart(3)}%`;

  const totalHands = handsPerTournament.reduce((a, b) => a + b, 0);
  // A tournament that ends in a handful of hands is the loudest possible signal that the bots
  // are shoving every pot - it is the thing to look at first.
  console.log(
    `\n${tournaments} tournaments, ${totalHands} hands ` +
      `(${(totalHands / tournaments).toFixed(0)} per tournament, shortest ${Math.min(...handsPerTournament)})\n`,
  );
  console.log('bot                  vpip  fold  check  call  aggr  allin   avg place');
  console.log('-'.repeat(72));

  for (const entry of [...tallies.values()].sort((a, b) => b.voluntary / b.handsDealt - a.voluntary / a.handsDealt)) {
    const place = entry.places.reduce((sum, p) => sum + p, 0) / Math.max(1, entry.places.length);
    console.log(
      entry.name.padEnd(22) +
        pct(entry.voluntary, entry.handsDealt) + '  ' +
        pct(entry.fold, entry.decisions) + '  ' +
        pct(entry.check, entry.decisions) + '  ' +
        pct(entry.call, entry.decisions) + '  ' +
        pct(entry.aggressive, entry.decisions) + '  ' +
        pct(entry.allIn, entry.decisions) + '     ' +
        place.toFixed(1),
    );
  }
}
