// esbuild is pulled through Deno's npm: specifier rather than run from node_modules.
// ~/.npmrc sets ignore-scripts=true, so npm never fetches esbuild's platform binary;
// Deno fetches it itself. Changing this to a node_modules invocation will break the build.
import esbuild from 'npm:esbuild@0.25.0';
import { copyStatic } from './copy-static.ts';

export const OUT_DIR = new URL('../api/client/', import.meta.url);

export const buildOptions: esbuild.BuildOptions = {
  logLevel: 'info',
  entryPoints: ['src/main.tsx'],
  bundle: true,
  outfile: '../api/client/out.js',
  format: 'iife',
  target: ['es2020'],
  platform: 'browser',
  minify: true,
  sourcemap: false,
  // esbuild scopes *.module.css locally on its own, so no CSS Modules plugin is needed.
};

/** Rewrites index.html with a cache-busting query so a new bundle is never served stale. */
export async function writeIndexHtml(hash: string) {
  const template = await Deno.readTextFile(new URL('./static/index.html', import.meta.url));
  const html = template.replace(/\/(out\.js|out\.css)"/g, `/$1?v=${hash}"`);
  await Deno.writeTextFile(new URL('index.html', OUT_DIR), html);
}

export async function resolveBuildHash(): Promise<string> {
  const envHash = Deno.env.get('BUILD_HASH') || Deno.env.get('GITHUB_SHA');
  if (envHash) return envHash.slice(0, 7);

  try {
    const out = await new Deno.Command('git', {
      args: ['rev-parse', '--short', 'HEAD'],
      stdout: 'piped',
      stderr: 'null',
    }).output();
    if (out.success) {
      const hash = new TextDecoder().decode(out.stdout).trim();
      if (hash) return hash;
    }
  } catch {
    // git not available
  }

  return 'dev';
}

if (import.meta.main) {
  const hash = await resolveBuildHash();
  await copyStatic();
  await esbuild.build(buildOptions);
  await writeIndexHtml(hash);
  console.log('built client', hash);
  await esbuild.stop();
}
