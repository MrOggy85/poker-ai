import type { ClientCommand, Speed } from '../../shared/events.ts';
import { SPEEDS } from '../../shared/events.ts';
import type { Director } from '../tournament/director.ts';
import logger from '../logger.ts';

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
}

/**
 * The client's only way to change anything. Deliberately a plain POST rather than a message on
 * the event stream: the stream stays one-directional, and these four commands are rare enough
 * that a round trip costs nothing.
 */
export async function handleControl(request: Request, director: Director): Promise<Response> {
  let command: ClientCommand;
  try {
    command = await request.json();
  } catch {
    return json({ error: 'expected a json body' }, 400);
  }

  switch (command?.cmd) {
    case 'pause':
      director.pause();
      break;
    case 'resume':
      director.resume();
      break;
    case 'set_speed': {
      if (!SPEEDS.includes(command.speed as Speed)) return json({ error: 'unknown speed' }, 400);
      director.setSpeed(command.speed);
      break;
    }
    case 'new_tournament':
      director.restart(command.seed);
      break;
    default:
      return json({ error: 'unknown command' }, 400);
  }

  logger.info('control', { cmd: command.cmd });
  return json({ ok: true });
}
