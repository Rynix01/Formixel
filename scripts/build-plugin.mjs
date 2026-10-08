import { build } from 'esbuild';
await build({
  entryPoints: ['packages/blockbench/src/index.ts'],
  outfile: 'packages/blockbench/dist/formixel.js',
  bundle: true,
  platform: 'browser',
  format: 'iife',
  target: 'es2020',
});
