import * as esbuild from 'esbuild';
import { rmSync } from 'node:fs';

const watch = process.argv.includes('--watch');
const options = {
  entryPoints: ['client/main.js'],
  bundle: true,
  format: 'esm',
  target: 'es2022',
  minify: !watch,
  sourcemap: true,
  outdir: 'dist',
  entryNames: 'game',
  chunkNames: 'chunk-[hash]',
  splitting: true,
  logLevel: 'info',
};
// Chunk names carry content hashes, so clear out old ones first.
rmSync('dist', { recursive: true, force: true });
if (watch) await (await esbuild.context(options)).watch();
else await esbuild.build(options);
