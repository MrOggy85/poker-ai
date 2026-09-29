import type { Config } from '../config.ts';
import logger from '../logger.ts';
import type { DecisionAnswer, DecisionAsk, DecisionClient } from './decision.ts';
import type { InferenceQueue } from './queue.ts';

/**
 * A decision client built from any plain LLM's log-probabilities.
 *
 * Ask a multiple-choice question, generate exactly one token, and read the probability of each
 * answer letter instead of parsing generated text. That is the same shape as Jeff - one
 * forward pass, a probability per caller-supplied option - without a purpose-trained model.
 * The difference is that Jeff was fine-tuned for it and calibrated; this is whatever the base
 * model happens to think.
 *
 * The point of it here is that it reuses the monologue model, which is already loaded: one
 * model instead of two, 0.5 GB instead of 4.5 GB, and a fraction of the CPU.
 */

/**
 * Options are relabelled A, B, C... for the prompt and mapped back afterwards.
 *
 * This is forced: the real option keys include `B1` and `R2`, which are two tokens, and you
 * cannot read a two-token answer from a single next-token distribution. Letters are also the
 * form base models have seen most often in multiple-choice text.
 */
const LETTERS = 'ABCDEFGH';

function buildPrompt(ask: DecisionAsk, keys: string[]): string {
  const lines = keys.map((key, index) => `${LETTERS[index]}) ${ask.criteria[key]}`);
  return [
    ask.state,
    '',
    ask.instructions,
    ...lines,
    '',
    'Answer:',
  ].join('\n');
}

/**
 * A state carrying no information. Whatever the model answers for this is pure label prior -
 * position in the list, how common the letter is, how the option happens to be phrased - and
 * none of it is about the situation.
 */
const NULL_STATE = 'N/A';

export class LogprobClient implements DecisionClient {
  #config: Config;
  #queue: InferenceQueue;
  #failures = 0;
  #priors = new Map<string, Record<string, number>>();

  constructor(config: Config, queue: InferenceQueue) {
    this.#config = config;
    this.#queue = queue;
  }

  /**
   * The model's answer before it has been told anything.
   *
   * Measured on Qwen2.5-0.5B: given the best possible hand facing a bet, it folded with
   * probability 0.52 when fold was listed first and called with 0.63 when fold was listed
   * last. The answer flipped with the order of the list. On a content-free state one letter
   * came back at 0.78 whatever the options meant.
   *
   * So the raw distribution is mostly label prior, and dividing it out is what leaves the part
   * that is actually about the situation. One extra forward pass, cached per option set - and
   * the option catalogue is small and fixed, so in a real game it is paid a handful of times.
   */
  async #prior(ask: DecisionAsk, keys: string[]): Promise<Record<string, number>> {
    const signature = keys.join(',');
    const cached = this.#priors.get(signature);
    if (cached) return cached;

    const answer = await this.#ask({ ...ask, state: NULL_STATE }, keys);
    this.#priors.set(signature, answer.probabilities);
    return answer.probabilities;
  }

  available(): boolean {
    return this.#failures < 3;
  }

  async ask(ask: DecisionAsk): Promise<DecisionAnswer> {
    const keys = Object.keys(ask.criteria);
    if (keys.length > LETTERS.length) throw new Error(`${keys.length} options is more than ${LETTERS.length}`);

    const raw = await this.#ask(ask, keys);
    if (!this.#config.decision.calibrate) return raw;

    return calibrate(raw, await this.#prior(ask, keys), keys);
  }

  async #ask(ask: DecisionAsk, keys: string[]): Promise<DecisionAnswer> {
    const prompt = buildPrompt(ask, keys);

    try {
      const answer = await this.#queue.submit({
        kind: 'decision',
        timeoutMs: this.#config.decision.timeoutMs,
        run: async (signal) => {
          const response = await fetch(`${this.#config.decision.url}/completion`, {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({
              prompt,
              n_predict: 1,
              // Wide enough that every answer letter is in the returned distribution even when
              // the model would rather say something else entirely.
              n_probs: 40,
              temperature: 0,
            }),
            signal,
          });
          if (!response.ok) throw new Error(`logprob ${response.status}`);
          return await response.json();
        },
      });

      const parsed = parseDistribution(answer, keys);
      this.#failures = 0;
      return parsed;
    } catch (error) {
      this.#failures++;
      logger.warn('logprob decision failed', {
        reason: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }
  }

  stats(): Record<string, unknown> {
    return { provider: 'logprob', consecutiveFailures: this.#failures };
  }
}

interface TopLogprob {
  token?: string;
  logprob?: number;
}

/**
 * Turns the next-token distribution into a probability per option.
 *
 * Tokenisers differ on whether the token is `A` or ` A`, and a letter can also appear as part
 * of a longer token, so matching is on the trimmed text being exactly the letter. Anything the
 * model would rather have said is discarded and the remainder renormalised - the question is
 * which option it prefers, not whether it wanted to answer at all.
 */
export function parseDistribution(body: unknown, keys: string[]): DecisionAnswer {
  const first = (body as { completion_probabilities?: { top_logprobs?: TopLogprob[] }[] })
    ?.completion_probabilities?.[0];
  const top = first?.top_logprobs ?? [];
  if (top.length === 0) throw new Error('no token probabilities returned');

  const weights = new Map<string, number>();
  for (const entry of top) {
    const text = (entry.token ?? '').trim();
    const index = LETTERS.indexOf(text);
    if (index < 0 || index >= keys.length || text.length !== 1) continue;
    const probability = Math.exp(entry.logprob ?? -Infinity);
    weights.set(keys[index], (weights.get(keys[index]) ?? 0) + probability);
  }

  // A floor so an option the model never considered is unlikely rather than impossible -
  // the sampler would otherwise be unable to produce it at any temperature.
  const FLOOR = 1e-4;
  let total = 0;
  for (const key of keys) {
    const weight = (weights.get(key) ?? 0) + FLOOR;
    weights.set(key, weight);
    total += weight;
  }

  const probabilities: Record<string, number> = {};
  let best = '';
  let bestProbability = -1;
  for (const key of keys) {
    const probability = weights.get(key)! / total;
    probabilities[key] = probability;
    if (probability > bestProbability) {
      bestProbability = probability;
      best = key;
    }
  }

  // Chance-corrected, to match how Jeff reports confidence: 0 is a uniform distribution.
  const chance = 1 / keys.length;
  const confidence = Math.max(0, Math.min(1, (bestProbability - chance) / (1 - chance)));

  return { choice: best, probabilities, confidence, inputTokens: 0 };
}

/**
 * Divides out the label prior and renormalises, then recomputes confidence from the result.
 * Straight from the contextual-calibration recipe: the useful signal is how much the situation
 * moved the answer, not where the answer ended up.
 */
export function calibrate(
  raw: DecisionAnswer,
  prior: Record<string, number>,
  keys: string[],
): DecisionAnswer {
  const weights: Record<string, number> = {};
  let total = 0;
  for (const key of keys) {
    // The prior is floored in parseDistribution, so this cannot divide by zero.
    const weight = raw.probabilities[key] / Math.max(1e-6, prior[key] ?? 1);
    weights[key] = weight;
    total += weight;
  }

  const probabilities: Record<string, number> = {};
  let best = keys[0];
  let bestProbability = -1;
  for (const key of keys) {
    const probability = weights[key] / total;
    probabilities[key] = probability;
    if (probability > bestProbability) {
      bestProbability = probability;
      best = key;
    }
  }

  const chance = 1 / keys.length;
  return {
    choice: best,
    probabilities,
    confidence: Math.max(0, Math.min(1, (bestProbability - chance) / (1 - chance))),
    inputTokens: raw.inputTokens,
  };
}

export { buildPrompt };
