import logger from '../logger.ts';
import type { Config } from '../config.ts';
import { InferenceQueue } from './queue.ts';
import { choiceAnswer, JeffError, retryAfterMs, type SystemOneRequest, type SystemOneResponse } from './jeff.ts';

/**
 * Talking to Jeff, with everything that can go wrong on this machine handled.
 *
 * The interface exists so the decision source is swappable: Jeff here, the rule bot when it is
 * unreachable, and a recorded stub in tests. Game logic never learns which one answered.
 */

export interface DecisionAsk {
  state: string;
  instructions: string;
  /** Key to consequence, in stable catalogue order. */
  criteria: Record<string, string>;
}

export interface DecisionAnswer {
  choice: string;
  probabilities: Record<string, number>;
  confidence: number;
  inputTokens: number;
}

export interface DecisionClient {
  ask(ask: DecisionAsk): Promise<DecisionAnswer>;
  /** False while the breaker is open, so callers can skip straight to the rule bot. */
  available(): boolean;
  stats(): Record<string, unknown>;
}

const BREAKER_TRIP = 3;
const BREAKER_MS = 30_000;

export class JeffClient implements DecisionClient {
  #config: Config;
  #queue: InferenceQueue;
  #consecutiveFailures = 0;
  #openedAt = 0;
  #busyResponses = 0;
  #fallbacks = 0;

  constructor(config: Config, queue: InferenceQueue) {
    this.#config = config;
    this.#queue = queue;
  }

  /**
   * Three failures in a row open the breaker for thirty seconds and every decision goes
   * straight to the rule bot. Without it, a Jeff that is down turns every single turn into a
   * full timeout - which does not make the game dumber, it makes it unwatchable.
   */
  available(): boolean {
    if (this.#consecutiveFailures < BREAKER_TRIP) return true;
    if (Date.now() - this.#openedAt > BREAKER_MS) {
      this.#consecutiveFailures = BREAKER_TRIP - 1; // half-open: let one request try
      return true;
    }
    return false;
  }

  async ask(ask: DecisionAsk): Promise<DecisionAnswer> {
    const body: SystemOneRequest = {
      model: this.#config.decision.model,
      state: ask.state,
      questions: {
        action: { type: 'choice', instructions: ask.instructions, criteria: ask.criteria },
      },
    };

    try {
      const answer = await this.#queue.submit({
        kind: 'decision',
        timeoutMs: this.#config.decision.timeoutMs,
        run: (signal) => this.#post(body, signal),
      });
      this.#consecutiveFailures = 0;
      return answer;
    } catch (error) {
      this.#consecutiveFailures++;
      this.#fallbacks++;
      if (this.#consecutiveFailures === BREAKER_TRIP) {
        this.#openedAt = Date.now();
        logger.warn('jeff breaker open', { forMs: BREAKER_MS });
      }
      throw error;
    }
  }

  async #post(body: SystemOneRequest, signal: AbortSignal): Promise<DecisionAnswer> {
    const deadline = Date.now() + this.#config.decision.timeoutMs;
    let attempt = 0;

    while (true) {
      const response = await fetch(`${this.#config.decision.url}/v1/systemone`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
        signal,
      });

      if (response.ok) {
        const parsed = await response.json() as SystemOneResponse;
        const answer = choiceAnswer(parsed, 'action');
        return {
          choice: answer.choice,
          probabilities: answer.probabilities,
          confidence: answer.confidence,
          inputTokens: parsed.usage?.input_tokens ?? 0,
        };
      }

      const text = await response.text();
      const error = new JeffError(response.status, text);

      // 529 means Jeff is already serving someone. The inference queue makes us its only
      // caller, so this should never fire in steady state - and when it does, something else
      // is talking to Jeff. In practice that is a redeploy: the outgoing container's last
      // request is still being served when the incoming one starts. Counted rather than
      // swallowed, because a *sustained* count means a stray process worth hunting down.
      if (response.status === 529) this.#busyResponses++;

      if (!error.retryable || attempt >= this.#config.decision.busyRetries || Date.now() >= deadline) throw error;

      attempt++;
      // Honour the server's own number. Hot-looping at 50ms just burns the deadline.
      await new Promise((resolve) => setTimeout(resolve, retryAfterMs(response, 1000)));
    }
  }

  stats(): Record<string, unknown> {
    return {
      breakerOpen: !this.available(),
      consecutiveFailures: this.#consecutiveFailures,
      busyResponses: this.#busyResponses,
      fallbacks: this.#fallbacks,
    };
  }
}
