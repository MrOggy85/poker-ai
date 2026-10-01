import { assertEquals } from 'jsr:@std/assert@1';
import { SERVER_EVENT_TYPES } from './events.ts';

// A named SSE frame never reaches a client that did not subscribe to its name, so an event
// missing from SERVER_EVENT_TYPES is silently dropped in the browser.
Deno.test('every ServerEvent type is in SERVER_EVENT_TYPES', async () => {
  const source = await Deno.readTextFile(new URL('./events.ts', import.meta.url));
  const union = source.slice(source.indexOf('export type ServerEvent ='), source.indexOf('export type ServerEventType'));
  const declared = [...union.matchAll(/type: '([a-z_]+)'/g)].map((m) => m[1]);
  assertEquals([...SERVER_EVENT_TYPES].sort(), declared.sort());
});
