/**
 * Wire types for Jeff's `POST /v1/systemone`, read from the firelex/jeff v0.2.0 source rather
 * than from its README - the README documents the request only, and its one sentence about
 * responses ("a probability per option, the chosen option and a confidence") is wrong for
 * `noul`.
 *
 * The three answer types have genuinely different shapes. A `noul` answer is a bare float with
 * no probabilities and no confidence, so any code that reaches for `answers[key].probabilities`
 * across the board throws and takes the whole decision down to the fallback path. Hence the
 * discriminated union and an explicit switch.
 */

export interface ChoiceQuestion {
  type: 'choice';
  instructions: string;
  /** Keys are the caller's own; at most 26 of them for the released checkpoints. */
  criteria: Record<string, string>;
}

export interface NoulQuestion {
  type: 'noul';
  instructions: string;
  criteria?: { true: string; false: string };
}

export interface ScoreQuestion {
  type: 'score';
  instructions: string;
  /** A list, unlike choice's dict. Two to ten rungs. */
  criteria: string[];
}

export type Question = ChoiceQuestion | NoulQuestion | ScoreQuestion;

/**
 * The request model is pydantic `extra="forbid"`, so an extra field is a 422, not something
 * politely ignored. Nothing here spreads a caller-supplied object into the body.
 */
export interface SystemOneRequest {
  model: string;
  state: string;
  questions: Record<string, Question>;
}

export interface ChoiceAnswer {
  type: 'choice';
  /** One of the caller's own criteria keys. */
  choice: string;
  probabilities: Record<string, number>;
  /** Chance-corrected: (p_best - 1/n) / (1 - 1/n), so 0 means uniform rather than "no idea". */
  confidence: number;
}

export interface NoulAnswer {
  type: 'noul';
  /** Probability of true. That is the whole answer - there is nothing else in the object. */
  noul: number;
}

export interface ScoreAnswer {
  type: 'score';
  /** The expected index over the criteria list, 0..n-1. Not normalised, not a label. */
  score: number;
  legend: Record<string, string>;
  probabilities: Record<string, number>;
  confidence: number;
}

export type Answer = ChoiceAnswer | NoulAnswer | ScoreAnswer;

export interface SystemOneResponse {
  /** The resolved checkpoint name, not whatever was sent - e.g. 'jeff-qwen3.5-0.8b'. */
  model: string;
  answers: Record<string, Answer>;
  usage: { input_tokens: number; output_tokens: number };
}

export class JeffError extends Error {
  readonly status: number;
  readonly retryable: boolean;

  constructor(status: number, body: string) {
    super(`jeff ${status}: ${body.slice(0, 200)}`);
    this.status = status;
    // 422 and 401 are our bug, not a transient condition, and retrying only hides them.
    this.retryable = status === 529 || status === 503 || status >= 500;
  }
}

/** Seconds form only - Jeff sends `Retry-After: 1`. */
export function retryAfterMs(response: Response, fallbackMs: number): number {
  const header = response.headers.get('retry-after');
  const seconds = header ? Number(header) : NaN;
  return Number.isFinite(seconds) ? Math.max(250, seconds * 1000) : fallbackMs;
}

export function choiceAnswer(response: SystemOneResponse, key: string): ChoiceAnswer {
  const answer = response.answers?.[key];
  if (!answer) throw new Error(`jeff returned no answer for '${key}'`);
  if (answer.type !== 'choice') throw new Error(`expected a choice for '${key}', got '${answer.type}'`);
  return answer;
}
