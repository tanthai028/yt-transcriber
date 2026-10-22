// Bundles the extension scripts into dist/ and copies the manifest and popup page.
// Usage: node build.mjs [--watch]
import { copyFile, mkdir, rm } from 'node:fs/promises';
import * as esbuild from 'esbuild';

const watch = process.argv.includes('--watch');

await rm('dist', { recursive: true, force: true });
await mkdir('dist');
await copyFile('manifest.json', 'dist/manifest.json');
await copyFile('src/popup/popup.html', 'dist/popup.html');

/** @type {import('esbuild').BuildOptions} */
const options = {
  entryPoints: {
    'page-bridge': 'src/extractor/page-bridge.ts',
    content: 'src/content/index.ts',
    popup: 'src/popup/index.tsx',
  },
  outdir: 'dist',
  bundle: true,
  // Content scripts can't be ES modules; IIFE also keeps page-bridge out of the page's globals.
  format: 'iife',
  target: 'chrome111',
  jsx: 'automatic',
  sourcemap: 'linked',
  define: { 'process.env.NODE_ENV': watch ? '"development"' : '"production"' },
  minify: !watch,
  logLevel: 'info',
};

if (watch) {
  const ctx = await esbuild.context(options);
  await ctx.watch();
} else {
  await esbuild.build(options);
}
