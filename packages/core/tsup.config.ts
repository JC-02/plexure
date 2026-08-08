import { defineConfig } from 'tsup';

export default defineConfig({
  entry: ['src/index.ts'],
  format: ['esm', 'cjs', 'iife'],
  globalName: 'plexure',
  dts: true,
  minify: true,
  sourcemap: true,
  clean: true,
  target: 'es2020',
});
