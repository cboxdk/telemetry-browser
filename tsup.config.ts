import { defineConfig } from 'tsup';

export default defineConfig([
  // Browser SDK — ESM + CJS + types.
  { entry: ['src/index.ts'], format: ['esm', 'cjs'], dts: true, sourcemap: true, clean: true, treeshake: true },
  // Standalone IIFE for a <script> tag / CDN — window.Telemetry.
  {
    entry: { telemetry: 'src/global.ts' },
    format: ['iife'],
    globalName: 'Telemetry',
    outExtension: () => ({ js: '.global.js' }),
    sourcemap: true,
    minify: true,
    treeshake: true,
  },
  // Node build-tooling — the source map uploader + CLI (never in the browser bundle).
  {
    entry: { sourcemaps: 'src/sourcemaps.ts', cli: 'src/cli.ts' },
    format: ['esm', 'cjs'],
    platform: 'node',
    dts: { entry: { sourcemaps: 'src/sourcemaps.ts' } },
    clean: false,
  },
]);
