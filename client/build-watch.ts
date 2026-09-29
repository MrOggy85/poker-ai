import esbuild from 'npm:esbuild@0.25.0';
import { buildOptions, writeIndexHtml } from './build.ts';
import { copyStatic } from './copy-static.ts';

// Dev bundle: readable stack traces, no minification, rebuilt on every save.
await copyStatic();
await writeIndexHtml(String(Date.now()));

const ctx = await esbuild.context({ ...buildOptions, minify: false, sourcemap: 'inline' });
await ctx.watch();

console.log('watching client/src for changes');
