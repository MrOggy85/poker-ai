import { copy, ensureDir } from 'jsr:@std/fs@1';
import { fromFileUrl } from 'jsr:@std/path@1';

const OUT = fromFileUrl(new URL('../api/client', import.meta.url));
const STATIC = fromFileUrl(new URL('./static', import.meta.url));

/** Mirrors client/static/ into the folder the Deno server serves from. */
export async function copyStatic() {
  await ensureDir(OUT);
  for await (const entry of Deno.readDir(STATIC)) {
    if (entry.name === 'index.html') continue; // build.ts writes this with cache-busting
    await copy(`${STATIC}/${entry.name}`, `${OUT}/${entry.name}`, { overwrite: true });
  }
}
