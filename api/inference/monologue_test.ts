import { assertEquals } from 'jsr:@std/assert@1';
import { tidy } from './monologue.ts';

// A 0.5B model produces exactly this kind of output, so the cleanup is not optional garnish.
Deno.test('tidies what a tiny model actually returns', () => {
  assertEquals(tidy('  "Nobody believes that raise."  '), 'Nobody believes that raise.');
  assertEquals(tidy('Inner thought: I have him beaten.'), 'I have him beaten.');
  assertEquals(tidy('One. Two. Three. Four.'), 'One. Two.');
  assertEquals(tidy('No punctuation at all\nand a second line'), 'No punctuation at all');
});

Deno.test('truncates a run-on rather than letting it fill the bubble', () => {
  const long = tidy(`${'word '.repeat(60)}.`);
  assertEquals(long.length <= 160, true);
  assertEquals(long.endsWith('...'), true);
});
