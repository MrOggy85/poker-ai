import { fromFileUrl } from 'jsr:@std/path@1';

export type Speed = 'slow' | 'normal' | 'fast' | 'turbo';

export interface Config {
  seed: string;
  table: {
    players: number;
    startingChips: number;
    handsPerLevel: number;
    blindSchedule: [number, number][];
  };
  equity: { samples: number };
  pacing: {
    speed: Speed;
    minActionMs: Record<Speed, number>;
    handEndPauseMs: Record<Speed, number>;
  };
  mood: { driftChancePerHand: number; decayHands: number };
  decision: { enabled: boolean; url: string; model: string; timeoutMs: number; busyRetries: number };
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

  const monologueUrl = Deno.env.get('MONOLOGUE_URL');
  if (monologueUrl) config.monologue.url = monologueUrl;

  if (Deno.env.get('DECISION_ENABLED') === '0') config.decision.enabled = false;
  if (Deno.env.get('MONOLOGUE_ENABLED') === '0') config.monologue.enabled = false;

  const seed = Deno.env.get('SEED');
  if (seed) config.seed = seed;

  return config;
}
