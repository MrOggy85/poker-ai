import { init } from './server.ts';
import { loadConfig } from './config.ts';
import logger from './logger.ts';

const DEV = Deno.env.get('DEV') === '1';
const HOST = Deno.env.get('HOST') || '127.0.0.1';
const PORT = Number(Deno.env.get('PORT') || '8780');

function startClientWatcher() {
  const cmd = new Deno.Command(Deno.execPath(), {
    cwd: '../client',
    // Must match client/package.json's build script. --allow-sys cannot be narrowed:
    // esbuild's platform detection reads os.cpus().
    args: [
      'run',
      '--allow-env',
      '--allow-read',
      '--allow-run',
      '--allow-sys',
      '--allow-write=../api/client',
      'build-watch.ts',
    ],
    stdout: 'inherit',
    stderr: 'inherit',
  });
  const child = cmd.spawn();
  child.status.then((status) => logger.info('client watcher exited', { code: status.code }));
  return child;
}

// Guarded on the file existing so the api can be run on its own before `make install`.
const hasClient = (() => {
  try {
    return Deno.statSync('../client/build-watch.ts').isFile;
  } catch {
    return false;
  }
})();

if (DEV && hasClient) startClientWatcher();

const config = loadConfig();

logger.info('starting', {
  host: HOST,
  port: PORT,
  seed: config.seed,
  decision: config.decision.enabled ? config.decision.url : 'disabled',
  monologue: config.monologue.enabled ? config.monologue.url : 'disabled',
});

Deno.serve({ hostname: HOST, port: PORT }, init(config));
