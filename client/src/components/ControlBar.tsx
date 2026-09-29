import { type ClientCommand, SPEEDS } from '../../../shared/events.ts';
import type { View } from '../store.ts';
import ui from '../ui.module.css';

/**
 * The client's only interactive surface. Everything here is a request to the server, which
 * remains the sole owner of game state and of time - nothing below changes the view directly.
 */
export function ControlBar({ view, send }: { view: View; send: (command: ClientCommand) => void }) {
  return (
    <div className={ui.controls}>
      <button
        type="button"
        className={ui.button}
        onClick={() => send({ cmd: view.paused ? 'resume' : 'pause' })}
      >
        {view.paused ? '▶ resume' : '⏸ pause'}
      </button>

      {SPEEDS.map((speed) => (
        <button
          key={speed}
          type="button"
          className={[ui.button, view.speed === speed ? ui.buttonOn : ''].filter(Boolean).join(' ')}
          onClick={() => send({ cmd: 'set_speed', speed })}
        >
          {speed}
        </button>
      ))}

      <button
        type="button"
        className={ui.button}
        onClick={() => {
          const seed = prompt('seed for the new tournament', view.seed);
          if (seed !== null) send({ cmd: 'new_tournament', seed: seed || undefined });
        }}
      >
        new tournament
      </button>
    </div>
  );
}
