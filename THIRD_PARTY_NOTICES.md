# Third-party notices

This app is a static, client-side page. It ships no server code and makes no network requests at
runtime except for its own bundled files.

## FFmpeg / ffmpeg.wasm

The optional local codec converter uses these packages:

| Package | Version | License |
| --- | --- | --- |
| `@ffmpeg/ffmpeg` | 0.12.15 | MIT |
| `@ffmpeg/core` | 0.12.10 | GPL-2.0-or-later |
| FFmpeg (compiled into `@ffmpeg/core`) | 6.x | GPL-2.0-or-later |

`@ffmpeg/core` is a WebAssembly build of FFmpeg configured with `--enable-gpl`, which is why the
combined work is distributed under the GNU General Public License, version 2 or later. The npm
package does not include the license text; it is available in the upstream repository:

- https://github.com/ffmpegwasm/ffmpeg.wasm/blob/main/LICENSE
- https://github.com/FFmpeg/FFmpeg/blob/master/COPYING.GPLv2

The unmodified core files are copied verbatim from the npm package into `public/ffmpeg/` by
`scripts/copy-ffmpeg-core.mjs` at build time; they are not patched or recompiled here.

Corresponding source: https://github.com/ffmpegwasm/ffmpeg.wasm (build scripts and patches) and
https://ffmpeg.org/ (FFmpeg). Both are fetched from the npm registry at install time, not at
runtime.

### What that means for this app

- The converter is opt-in: it is loaded only after the user picks **Convert locally** on a file the
  browser cannot decode. A normal comparison of MP4/WebM files never fetches the core.
- Conversion runs entirely in the browser tab. Files are not uploaded anywhere.
- The converted proxy is a temporary in-memory object URL; it is revoked on file replacement and on
  page unload.
- If you redistribute this app, keep this notice and the GPL text with it, and keep the FFmpeg
  source offer above intact.
