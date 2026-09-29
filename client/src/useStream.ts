import { useEffect, useReducer, useRef } from 'react';
import type { ClientCommand, ServerEvent } from '../../shared/events.ts';
import { SERVER_EVENT_TYPES } from '../../shared/events.ts';
import { emptyView, reduce, type View } from './store.ts';

type Message = ServerEvent | { type: '__disconnected' };

function apply(view: View, message: Message): View {
  if (message.type === '__disconnected') return { ...view, connected: false };
  return reduce(view, message);
}

/**
 * How long a hidden tab keeps its stream open before letting go.
 *
 * The server only runs the game while someone is connected, and an EventSource stays open when
 * you switch tabs - so a tab left open in the background keeps two of this machine's four cores
 * busy indefinitely. Releasing the stream when the tab is hidden fixes that. The grace period
 * is so that glancing at another window for a moment does not stop the game.
 */
const HIDDEN_GRACE_MS = 30_000;

/**
 * Subscribes to the server's event stream.
 *
 * EventSource reconnects on its own and sends back Last-Event-ID, so a dropped connection
 * resumes where it left off rather than restarting the view; the server decides whether that
 * means replaying the gap or sending a fresh snapshot.
 */
export function useStream(): [View, (command: ClientCommand) => void] {
  const [view, dispatch] = useReducer(apply, undefined, emptyView);
  const source = useRef<EventSource | null>(null);

  useEffect(() => {
    let releaseTimer: ReturnType<typeof setTimeout> | undefined;

    const connect = () => {
      if (source.current) return;
      const stream = new EventSource('/api/stream');
      source.current = stream;

      // The frames are named, and a named event never reaches onmessage.
      for (const type of SERVER_EVENT_TYPES) {
        stream.addEventListener(type, (event) => {
          dispatch(JSON.parse((event as MessageEvent).data) as ServerEvent);
        });
      }

      stream.addEventListener('error', () => dispatch({ type: '__disconnected' }));
    };

    const release = () => {
      source.current?.close();
      source.current = null;
      dispatch({ type: '__disconnected' });
    };

    const onVisibility = () => {
      clearTimeout(releaseTimer);
      if (document.hidden) releaseTimer = setTimeout(release, HIDDEN_GRACE_MS);
      else connect();
    };

    connect();
    document.addEventListener('visibilitychange', onVisibility);

    return () => {
      clearTimeout(releaseTimer);
      document.removeEventListener('visibilitychange', onVisibility);
      release();
    };
  }, []);

  const send = (command: ClientCommand) => {
    void fetch('/api/control', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(command),
    });
  };

  return [view, send];
}
