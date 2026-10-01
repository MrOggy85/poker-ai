import type { Config } from '../config.ts';

export async function probe(url: string, path: string): Promise<'up' | 'down'> {
  try {
    const res = await fetch(`${url}${path}`, { signal: AbortSignal.timeout(2000) });
    return res.ok ? 'up' : 'down';
  } catch {
    return 'down';
  }
}

/** Display names of the enabled model services that are not answering /health right now. */
export async function modelsDown(config: Config): Promise<string[]> {
  const checks: [string, string][] = [];
  if (config.decision.enabled && config.decision.provider === 'jeff') checks.push(['Jeff', config.decision.url]);
  if (config.monologue.enabled) checks.push(['the commentary model', config.monologue.url]);
  const results = await Promise.all(checks.map(([, url]) => probe(url, '/health')));
  return checks.filter((_, i) => results[i] === 'down').map(([name]) => name);
}
