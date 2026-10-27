# Comparitoer

Compare two local video files in the browser: a duration check with tolerance, a before/after
wipe divider, and one shared timeline that plays both videos in sync. No backend, no uploads,
no accounts, no analytics. Deploys as static files.

- **A is the master clock.** B follows it: drift above 40 ms is corrected with a seek, smaller
  drift with a temporary 3 % playback-rate nudge.
- **Wipe divider.** A sits underneath, B is clipped from the divider to the right edge. Mouse,
  pen, touch and keyboard all move it.
- **Readouts.** Resolution, estimated frame rate and duration per video, plus informational
  chips when aspect ratios differ or frame rates are more than 1 % apart.
- **Local converter.** Formats the browser cannot decode (ProRes, FFV1/AVI, some HEVC/MKV) can
  be re-encoded to a temporary H.264 proxy with ffmpeg.wasm, on this machine.

## Requirements

- **Node.js 22.12+** — Vitest 5 requires `^22.12 || ^24 || >=26` and Vite 8 requires
  `^20.19 || >=22.12`; the Pages workflow pins **24**. Node 24 LTS is the recommended setup.
- **npm 10+** (the repo was developed on npm 12). `npm ci` needs a committed
  `package-lock.json`, which is present.
- A current **Chrome, Edge, Safari or Firefox** on desktop. Touch works; layout is responsive
  down to ~360 px.

There is nothing else to install or configure — no database, no API keys, no environment
variables.

## Run locally

```bash
npm ci
npm run dev
```

Vite prints a local URL (default <http://localhost:5173>). Open it and drop a video on each
drop zone, or use the two file pickers.

`npm run dev` and `npm run build` both start with `npm run core:copy`, which copies
`ffmpeg-core.js` and `ffmpeg-core.wasm` (~32 MB) out of `node_modules/@ffmpeg/core` into
`public/ffmpeg/`. That directory is gitignored and only matters for the local converter, but
the copy step runs unconditionally so a fresh clone always builds a complete `dist/`.

## Scripts

| Script               | What it does                                                        |
| -------------------- | ------------------------------------------------------------------- |
| `npm run dev`        | `core:copy` + Vite dev server with HMR                              |
| `npm run build`      | `core:copy` + production build into `dist/`                         |
| `npm run preview`    | Serves the built `dist/` at <http://localhost:4173>                 |
| `npm run typecheck`  | `tsc --noEmit` (strict, `noUncheckedIndexedAccess`, no unused code) |
| `npm test`           | Vitest unit specs in `tests/` (pure logic, Node environment)        |
| `npm run test:watch` | Vitest in watch mode                                                |
| `npm run core:copy`  | Copies the ffmpeg.wasm core into `public/ffmpeg/` only              |

**Definition of done for any change:**

```bash
npm run typecheck && npm test && npm run build
```

Playback *feel* cannot be verified from a terminal; run the manual checklist in
[TESTING.md](TESTING.md) in a real browser.

## Build

```bash
npm run build
```

Output in `dist/`:

```
dist/
├── index.html
├── favicon.svg
├── robots.txt
├── assets/
│   ├── index-<hash>.js
│   ├── index-<hash>.css
│   ├── transcode-<hash>.js   (lazy chunk for the local converter)
│   ├── worker-<hash>.js      (ffmpeg worker)
│   └── *.js.map              (sourcemap: true)
└── ffmpeg/
    ├── ffmpeg-core.js
    └── ffmpeg-core.wasm
```


## Privacy and network use

Files are streamed from disk through `URL.createObjectURL` and revoked when replaced or when
the page unloads. Nothing is uploaded, and there is no analytics, no CDN, no web font and no
third-party script.

After the initial page load the app makes **no network requests** for the compare workflow. The
single exception is the optional local converter: the first time a file needs converting,
`@ffmpeg/ffmpeg` loads `ffmpeg/ffmpeg-core.js` and `ffmpeg-core.wasm` **from this site's own
origin** (same folder as the page). That download is one-time per session, only triggered by
dropping a file the browser cannot decode, and the encoding itself then runs locally in a
worker. If the asset fetch fails (for example on a host that did not run `core:copy`), the
converter reports an error and playback of natively supported files is unaffected.

Verification: `grep -rnE 'fetch|XMLHttpRequest|WebSocket|sendBeacon' src/` finds no call sites —
only comments in `src/transcode.ts` that mention "fetched", and the network access itself lives
in ffmpeg.wasm, not in this codebase. Media never goes through `fetch`: `src/media.ts` is the
only owner of the `<video>`/`<audio>` elements and object URLs.

## Project layout

```
index.html                 app shell + static About/FAQ section for crawlers
src/main.ts                composition root: owns state, wires UI and engine
src/state.ts               AppState and slot types
src/media.ts               the only owner of <video>/<audio> elements and object URLs
src/sync.ts                SyncEngine: the only module that drives playback of both videos
src/audio.ts               Web Audio graph for the per-video mix and the external track
src/transcode.ts           the only module that talks to ffmpeg.wasm (lazy import)
src/logic/                 pure, DOM-free, unit-tested: duration, drift, fps, format, wipe,
                           keys, step, info, mix, audio, file, codec, slots, welcome
src/ui/                    dropzone, stage, wipe, infobar, duration-status, controls,
                           transport, settings, mix, shortcuts, welcome
src/styles.css             design tokens, dark/light, reduced motion
tests/                     Vitest specs for src/logic (Node environment)
scripts/copy-ffmpeg-core.mjs
public/                    favicon.svg, robots.txt, generated ffmpeg/ (gitignored)
.github/workflows/deploy.yml
```

More detail:

- [PROGRESS.md](PROGRESS.md) — per-phase log: what shipped, decisions, known limitations.
- [TESTING.md](TESTING.md) — manual browser checklist.
- [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md) — ffmpeg.wasm licensing.
