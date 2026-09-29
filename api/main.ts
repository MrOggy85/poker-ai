import { Director, Hub, init } from './server.ts';
import { loadConfig } from './config.ts';
import { ruleBrain } from './bots/brain.ts';
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

const hub = new Hub();
// The brain is injected so the same loop runs rule-based bots and Jeff-backed ones. The
// rule bots are not a stub: they are the permanent fallback for when Jeff is slow or down.
const director = new Director(config, hub, ruleBrain(config));

Deno.serve({ hostname: HOST, port: PORT }, init(config, hub, director));

void director.run();
