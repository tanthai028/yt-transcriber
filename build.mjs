// Builds both targets:
//   dist/      the Chrome extension (load unpacked)
//   dist-web/  the static site for Vercel: install page + bookmarklet bundle
// Usage: node build.mjs [--watch]
import { copyFile, mkdir, rm } from 'node:fs/promises';
import * as esbuild from 'esbuild';

const watch = process.argv.includes('--watch');

for (const dir of ['dist', 'dist-web']) {
  await rm(dir, { recursive: true, force: true });
  await mkdir(dir);
}
await copyFile('manifest.json', 'dist/manifest.json');
await copyFile('src/popup/popup.html', 'dist/popup.html');
await copyFile('web/index.html', 'dist-web/index.html');

/** @type {import('esbuild').BuildOptions} */
const common = {
  bundle: true,
  // Content scripts can't be ES modules; IIFE also keeps our code out of the page's globals.
  format: 'iife',
  jsx: 'automatic',
  define: { 'process.env.NODE_ENV': watch ? '"development"' : '"production"' },
  minify: !watch,
  logLevel: 'info',
};

/** @type {import('esbuild').BuildOptions[]} */
const targets = [
  {
    ...common,
    entryPoints: {
      'page-bridge': 'src/extractor/page-bridge.ts',
      content: 'src/content/index.ts',
      popup: 'src/popup/index.tsx',
    },
    outdir: 'dist',
    target: 'chrome111',
    sourcemap: 'linked',
  },
  {
    ...common,
    // Fetched and run by the bookmarklet on youtube.com (iPad Safari included).
    entryPoints: { bookmarklet: 'src/bookmarklet/index.ts' },
    outdir: 'dist-web',
    target: ['safari16', 'chrome111', 'firefox115'],
  },
];

if (watch) {
  for (const t of targets) await (await esbuild.context(t)).watch();
} else {
  await Promise.all(targets.map((t) => esbuild.build(t)));
}
