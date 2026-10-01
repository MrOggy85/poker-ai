import { assert } from 'jsr:@std/assert@1';

/**
 * The rule bot must get every hand-written situation right. It is the fallback the whole game
 * leans on when Jeff is slow or down, so "sensible poker" is a hard requirement for it in a
 * way it deliberately is not for the classifier.
 *
 * Jeff is measured by `deno run -A scripts/sanity.ts --source jeff`, which is a report rather
 * than a test: its answers drift, and this game wants personality more than correctness.
 * It sits at 9/12.
 */
Deno.test('the rule bot handles every sanity situation', async () => {
  const command = new Deno.Command(Deno.execPath(), {
    args: ['run', '-A', new URL('../../scripts/sanity.ts', import.meta.url).pathname, '--source', 'rules'],
    stdout: 'piped',
    stderr: 'piped',
  });
  const output = await command.output();
  const text = new TextDecoder().decode(output.stdout);
  const match = text.match(/(\d+)\/(\d+) sensible/);
  assert(match, `could not read a score from:\n${text}`);
  assert(match[1] === match[2], `the rule bot got ${match[0]}:\n${text}`);
});
