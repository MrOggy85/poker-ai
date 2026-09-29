import { makeRng } from '../../shared/rng.ts';
import { legalActions } from '../engine/betting.ts';
import type { Action } from '../engine/types.ts';
import type { Decide, Decision } from '../tournament/director.ts';

/**
 * A placeholder decider that picks a legal action at random, weighted just enough that hands
 * reach a showdown instead of everyone shoving every time.
 *
 * It exists so the table, the event stream and the client can be built and watched before any
 * model is involved. `bots/rules.ts` replaces it with something that plays recognisable poker;
 * both satisfy the same `Decide` signature that the Jeff-backed brain will.
 */
export function randomDecider(seed: string): Decide {
  return (request): Promise<Decision> => {
    const rng = makeRng(seed, `random:h${request.handNo}:${request.seat}:${request.state.history.length}`);
    const legal = legalActions(request.state);

    const choices: { action: Action; weight: number }[] = [];
    if (legal.canCheck) choices.push({ action: { kind: 'check' }, weight: 5 });
    if (legal.canFold) choices.push({ action: { kind: 'fold' }, weight: 3 });
    if (legal.call) choices.push({ action: { kind: 'call' }, weight: 6 });
    if (legal.aggress) {
      const { kind, min, halfPot, potSized, max } = legal.aggress;
      choices.push({ action: { kind, amount: halfPot }, weight: 3 });
      choices.push({ action: { kind, amount: potSized }, weight: 1 });
      choices.push({ action: { kind, amount: min }, weight: 1 });
      // All-in stays rare on purpose: at high weight every hand ends preflop and there is
      // nothing to look at.
      choices.push({ action: { kind, amount: max }, weight: 0.3 });
    }

    const total = choices.reduce((sum, choice) => sum + choice.weight, 0);
    let roll = rng.next() * total;
    let action: Action = { kind: 'fold' };
    for (const choice of choices) {
      roll -= choice.weight;
      if (roll <= 0) {
        action = choice.action;
        break;
      }
    }

    return Promise.resolve({ action, thought: null });
  };
}
