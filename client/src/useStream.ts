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
 * Subscribes to the server's event stream. EventSource reconnects on its own and sends back
 * Last-Event-ID, so a dropped connection resumes where it left off rather than restarting the
 * view; the server decides whether that means replaying the gap or sending a fresh snapshot.
 */
export function useStream(): [View, (command: ClientCommand) => void] {
  const [view, dispatch] = useReducer(apply, undefined, emptyView);
  const source = useRef<EventSource | null>(null);

  useEffect(() => {
    const stream = new EventSource('/api/stream');
    source.current = stream;

    // The frames are named, and a named event never reaches onmessage.
    for (const type of SERVER_EVENT_TYPES) {
      stream.addEventListener(type, (event) => {
        dispatch(JSON.parse((event as MessageEvent).data) as ServerEvent);
      });
    }

    stream.addEventListener('error', () => dispatch({ type: '__disconnected' }));

    return () => {
      stream.close();
      source.current = null;
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
