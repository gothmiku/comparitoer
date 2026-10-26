import { defineConfig } from 'vitest/config';

export default defineConfig({
  // Relative base so a single build works on both Vercel and GitHub Pages
  // (project pages are served from /<repo>/).
  base: './',
  build: {
    outDir: 'dist',
    target: 'es2022',
    sourcemap: true,
  },
  // ffmpeg.wasm spawns its own module worker that loads the core from `public/ffmpeg/`.
  // Pre-bundling the wrapper breaks that worker URL, so it is excluded.
  optimizeDeps: {
    exclude: ['@ffmpeg/ffmpeg'],
  },
  worker: {
    // ffmpeg's worker is an ES module with static imports; an IIFE bundle cannot code-split.
    format: 'es',
  },
  test: {
    environment: 'node',
    include: ['tests/**/*.test.ts'],
  },
});
