import * as esbuild from 'esbuild';

const watch = process.argv.includes('--watch');
const options = {
  entryPoints: ['client/main.js'],
  bundle: true,
  format: 'esm',
  target: 'es2022',
  minify: !watch,
  sourcemap: true,
  outfile: 'dist/game.js',
  logLevel: 'info',
};
if (watch) await (await esbuild.context(options)).watch();
else await esbuild.build(options);
