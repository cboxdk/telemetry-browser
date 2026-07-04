import { defineConfig } from 'tsup';

export default defineConfig([
  // Library builds (ESM + CJS + types) for bundler/npm consumers.
  {
    entry: ['src/index.ts'],
    format: ['esm', 'cjs'],
    dts: true,
    sourcemap: true,
    clean: true,
    treeshake: true,
    minify: false,
  },
  // Standalone IIFE for a <script> tag / CDN — exposes window.Telemetry.
  {
    entry: { telemetry: 'src/global.ts' },
    format: ['iife'],
    globalName: 'Telemetry',
    outExtension: () => ({ js: '.global.js' }),
    sourcemap: true,
    minify: true,
    treeshake: true,
  },
]);
