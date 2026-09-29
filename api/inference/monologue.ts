import type { Config } from '../config.ts';
import type { InferenceQueue } from './queue.ts';

/**
 * The inner monologue, from a very small local LLM.
 *
 * Flavour, not mechanism: if this is slow, broken or switched off, the game uses a template
 * line and nothing stalls. That is why the timeout is short and why failure is not even logged
 * as a warning - on this machine, templates are a normal operating mode.
 */

export interface MonologueClient {
  write(prompt: string): Promise<string>;
  available(): boolean;
}

/** One or two sentences, never a paragraph and never the model's own preamble. */
export function tidy(text: string): string {
  let line = text.trim();
  // Small instruct models love to wrap output in quotes or announce themselves first.
  line = line.replace(/^["'“‘]+|["'”’]+$/g, '').trim();
  line = line.replace(/^(Inner thought|Thought|Answer)\s*:\s*/i, '');
  // Keep at most the first two sentences, and never a trailing fragment.
  const sentences = line.match(/[^.!?]+[.!?]+/g);
  // Each match keeps its trailing space, so trim before joining or the result double-spaces.
  if (sentences && sentences.length > 0) line = sentences.slice(0, 2).map((s) => s.trim()).join(' ');
  else line = line.split('\n')[0].trim();
  if (line.length > 160) line = `${line.slice(0, 157).trimEnd()}...`;
  return line;
}

export class LlamaClient implements MonologueClient {
  #config: Config;
  #queue: InferenceQueue;
  #consecutiveFailures = 0;

  constructor(config: Config, queue: InferenceQueue) {
    this.#config = config;
    this.#queue = queue;
  }

  available(): boolean {
    return this.#consecutiveFailures < 3;
  }

  async write(prompt: string): Promise<string> {
    try {
      const text = await this.#queue.submit({
        kind: 'monologue',
        timeoutMs: this.#config.monologue.timeoutMs,
        // Raw completion, not chat. The prompt is a few-shot pattern ending in an open
        // quote, and a 0.5B model continues a pattern far more reliably than it follows an
        // instruction - asked conversationally, it restates the instruction instead.
        run: async (signal) => {
          const response = await fetch(`${this.#config.monologue.url}/completion`, {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({
              prompt,
              n_predict: this.#config.monologue.maxTokens,
              temperature: 0.9,
              top_p: 0.92,
              // The closing quote of the line it is completing, and anything that looks like
              // the start of another example.
              stop: ['"', '\n', 'Player:', 'Thought:'],
            }),
            signal,
          });
          if (!response.ok) throw new Error(`monologue ${response.status}`);
          const body = await response.json();
          return String(body.content ?? '');
        },
      });

      const line = tidy(text);
      if (!line) throw new Error('empty monologue');
      this.#consecutiveFailures = 0;
      return line;
    } catch (error) {
      this.#consecutiveFailures++;
      throw error;
    }
  }
}
