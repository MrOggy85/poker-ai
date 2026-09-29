import type { ServerEvent, Snapshot } from '../../shared/events.ts';
import logger from '../logger.ts';

/**
 * Server-sent events, one way, server to browser.
 *
 * SSE rather than a WebSocket because the traffic is entirely one-directional - the four
 * control commands are a plain POST - and because EventSource reconnects by itself with a
 * Last-Event-ID, which maps exactly onto "snapshot on connect, then increments". A ring buffer
 * of recent events means a reconnect inside the buffer replays the gap instead of resetting
 * the whole view, so a dropped wifi connection does not visibly restart the game.
 */

const RING_SIZE = 500;
const KEEPALIVE_MS = 15_000;

interface Subscriber {
  send(chunk: string): void;
  close(): void;
}

function frame(id: number, event: ServerEvent): string {
  return `id: ${id}\nevent: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`;
}

export class Hub {
  #subscribers = new Set<Subscriber>();
  #ring: { id: number; event: ServerEvent }[] = [];
  #seq = 0;
  #onAudienceChange: ((watching: boolean) => void) | null = null;

  get subscriberCount(): number {
    return this.#subscribers.size;
  }

  /** Fired when the first viewer arrives or the last one leaves. */
  onAudienceChange(handler: (watching: boolean) => void): void {
    this.#onAudienceChange = handler;
    handler(this.#subscribers.size > 0);
  }

  #announce(): void {
    this.#onAudienceChange?.(this.#subscribers.size > 0);
  }

  emit(event: ServerEvent): void {
    const id = ++this.#seq;
    this.#ring.push({ id, event });
    if (this.#ring.length > RING_SIZE) this.#ring.shift();

    const chunk = frame(id, event);
    for (const subscriber of this.#subscribers) {
      try {
        subscriber.send(chunk);
      } catch {
        this.#subscribers.delete(subscriber);
        this.#announce();
      }
    }
  }

  /** Drops the replay buffer. Used by a new tournament, where replaying the old one is wrong. */
  clearHistory(): void {
    this.#ring = [];
  }

  subscribe(request: Request, snapshot: () => Snapshot): Response {
    const lastEventId = Number(request.headers.get('last-event-id') ?? '0') || 0;
    // Replayable only if the whole gap is still in the ring; otherwise start from a snapshot.
    const replay = lastEventId > 0 && this.#ring.length > 0 && this.#ring[0].id <= lastEventId + 1
      ? this.#ring.filter((entry) => entry.id > lastEventId)
      : null;

    const encoder = new TextEncoder();
    let keepalive: ReturnType<typeof setInterval> | undefined;
    let self: Subscriber | undefined;

    const stream = new ReadableStream<Uint8Array>({
      start: (controller) => {
        const send = (chunk: string) => controller.enqueue(encoder.encode(chunk));

        if (replay) {
          for (const entry of replay) send(frame(entry.id, entry.event));
          logger.info('stream reconnected', { from: lastEventId, replayed: replay.length });
        } else {
          send(frame(this.#seq, { type: 'snapshot', snapshot: snapshot() }));
        }

        self = {
          send,
          close: () => {
            try {
              controller.close();
            } catch {
              // already closed by the client going away
            }
          },
        };
        this.#subscribers.add(self);
        this.#announce();

        // Without traffic, an idle proxy will eventually drop the connection. A comment line
        // is ignored by EventSource and costs nothing.
        keepalive = setInterval(() => {
          try {
            send(': keepalive\n\n');
          } catch {
            /* the cancel handler cleans up */
          }
        }, KEEPALIVE_MS);
      },
      cancel: () => {
        if (keepalive !== undefined) clearInterval(keepalive);
        if (self) this.#subscribers.delete(self);
        this.#announce();
      },
    });

    return new Response(stream, {
      headers: {
        'content-type': 'text/event-stream',
        'cache-control': 'no-store',
        'connection': 'keep-alive',
        // Tells nginx-style proxies not to buffer, which would hold every event until the
        // response ended - i.e. forever.
        'x-accel-buffering': 'no',
      },
    });
  }

  closeAll(): void {
    for (const subscriber of this.#subscribers) subscriber.close();
    this.#subscribers.clear();
  }
}
