/**
 * Copies ffmpeg.wasm's single-thread core into `public/ffmpeg/` so the browser can fetch it
 * with a plain same-origin URL.
 *
 * The core cannot be imported as a module asset: its package `exports` map rejects `?url`
 * subpaths, and a bundler-resolved path would be absolute (which breaks `base: './'` on
 * GitHub Pages). Fixed public files resolve relative to the page instead.
 */

import { copyFile, mkdir } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const projectRoot = join(dirname(fileURLToPath(import.meta.url)), '..');
const sourceDir = join(projectRoot, 'node_modules', '@ffmpeg', 'core', 'dist', 'esm');
const targetDir = join(projectRoot, 'public', 'ffmpeg');

const FILES = ['ffmpeg-core.js', 'ffmpeg-core.wasm'];

await mkdir(targetDir, { recursive: true });

for (const name of FILES) {
  await copyFile(join(sourceDir, name), join(targetDir, name));
}

console.log(`ffmpeg core copied to ${targetDir}`);
