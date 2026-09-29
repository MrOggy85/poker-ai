import { fromFileUrl } from 'jsr:@std/path@1';

export type Speed = 'slow' | 'normal' | 'fast' | 'turbo';

export interface Config {
  seed: string;
  table: {
    players: number;
    startingChips: number;
    handsPerLevel: number;
    blindSchedule: [number, number][];
    /** Start another tournament when one finishes, so the page is never a dead table. */
    autoRestart: boolean;
    restartDelayMs: number;
  };
  equity: { samples: number };
  pacing: {
    speed: Speed;
    minActionMs: Record<Speed, number>;
    handEndPauseMs: Record<Speed, number>;
    /**
     * Hold the game while no browser is connected. On for the real server; headless callers
     * (the simulation, the tests) turn it off, or they would block forever waiting for an
     * audience that is never going to arrive.
     */
    idleWhenUnwatched: boolean;
  };
  mood: { driftChancePerHand: number; decayHands: number };
  decision: {
    enabled: boolean;
    /**
     * Where the decisions come from.
     *   jeff    - the purpose-trained classifier on its own service
     *   logprob - any plain LLM's next-token distribution over the answer letters, which on
     *             this machine means reusing the already-loaded monologue model
     *   rules   - no model at all
     */
    provider: 'jeff' | 'logprob' | 'rules';
    url: string;
    model: string;
    timeoutMs: number;
    busyRetries: number;
    /**
     * Below this chance-corrected confidence, the classifier is treated as having no opinion
     * and the rule bot decides. 0 would be a uniform distribution.
     */
    minConfidence: number;
    /** Let the rule bot handle spots that are not really decisions. Saves model calls. */
    skipObvious: boolean;
    /** Divide out the label prior for the logprob provider. Ignored by the others. */
    calibrate: boolean;
  };
  monologue: { enabled: boolean; url: string; timeoutMs: number; maxTokens: number; routineChance: number };
  log: { dir: string };
}

const DEFAULT_PATH = fromFileUrl(new URL('../config/tournament.json', import.meta.url));

/**
 * The single config file from PROJECT.md section 14. Env vars override only the endpoints,
 * because those differ between `make dev` (loopback) and the container (service names).
 */
export function loadConfig(path = Deno.env.get('CONFIG_PATH') || DEFAULT_PATH): Config {
  const config = JSON.parse(Deno.readTextFileSync(path)) as Config;

  const decisionUrl = Deno.env.get('DECISION_URL');
  if (decisionUrl) config.decision.url = decisionUrl;

  const provider = Deno.env.get('DECISION_PROVIDER');
  if (provider === 'jeff' || provider === 'logprob' || provider === 'rules') config.decision.provider = provider;

  // The logprob provider talks to the monologue model, so it defaults to that endpoint unless
  // something explicitly overrode the decision URL.
  if (config.decision.provider === 'logprob' && !decisionUrl) config.decision.url = config.monologue.url;

  const monologueUrl = Deno.env.get('MONOLOGUE_URL');
  if (monologueUrl) config.monologue.url = monologueUrl;

  if (Deno.env.get('DECISION_ENABLED') === '0') config.decision.enabled = false;
  if (Deno.env.get('MONOLOGUE_ENABLED') === '0') config.monologue.enabled = false;

  const seed = Deno.env.get('SEED');
  if (seed) config.seed = seed;

  // In the container the only writable path is the mounted volume, and the config default is
  // relative to the working directory. Without this the hand log silently disables itself.
  const logDir = Deno.env.get('LOG_DIR');
  if (logDir) config.log.dir = logDir;

  return config;
}
