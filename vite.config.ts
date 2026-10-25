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
  test: {
    environment: 'node',
    include: ['tests/**/*.test.ts'],
  },
});
