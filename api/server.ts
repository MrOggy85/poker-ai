import { contentType } from 'jsr:@std/media-types@1';
import { extname, fromFileUrl } from 'jsr:@std/path@1';
import type { Config } from './config.ts';
import { Hub } from './broadcast/hub.ts';
import { Director } from './tournament/director.ts';
import { handleControl } from './routes/control.ts';
import logger from './logger.ts';

// The client bundle, written here by client/build.ts.
const CLIENT_DIR = fromFileUrl(new URL('./client', import.meta.url));

async function serveStatic(pathname: string): Promise<Response | null> {
  // Any unknown path falls through to the SPA shell; the client owns its own routing.
  const rel = pathname === '/' ? '/index.html' : pathname;
  if (rel.includes('..')) return null;

  try {
    const file = await Deno.readFile(`${CLIENT_DIR}${rel}`);
    const type = contentType(extname(rel)) ?? 'application/octet-stream';
    // Hashed asset filenames are immutable; index.html must never be cached.
    const cache = rel === '/index.html' ? 'no-store' : 'public, max-age=31536000, immutable';
    return new Response(file, { headers: { 'content-type': type, 'cache-control': cache } });
  } catch {
    return null;
  }
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

/** Is a model service up? Used by /api/health so a silently dead Jeff is visible. */
async function probe(url: string, path: string): Promise<'up' | 'down'> {
  try {
    const res = await fetch(`${url}${path}`, { signal: AbortSignal.timeout(2000) });
    return res.ok ? 'up' : 'down';
  } catch {
    return 'down';
  }
}

export function init(config: Config, hub: Hub, director: Director) {
  return async function handler(req: Request): Promise<Response> {
    const url = new URL(req.url);

    if (url.pathname === '/api/stream') {
      return hub.subscribe(req, () => director.snapshot());
    }

    if (url.pathname === '/api/control') {
      if (req.method !== 'POST') return json({ error: 'post only' }, 405);
      return await handleControl(req, director);
    }

    if (url.pathname === '/api/debug') return json(director.debug());

    if (url.pathname === '/api/health') {
      const [decision, monologue] = await Promise.all([
        config.decision.enabled ? probe(config.decision.url, '/health') : Promise.resolve('off' as const),
        config.monologue.enabled ? probe(config.monologue.url, '/health') : Promise.resolve('off' as const),
      ]);
      return json({
        status: 'ok',
        decision,
        monologue,
        viewers: hub.subscriberCount,
        paused: director.pacer.paused,
        speed: director.pacer.speed,
      });
    }

    if (url.pathname.startsWith('/api/')) return json({ error: 'not found' }, 404);

    const asset = await serveStatic(url.pathname);
    if (asset) return asset;

    const shell = await serveStatic('/index.html');
    if (shell) return shell;

    logger.warn('no client bundle', { path: url.pathname });
    return new Response('client bundle missing - run `make build`', { status: 503 });
  };
}

export { Director, Hub };
