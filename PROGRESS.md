# PROGRESS

Running log for the video-compare app. One entry per phase.

---

## Phase 0 — Scaffold ✅

**Done**

- `git init -b main` (no remote yet, no push).
- Vite 8.3.5 + TypeScript 7.0.2 + Vitest 5.0.5 as the only dev dependencies. Zero runtime dependencies.
- `vite.config.ts` with `base: './'` so a single `dist/` works on both Vercel and GitHub Pages.
- `tsconfig.json`: `strict`, `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`,
  `verbatimModuleSyntax`, `noUnusedLocals/Parameters`, `noEmit`, `types: []`.
- `.gitignore` (node_modules, dist, coverage, test-media, editor/OS junk) and
  `.gitattributes` (`* text=auto eol=lf`, byte-exact `package-lock.json` and `*.mp4`).
- `.github/workflows/deploy.yml`: build job (npm ci → typecheck → test → build) then
  `upload-pages-artifact` + `deploy-pages`, triggered on push to `main` and manually.
- App shell: `index.html` → `src/main.ts` (composition root, mounts header + `#stage-root`)
  and `src/styles.css` (design tokens, reset, motion preferences, light/dark tokens).
- `src/vite-env.d.ts` with `/// <reference types="vite/client" />`.
- **Module skeleton** — the full tree from the plan exists as typed contracts (no behavior yet,
  real implementations land in their own phases):
  - `src/state.ts` — `SlotId`, `AudioSource`, `PLAYBACK_SPEEDS`/`PlaybackSpeed`,
    `DEFAULT_WIPE_POSITION`, `VideoSlot`, `WipeState`, `CompareSettings`, `AppState`,
    `createEmptySlot()`, `createInitialState()`.
  - `src/logic/format.ts` — `TimeParts`, `TimeFormatter`, `TimeSplitter`.
  - `src/logic/duration.ts` — `DEFAULT_DURATION_TOLERANCE_SECONDS` (0.05), `DurationStatus`,
    `DurationCheck`, `DurationChecker`, `DurationGuard`, `TimelineDuration`.
  - `src/logic/drift.ts` — `DRIFT_HARD_SEEK_SECONDS` (0.04), `DRIFT_NUDGE_SECONDS` (0.01),
    `DRIFT_NUDGE_RATE` (0.03), `DriftAction`, `DriftSample`, `DriftDecision`, `DriftDecider`.
  - `src/logic/fps.ts` — `FALLBACK_FPS` (30), `FPS_WARNING_RATIO` (0.01), `FpsEstimate`,
    `FpsEstimator`, `FrameIndexAt`, `SnapToFrame`, `FpsDiffer`.
  - `src/sync.ts` — `SyncEngine` (play/pause/togglePlay/seek/seekBy/stepFrames/scrub trio/
    setSpeed/setAudioSource/setLoop/swap/getCurrentTime/getTimelineDuration/isPlaying/destroy),
    `SyncEngineOptions`, `SyncEventHandlers`, `SyncEngineFactory`.
  - `src/ui/dropzone.ts`, `stage.ts`, `wipe.ts`, `infobar.ts`, `controls.ts`, `shortcuts.ts` —
    one `Options`/controller interface pair each, plus `SHORTCUT_HELP` and
    `VIDEO_ACCEPT_ATTRIBUTE` as plain data.
  - `tests/.gitkeep` so the specs directory survives until Phase 1.

**Gate:** `npm run typecheck && npm test && npm run build` — all green.
`dist/index.html` references `./assets/...` (relative, verified by inspecting the output).

**Decisions**

- `src/logic/fps.ts` added as a fourth pure module (approved): FPS estimation, frame
  indexing and frame snapping are unit-testable math and are shared by the frame counter,
  frame stepping and the info-bar FPS chip. Sampling stays in `sync.ts`.
- `test-media/` is gitignored — fixtures are for manual browser checks only and are never
  referenced by `index.html`, so the Pages artifact is unaffected.
- `progress.md` (empty) was deleted and `PROGRESS.md` created in its place. On this
  case-insensitive filesystem they are the same file, so no history was lost.
- TypeScript 7 rejects untyped side-effect imports (TS2882), which is why
  `src/vite-env.d.ts` exists. Keep it — removing it breaks `import './styles.css'`.
- `npm run build` is `vite build` only; typechecking is a separate script so CI and the
  local gate don't run `tsc` twice.
- `npm test` carries `--passWithNoTests` **for Phase 0 only**; drop it when Phase 1 lands
  the first spec files.
- CI runs `typecheck` and `test`, so the workflow stays red until Phase 1. Expected.
- All npm/git commands must run through `cmd.exe /C` — WSL has no node or git. Shell output
  capture is unreliable in this environment, so gate output is redirected to a log file.
- Node 24 / npm 12, git 2.55, identity already configured globally (`gothmiku`). No
  `git config user.*` writes were needed.
- "Typed empty modules" are written as **contracts only**: exported types, interfaces and the
  numeric constants the spec names. No throwing stubs and no no-op objects, because the
  working agreement bans placeholders and lies; every file therefore typechecks honestly and
  adds zero bytes to the bundle (verified: the built hashes are unchanged).
- Kernel of the skeleton kept deliberately small: `format.ts` exports only types,
  `duration.ts`/`drift.ts`/`fps.ts` additionally export their spec'd tolerances as constants,
  and only `state.ts` carries real code (`createEmptySlot`, `createInitialState`), because
  it is plain data, not feature logic.
- `state.ts` imports `DEFAULT_DURATION_TOLERANCE_SECONDS` from `logic/duration.ts`;
  `duration.ts` imports `SlotId` back as a **type-only** import, so under
  `verbatimModuleSyntax` the back-edge is erased and there is no runtime cycle.
- UI/sync signatures are provisional: they encode the current spec, but a phase may refine a
  method list when it implements that module. Anything renamed there must be updated in
  `PROGRESS.md`.
- `tests/` is tracked through `tests/.gitkeep`; Vitest's include stays `tests/**/*.test.ts`,
  so `npm test` still reports "No test files found, exiting with code 0".

**Manual verification needed (browser)**

1. `npm run dev`, open the served URL: header "Video Compare" + tagline render, dark by
   default and readable in light mode, no console errors, no network requests beyond the
   dev bundle.
2. `npm run preview` and open `dist/`: same shell, and the asset URLs resolve relative to
   the page (they must work from a subpath such as `/<repo>/`).
3. DevTools → Sources: only one JS chunk is loaded (`index-*.js`); none of the skeleton
   modules (`state.ts`, `sync.ts`, `logic/*`, `ui/*`) appear, because nothing imports them
   yet — they only exist to be typechecked.

**Next:** Phase 1 — `src/logic/` pure modules (`format.ts`, `duration.ts`, `drift.ts`,
`fps.ts`) plus their Vitest specs.

---

## Phase 1 — Logic: format, duration, drift (+ specs) ✅

**Done**

- `src/logic/format.ts` — `splitTime(totalSeconds)` and `formatTime` (`TimeFormatter`).
  Rounds to whole milliseconds *before* splitting, so carries land on the right unit
  (`59.9996 → 01:00.000`, `3599.9996 → 01:00:00.000`, never `00:60.000`). Format is
  `mm:ss.mmm`, switching to `hh:mm:ss.mmm` from one hour up (hours are not truncated at 99).
  Negative input clamps to `00:00.000`; NaN and ±Infinity render `INVALID_TIME_TEXT`
  (`--:--.---`). `splitTime` normalises the same way and never emits `-0` or fractions.
- `src/logic/duration.ts` — `isValidDuration`, `compareDurations`, `timelineDuration`
  (plus the existing `DEFAULT_DURATION_TOLERANCE_SECONDS = 0.05`).
  - Returns `{status, match, durationA, durationB, deltaSeconds, deltaMs, longer, clampTo,
    toleranceSeconds}` (superset agreed with the user: `status` drives the aria-live text).
  - Comparison is `<=` with a `1e-9` epsilon so a delta exactly at the tolerance matches even
    with binary noise (`1.3 - 1.2 === 0.10000000000000009` at tolerance `0.1`).
  - `longer` is `'a'` / `'b'` on a mismatch, `null` on a match; `clampTo` is always
    `min(A, B)` — the "Compare anyway" timeline length.
  - NaN, ±Infinity, `0` and negatives are `status: 'invalid'` with `deltaMs: NaN` and
    `clampTo: NaN` (never a fake mismatch, never a throw).
  - An unusable tolerance (NaN/negative/Infinity) falls back to the default instead of
    silently matching everything.
- `src/logic/drift.ts` — `decideCorrection(sample)` returning
  `{action, playbackRate, rateAdjustment}`:
  - `|drift| < 0.01` → `'none'`, base rate restored.
  - `0.01 <= |drift| <= 0.04` (both boundaries inclusive) → `'nudge'`, B runs at
    `base × (1 ∓ 0.03)`: 3% slower when B is ahead (positive drift), 3% faster when behind.
  - `|drift| > 0.04` → `'hardSeek'` at the base rate.
  - Non-finite drift → `'none'` (no measurement must not cause a seek loop); non-finite or
    non-positive base rate → `1`. Decision is derived from `basePlaybackRate` every call, so
    it is idempotent; `nudging` stays in the sample for engine bookkeeping only.
- **Specs (51 tests, all passing):** `tests/format.test.ts` (13), `tests/duration.test.ts` (20),
  `tests/drift.test.ts` (18). Coverage requested: exact tolerance and just past it, the
  float-noise boundary case, negative drift, both the `0.01` and `0.04` boundaries (inclusive)
  plus `0.0099` / `0.0401`, NaN, ±Infinity, zero/negative durations, base rates 0.5/1.5/2x,
  idempotence, and times over one hour (`3600`, `3600.25`, `3725.5`, `86399.999`, `360000`,
  `3599.9996` carry, `3600.5` vs `3600.54` duration pair).
- `package.json`: `test` is now plain `vitest run` (`--passWithNoTests` dropped, per Phase 0).
- `tests/.gitkeep` deleted — the three spec files keep the directory alive.

**Gate:** `npm run typecheck && npm test && npm run build` — all green
(typecheck exit 0; 3 files / 51 tests passed; build exit 0, `dist/assets/index-*.js` still
1.25 kB because the logic modules are not imported by the shell yet).

**Decisions**

- `DurationCheck` gained `match`, `deltaMs` and `clampTo` (superset, user-approved) and its
  `status` is now the narrowed `DurationVerdict` (`'match' | 'mismatch' | 'invalid'`) because
  `pending` is UI state that the pure function cannot observe.
- `DriftAction` renamed from `'in-sync' | 'nudge-slower' | 'nudge-faster' | 'hard-seek'` to
  `'none' | 'nudge' | 'hardSeek'` as requested; the sign now lives in `rateAdjustment`
  (`-0.03` = B too far ahead). Previously recorded signatures in this log for Phase 0 are
  superseded by these names.
- `rateAdjustment` is reported as the constant fraction (`±0.03`) rather than
  `playbackRate / base - 1`, so it stays exact and test-stable.
- `timelineDuration` was added as a real implementation of the `TimelineDuration` contract
  (min(A, B), NaN when invalid) so the sync engine does not need to re-derive it.
- `tests/` is a flat directory (no subfolders) because Vitest's include is `tests/**/*.test.ts`
  and three files do not need nesting yet.
- Terminal capture through shell integration is unreliable in this environment; gate runs were
  redirected to log files and read back. Those scratch logs were deleted afterwards, so nothing
  untracked is left in the working tree.
- `resolveBaseRate` / `inSync` helpers in `drift.ts` are module-private on purpose: the public
  surface stays `decideCorrection` plus the constants and types.

**Not done / still contracts:** `src/logic/fps.ts` (`FpsEstimator`, `FrameIndexAt`,
`SnapToFrame`, `FpsDiffer`) was outside this phase's scope and remains types + constants only.
`SyncEngine` and the `src/ui/*` modules are still contracts. Manual browser verification is not
meaningful yet: nothing imports these modules, so `npm run dev` must look exactly like Phase 0.

**Next:** `src/logic/fps.ts` implementation + spec (FPS estimation from rVFC `mediaTime`
deltas, frame index, frame snapping, 1% chip), then the state/store wiring and the stage.

---

## Phase 2 — File loading, object URLs and the duration check ✅

**Done**

- **`src/logic/file.ts` (new, pure)** — all file/error copy in one testable place:
  - `labelFromFilename` strips only the last extension (`archive.tar.gz` → `archive.tar`),
    keeps dotfiles (`.env`), leaves `trailing.` alone and falls back to `FALLBACK_LABEL`
    ("Untitled video") for blank names.
  - `isProbablyVideoFile` treats a non-empty MIME type as authoritative (`video/*` passes,
    `image/png` named `clip.mp4` fails) and only falls back to `VIDEO_FILE_EXTENSIONS` when
    the browser reports no type — which is what lets an `.mkv` reach the media element and
    produce an honest codec error instead of a bogus "not a video" one.
  - `classifyMediaError` maps `MediaError.code` 1–4 to
    `aborted | network | decode | unsupported | unknown`.
  - `nonVideoMessage` / `mediaErrorMessage` name the file, and decode/unsupported/unknown
    suggest re-encoding to H.264 MP4 or WebM.
- **`src/media.ts` (new)** — `MediaLoader`, the single owner of the two `<video>` elements and
  of every object URL:
  - `load(slot, file)` revokes the slot's previous URL *before* creating the replacement,
    attaches `loadedmetadata`/`error` listeners, sets `src` and resolves
    `{status: 'loaded', metadata}` | `{status: 'error', kind, message}` |
    `{status: 'superseded'}`.
  - A per-slot generation counter plus a URL identity check make a superseded or queued event
    unable to settle a newer attempt; a replaced slot resolves its pending promise exactly once
    as `superseded`.
  - `clear(slot)` / `releaseAll()` settle pending loads, revoke URLs, remove `src` and call
    `load()` to abort any read of the old file. `pagehide` releases both URLs; `destroy()`
    also detaches the listener and removes the elements.
  - Elements are `preload="metadata"`, muted, `playsInline`, `aria-hidden`, `tabindex="-1"`
    and live in an off-screen `.media-host` (`clip-path`, not `display:none`, so metadata
    still loads). No `fetch`, no whole-file reads, no network.
- **`src/ui/dropzone.ts` (implemented)** — `createDropzone`: hidden file input + a real
  `<button>` (Enter/Space, focus ring, 44 px target), click-to-pick, full drag-and-drop
  (`dragenter/over/leave/drop`, depth counter so child elements don't flicker the highlight,
  `dropEffect: 'copy'`, Files-only). Four view states `empty | loading | ready | error`, the
  filename ellipsis-truncated with a `title`, an inline error linked through
  `aria-describedby`, `aria-busy` while loading. `input.value` is cleared on every `change`
  so re-picking the same file fires again. The zone never disables itself: every state can be
  replaced.
- **`src/ui/duration-status.ts` (new)** — the app's **only** `aria-live="polite"` region
  (`role="status"`, `aria-atomic`). Renders `{tone, message, detail, action}`; the action
  button sits outside the live area so announcing a message never reads the button label.
  Tones are `neutral | ok | warn | danger`, colour-coded through `data-tone`.
- **`src/ui/settings.ts` (new)** — header "Settings" trigger (`aria-expanded`,
  `aria-controls`, `aria-haspopup="dialog"`) and a `role="dialog"` panel with a labelled
  number field for the tolerance, hint text, inline error, and "Reset to 0.05 s". Applies on
  `change` and Enter; invalid input (blank, negative, non-finite) shows
  `TOLERANCE_ERROR_TEXT` and leaves the active tolerance untouched; blur restores the last
  valid value. Escape closes and returns focus to the trigger; outside pointerdown and
  focus-out close it. `setTolerance()` never overwrites a field the user is editing.
- **`src/logic/duration.ts` (extended)** — `parseTolerance` (plain + exponential notation,
  zero allowed, blanks/negatives/non-finite rejected), `formatToleranceSeconds` (trailing-zero
  trimming) and `TOLERANCE_ERROR_TEXT`.
- **`src/state.ts`** — new `SlotStatus` (`empty | loading | ready | error`) plus
  `VideoSlot.status` and `VideoSlot.error`; `createEmptySlot` starts at `empty`/`null`.
- **`src/main.ts`** — composition root for this phase: header (titles + settings), a responsive
  two-column loader grid, the status panel, and the off-screen media host. `selectFile` rejects
  non-video files inline, otherwise resets metadata, shows the loading state, awaits
  `media.load`, ignores superseded outcomes and re-runs the duration check. The check is
  recomputed on every change (file, tolerance, "Compare anyway"). Window-level `dragover`/`drop`
  `preventDefault` stops a missed drop from navigating away; `pagehide` releases URLs and
  returns the UI to a clean empty state so a bfcache restore can never show a released `src`.
- **`src/styles.css`** — loader grid (2 columns ≥ 720 px, 1 below, still fine at 360 px), dashed
  drop zone with drag-over/error variants, mono ellipsized filename, status panel with tone
  accents, settings popover (`min(320px, 100vw - 32px)`, right-aligned), hidden media host. All
  colours come from the existing tokens, so light/dark and reduced motion are inherited.

**Status copy**

- idle: "Load both videos to check their durations."
- one slot empty: "Load video A to check durations."
- loading: "Reading duration metadata…" + which video is still pending.
- match (green): `Durations match (A 00:10.000 / B 00:10.017)` plus the delta and tolerance.
- mismatch (amber): `Durations differ by 183 ms. Video B is longer (A 00:10.000 / B 00:10.183).`
  + "Compare anyway".
- acknowledged: `Comparing the shorter video (00:10.000).`
- invalid duration: "The duration of video A could not be read." + re-encode advice.
- load failure: "Video A could not be loaded." with the per-file message underneath.

**Gate:** `npm run typecheck && npm test && npm run build` — exit 0.
4 spec files / **75 tests** pass (13 format, 25 duration, 18 drift, 19 file).
Build: `dist/assets/index-Ch0Hy0LY.js` 16.91 kB (5.79 kB gzip), `index-zSCxY9PC.css`
6.91 kB (1.96 kB gzip), `dist/index.html` still references `./assets/...`.
Verified the bundle contains `createObjectURL`, `revokeObjectURL`, the `aria-live` region and
the status copy, i.e. the new modules are really wired in.

**Decisions**

- **`src/media.ts` owns the elements, not just the URLs.** Metadata has to be read before a
  stage exists, and the spec bans two owners of `src`. The stage phase therefore mounts
  `media.videoA` / `media.videoB` instead of creating new elements.
- **Three new UI/logic modules** (user-approved in the plan): `logic/file.ts`,
  `ui/duration-status.ts`, `ui/settings.ts`. Tolerance parsing lives in `logic/duration.ts`
  (pure + tested) rather than in the popover module.
- **One live region only.** The duration status is the single `aria-live` region; the inline
  drop-zone error is static text linked with `aria-describedby`, otherwise every error would
  be announced twice.
- **"Compare anyway"** sets `AppState.compareAnyway` and keeps
  `timelineDurationSeconds = min(A, B)`; the status switches to "Comparing the shorter
  video (…)". Any new file or a tolerance change clears the flag and re-runs the check, so
  acknowledgement is never stale.
- **Non-video files clear the slot** (file, URL, metadata, label) but leave the other slot
  untouched, and the message names the rejected file.
- **Media errors are classified, not guessed**: `MediaError.code` is mapped in pure code and
  the copy is generated in `logic/file.ts`, which is why it is unit-tested there.
- **`response`-style outcomes instead of throws.** `load()` resolves `superseded` rather than
  rejecting, so a replaced slot needs no `try/catch` and cannot produce an unhandled
  rejection.
- **`pagehide` resets the UI to the initial empty state.** The spec requires revoking URLs on
  unload; resetting keeps the DOM honest if the page is restored from bfcache.
- **Extensions are only trusted when the browser reports no MIME type**, so `.mkv` can still
  reach the media element and fail with a real codec message (test-media has no MKV, but a
  ProRes `.mov` behaves the same way).
- **Delta formatting**: whole milliseconds from 10 ms up, one decimal below that, so a 0.4 ms
  mismatch never renders as "0 ms".

**Known limitations / not done yet**

- No stage, no playback, no info bar, no controls, no wipe divider, no shortcuts — that is the
  next phase. Nothing outside this phase's scope was built.
- There is deliberately no metadata timeout: a local blob that never fires `loadedmetadata`
  (e.g. a file being written while dropped) leaves the zone in "Reading…". Replacing the file
  clears it. Worth a hand check.
- `ui/controls.ts`, `ui/stage.ts`, `ui/wipe.ts`, `ui/infobar.ts`, `ui/shortcuts.ts`,
  `sync.ts` and `logic/fps.ts` are still contracts (types only).

**Manual verification needed (browser)** — use `test-media/`

1. `npm run dev`, open the URL: two zones side by side (stacked under 720 px), settings button
   top-right, status says "Load both videos…". No console errors.
2. Drop `a-10s-30fps.mp4` on A and `b-10s-30fps-gray.mp4` on B → green
   `Durations match (A … / B …)`. B is a re-encode so the delta should be a few ms.
3. Replace B with `b-12s-gray.mp4` → amber mismatch, delta ≈ 2000 ms, "Video B is longer",
   "Compare anyway" visible. Click it → status says "Comparing the shorter video (00:10.000)".
   Replace B again → the check runs again and the button returns.
4. Open Settings, set tolerance `0.01` → the 10 s pair still matches if the delta is under
   10 ms; set `0` → any delta shows a mismatch. Enter/empty/`-1`/`abc` must not change the
   active tolerance and must show the inline error; Escape closes and focuses the trigger.
5. Drop a `.txt` on A → inline error naming the file + danger status, A can immediately be
   replaced, B and its URL are untouched (B still shows its metadata).
6. Drop a ProRes `.mov` / non-H.264 `.mkv` → "This browser cannot play … unsupported
   (ProRes, and some HEVC and MKV files)… re-encode to H.264 MP4 or WebM".
7. Replace a large file while it is still "Reading…" → only the last file's metadata appears,
   and the first zone never flickers back to the old file.
8. In the console: `const v = document.querySelector('.media-host__video'); copy(v.currentSrc)`
   → replace that file → `fetch(pastedUrl)` must reject (URL revoked). Network panel must show
   only local bundle requests plus `blob:` media, never anything leaving the device.
9. Keyboard only: Tab reaches each zone button and Settings, Enter/Space opens the picker,
   the status region is announced politely, focus rings are visible. Check 360 px width and
   light mode.

**Next:** Phase 3 — stage: mount `media.videoA` / `media.videoB` into one stacked box
(`object-fit: contain`, B clipped with `clip-path`), wipe divider with Pointer Events and
slider semantics, corner labels/renaming, and the per-video info bar. Playback and the sync
engine stay out until after that.




---

## Phase 3 — Stage, wipe divider, corner tags, info bar ✅

**Done**

- **`src/logic/wipe.ts` (new, pure)** — `WIPE_MIN_PERCENT` 0, `WIPE_MAX_PERCENT` 100,
  `WIPE_DEFAULT_PERCENT` 50, `WIPE_STEP_PERCENT` 1, `WIPE_STEP_LARGE_PERCENT` 10,
  `clampWipePosition` (non-finite → default, clamps, rounds to 2 decimals so
  `aria-valuenow` cannot wobble), `positionFromRatio` (pointer x/width → percent) and
  `applyWipeKey` (ArrowLeft/Right ±1 %, Shift ±10 %, Home/End, `null` for anything else).
- **`src/logic/info.ts` (new, pure)** — `ASPECT_RATIO_WARNING_RATIO` 0.01,
  `UNKNOWN_FACT_TEXT` "—", `formatResolution` (`1280 × 720`), `formatAspectRatio`
  (reduced `16:9`, decimal `1.78:1` when the reduction exceeds 32), `formatFps`
  (`30 fps`, `23.98 fps`), `aspectRatioDiffer` and `infoWarnings` (fixed order: aspect
  ratio, then frame rate; no chip while a fact is unknown).
- **`src/logic/fps.ts`** — `fpsDiffer` implemented (relative to the faster rate, `> 1 %`,
  unusable/missing estimates never warn). The estimator/frame-index/snap contracts stay
  for Phase 4.
- **`src/state.ts`** — `DEFAULT_WIPE_POSITION` is now an alias of `WIPE_DEFAULT_PERCENT`,
  so the default lives in exactly one place.
- **`src/ui/wipe.ts`** — one 44 px-wide hit strip (`--tap-target`) centred on the divider,
  2 px line, 34 px round handle with two grip dots. `role="slider"`,
  `aria-orientation="horizontal"`, `aria-valuemin/max/now/valuetext`, `tabindex="0"`,
  `aria-label="Wipe divider between video A and video B"`. Pointer Events with
  `setPointerCapture`; `pointerup`/`pointercancel`/`lostpointercapture` all end the drag;
  `touch-action: none`; no transition (the clip must track the finger). Writes
  `clip-path: inset(0 0 0 X%)` on B and `left: X%` on the strip. `setPosition()` paints
  without reporting back, so external sync cannot echo.
- **`src/ui/stage.ts`** — one `.stage` (role `group`, labelled) around a `.stage__frame`
  whose shape comes from A (`--stage-ar`, capped by
  `max-width: calc(72dvh * var(--stage-ar))`). Both `<video>` elements fill the frame with
  `object-fit: contain`; A is z1, B is z2 and clipped. Corner chips (z4) hold an A/B badge
  and an always-editable input: Enter/blur commits a trimmed value, Escape reverts,
  `title` shows the full text, an empty input falls back to the filename stem (resolved by
  the composition root), and `setText()` never overwrites an in-progress edit.
- **`src/ui/infobar.ts`** — two rows (badge, label, resolution, FPS, duration) plus a chip
  list and the note "Informational only: playback is synced by time, not frames."
  The chip area is hidden while there is nothing to report. Each row gets an `aria-label`
  with all four facts; nothing here is an `aria-live` region.
- **`src/media.ts`** — `host` is now optional (the stage adopts the elements),
  `preload="auto"` so the first frame paints before playback exists, element class
  `video-layer` (the hidden `.media-host` wrapper and its CSS are gone).
- **`src/main.ts`** — new `.compare` section (stage + info bar) above the loader, hidden
  until both slots hold a usable file; `syncCompare()` draws stage visibility, A's aspect
  ratio, both tags, both info rows and the chips. Labels are committed back to
  `state.slot.*.label`, so a rename survives an info refresh and a new file resets it to
  the new stem. The wipe position is mirrored into `state.wipe.position`. The loader gains
  `loader--compact` once the stage is up: the zones become a slim replace row.
- **`src/styles.css`** — compare/stage/wipe/tag/infobar/compact-loader blocks, tokens only
  (the stage backdrop and tag chips deliberately keep fixed dark values, because video is
  always shown on black). 44 px targets, focus ring moved to the handle, chips wrap.
- **Tests:** `tests/wipe.test.ts` (15), `tests/info.test.ts` (21), `tests/fps.test.ts` (6).

**Gate:** `npm run typecheck && npm test && npm run build` — exit 0.
7 spec files / **117 tests** pass. Build: `index-D7IecwJF.js` 25.21 kB (8.24 kB gzip),
`index-ygX5Q63A.css` 11.40 kB (2.87 kB gzip).


**Extra verification (headless Chrome, throwaway scripts, deleted afterwards)**

Drove the built `dist/` through the DevTools protocol (Node built-ins only, no new
dependencies) and dropped the real fixtures through the app's own drop zones:

- Start: stage present but hidden, slider at `aria-valuenow="50"`, B clipped
  `inset(0px 0px 0px 50%)`, info rows showing `—` / `--:--.---`.
- ArrowRight → 51 %, Shift+ArrowLeft → 41 %, End → 100 %, ArrowRight at 100 stays 100,
  Home → 0 %, Shift+ArrowRight → 10 %, ArrowUp left alone (`defaultPrevented` false).
  Every handled key updates `aria-valuenow`, `left` and B's `clip-path` together.
- Rename A to `"  Take 2  "` + Enter → the field shows `Take 2`, the info row shows
  `Take 2`, its `aria-label` reads `A: Take 2, —, —, --:--.---`. Escape after typing
  `discard me` restores `Take 2` and blurs. Clearing + Enter falls back to `Video A`.
- A only → stage hidden, `loader--compact` off, A's metadata already in the info bar.
- A + B (1280×720 / 1280×720) → stage visible, compact zones, tags = filename stems,
  frame 16:9, no chips, "Durations match".
- B replaced with `c-10s-24fps-4x3.mp4` → stage stays up (no layout jump), B is 640×480,
  the frame stays 16:9 (A's shape), B letterboxes inside it, and the chip
  "Aspect ratios differ: A 16:9, B 4:3." appears.
- A replaced with the 4:3 file → frame becomes 1.3333, tags and info rows follow, chips
  disappear.
- Zero uncaught exceptions across all of the above.

Fixture note: `a-10s-30fps.mp4` is **1280×720** (not 1920×1080 as the phase plan assumed),
so the "wildly different resolutions" case is 1280×720 next to 640×480.

**Decisions**

- **The stage mounts the media loader's elements** instead of creating its own, keeping a
  single owner of `src`. `media.ts` therefore takes an optional host.
- **`Stage` lost `onMetadata`, `onMediaError`, `showError` and `clearError`.** Metadata and
  media errors were already handled by `media.ts`, the drop zones and the status region;
  an unused overlay would have been dead code. Codec failures name the file in the zone and
  in the status panel, and simply hide the stage.
- **The frame shape comes from A**, the master clock, so both layers letterbox the same
  way: A 16:9 with B 4:3 keeps a 16:9 stage and pillarboxes B inside it.
- **The tag is an always-editable input, not `contenteditable`.** Enter/blur commit,
  Escape reverts, `autocomplete`/`spellcheck` off, `enterkeyhint="done"`, and `setText()`
  skips the field while it holds an uncommitted edit.
- **`preload="auto"` replaces `preload="metadata"`**: two black rectangles could not be
  compared by eye before playback exists. Frames come from the local blob, nothing is
  uploaded, and the browser still streams instead of slurping the whole file.
- **Wipe positions are rounded to 2 decimals** so the integer `aria-valuenow` and the
  clip-path can never disagree by a sub-pixel that reads as jitter.
- **The info bar is not a live region.** The duration status stays the app's only
  `aria-live` area; the info bar is descriptive and carries a per-row `aria-label` instead.
- **`loader--compact`** keeps replacement one click away without eating the viewport, and
  stays a single column below 560 px.
- **A slot in `loading` keeps the stage visible** (its frame goes black until metadata
  lands) so replacing a file never makes the layout jump; empty or errored slots hide it.

**Known limitations / not done yet**

- **FPS reads `—` in this phase.** An honest estimate needs `requestVideoFrameCallback`
  samples during playback, which is Phase 4; the chip logic is implemented and tested and
  goes live as soon as `state.slot.fps` is filled. The FPS chip therefore cannot be seen
  yet — the aspect-ratio chip can.
- No playback, no sync engine, no controls, no shortcuts, no audio selector, no loop, no
  fullscreen, no swap: both videos stay paused at whatever frame the browser painted.
- The divider is a percentage of the **frame**, not of the visible picture, so with a
  letterboxed B the split edge can sit inside the black bars. That is identical for both
  layers and matches the spec's `inset(0 0 0 X%)` wording; it will look odd only if the
  two source shapes differ a lot.
- `state.wipe.dragging` still exists in the contract but nothing sets it yet; it becomes
  meaningful when the controls need to know a drag is in progress.
- Renames live in memory only and are lost on pagehide, along with the files.

**Manual verification needed (browser)** — use `test-media/`

1. `npm run dev`, drop `a-10s-30fps.mp4` on A and `b-10s-30fps-gray.mp4` on B: the stage
   appears above the two compact zones, both first frames are visible, A left of the
   divider and B right of it, divider in the middle, tags read `a-10s-30fps` /
   `b-10s-30fps-gray`.
2. Drag the divider edge to edge: the split follows the pointer exactly, with no lag and no
   transition, B's picture is cropped at the line, the handle stays centred, no text gets
   selected, and the drag keeps working after the pointer leaves the stage (capture).
3. Focus the divider with Tab: the focus ring appears on the handle. ArrowLeft/Right move
   1 %, Shift moves 10 %, Home/End jump to the ends, and the handle stops at both edges.
   With a screen reader the slider announces its value and the 0/100 ends.
4. Rename tag A to `Take 2` (Enter) → chip and info row both change. Type something and
   press Escape → the old name returns. Clear it and press Enter → the chip must not be
   left blank; it falls back to the filename stem.
5. Drop `c-10s-24fps-4x3.mp4` on B: the stage stays put, B is pillarboxed inside a 16:9
   frame, B's picture lines up with A's along the divider, and the amber chip
   "Aspect ratios differ: A 16:9, B 4:3." appears next to the "synced by time" note.
6. Drop the 4:3 file on A as well: the frame becomes 4:3 and the chips disappear.
7. Replace A while both are loaded: no layout jump, no white flash, black until the new
   first frame lands, then the new name, resolution and duration everywhere.
8. Resize down to 360 px: the frame shrinks keeping its shape, the two tag chips stay
   inside the stage and truncate instead of overlapping, info values wrap under the label,
   and the compact zones stack into one column. Check light mode (chips stay legible on the
   black stage) and reduced motion (nothing animates).
9. Zoom to 200 %: divider, handle and tags stay usable and the info bar wraps without
   horizontal scrolling.

**Next:** Phase 4 — `src/sync.ts`: A as the master clock, play/pause after
`readyState >= 3` on both, rVFC drift sampling fed into `decideCorrection` (hard seek
> 40 ms, ±3 % nudge from 10 ms), waiting/stalled handling, rAF-throttled scrubbing, the
audio selector, loop, and the FPS sampling that finally lights up the frame-rate chip.

---

## Phase 4 — Sync engine, play/pause, timeline scrubber, time display ✅

**Done**

- **`src/sync.ts` is now a real engine** (`createSyncEngine`), the only module that touches
  `currentTime`, `play()`, `pause()` or `playbackRate`:
  - `play()` waits for `readyState >= 3` on both, re-anchors both elements on one time,
    `play()`s both in parallel and only then re-ports the play state; a rejected `play()`
    reverts to paused and rethrows. Replaying after the end starts from 0.
  - `pause()` bumps a token so an in-flight `play()`/readiness wait can never win later,
    cancels rVFC/rAF, restores the base rate and pauses both.
  - **Drift**: sampled on the master through `requestVideoFrameCallback` (fallback
    `requestAnimationFrame`), `drift = B.currentTime - A.currentTime` handed to
    `decideCorrection` from `logic/drift.ts`. A always runs at the selected speed; only B is
    ever nudged (±3 %) or hard-seeked (> 40 ms). The strategy is documented in a comment at
    `sampleDrift`.
  - **Stall handling**: `waiting`/`stalled` on either element pauses both and keeps the play
    intent; `canplay`/`canplaythrough`/`loadeddata`/`seeked` re-anchors and resumes once both
    report `readyState >= 3`.
  - **Scrubbing**: `beginScrub` remembers the play intent and pauses both; `scrubTo` stores
    the newest value, updates the readout immediately and applies at most one seek per
    animation frame; `endScrub` applies the final position synchronously and resumes once.
    `scrubTo` without `beginScrub` (keyboard/AT) seeks immediately.
  - **End of timeline**: reaching `min(durationA, durationB)` pauses on the exact end and
    emits `ended`; with loop on it jumps both to 0 and keeps running without a play-state
    flicker. `endHandled` prevents the sampler and the `ended` event from both firing.
  - Also implemented and wired for later phases: `setSpeed`, `setAudioSource` (A → B → mute
    with the other element always muted), `setLoop`, `swap` (exchanges the clock, keeps the
    playhead), `stepFrames` (snapped to 30 fps boundaries, pauses first), `seek`, `seekBy`,
    `getCurrentTime` (reads whichever element currently owns the clock), `getTimelineDuration`
    (reuses `timelineDuration`), `isPlaying`.
  - **Cleanup**: every listener goes through one remover list; `destroy()` and `pagehide`
    cancel readiness waiters, rVFC/rAF and scrub frames, restore rates and detach everything.
    A replaced source (`emptied`) resets playhead/stall/scrub state while keeping speed, loop
    and audio. `visibilitychange` re-arms sampling because rVFC/rAF stop in hidden tabs.
- **`src/ui/controls.ts`** — Play/Pause button, native `<input type="range">` timeline and a
  mono `00:12.345 / 03:00.000` readout. Pointer down starts a scrub, `input` feeds positions,
  window `pointerup`/`pointercancel` plus `change` end it (a drag that leaves the bar still
  releases), and the thumb is never overwritten while dragging. Disabled until a finite
  timeline exists; live `aria-valuetext`.
- **`src/main.ts`** — creates the engine on the media loader's elements and the controls
  above the info bar, mirrors `timeUpdate`/`playStateChange`/`ended` into `AppState`, renders
  controls from `syncCompare`, stops playback before a source replacement and on `pagehide`,
  and reports engine-side media errors in the existing status region.
- **`src/styles.css`** — `.controls` block built from the existing tokens (raised panel,
  44 px button, `accent-color` range, mono readout, wraps at 360 px, no animations).

**Verification**

Gate: `npm run typecheck && npm test && npm run build` — clean (117 tests), bundle
`index-*.js` 33.48 kB (10.89 kB gzip), CSS 12.45 kB (3.01 kB gzip).

Drove the built `dist/` in headless Chrome through CDP with two freshly generated 3-minute
fixtures (Throwaway script, deleted afterwards; Node built-ins only, no new dependencies):

1. `long-a.mp4` + `long-b.mp4` → scrubber max `180`, readout `00:00.000 / 03:00.000`,
   Play enabled, "Durations match (A 03:00.000 / B 03:00.000)".
2. Play → button reads `Pause`/`aria-label="Pause"`, both elements advance.
3. Drift over a 4 s window: **avg 7.3 ms, max 8.3 ms**, both rates at 1 — inside the 10 ms
   dead band, so no nudging was needed after the first correction.
4. Pause → both `paused`, button `Play`, playhead frozen (0 ms advance over 700 ms).
5. Scrub drag through 30 s → 60 s → 90 s: readout follows mid-drag (`01:30.000`), both
   elements land on exactly `90`, drift 0, no resume while the drag is open.
6. End of timeline: stops on `03:00.000`, thumb at max, button `Play`, no error status.
7. Play after the end restarts at `00:00.7`.
8. Replace A with `c-10s-24fps-4x3.mp4` while playing: playback stops, both elements paused
   (B does not advance), timeline becomes `00:10.000`, button `Play`.
9. Synthetic `waiting` on B: both elements pause, B stops advancing, the button *stays*
   `Pause` (the play intent survives); `canplay` on both resumes playback with 2.1 ms drift.
10. Zero uncaught exceptions; the only console entries are two 404s for the browser-initiated
    `/favicon.ico` request, which the app never asks for.

**Decisions**

- **`Controls` was narrowed to this phase's scope**: `ControlsState { playing, currentTime,
  timelineDuration }` and the four callbacks (`onTogglePlay`, `onBeginScrub`, `onScrubTo`,
  `onEndScrub`). Speed, loop, audio, fullscreen, swap, settings and "?" are *not* rendered
  yet — the engine implements `setSpeed`/`setLoop`/`setAudioSource`/`swap` already, so the
  next phase is presentation and shortcuts only. The frame counter is deferred with the FPS
  estimator: `logic/fps.ts` still has no estimator, and a frame number derived from the
  30 fps fallback would be a wrong number on screen.
- **Hard seeks are lead-compensated, and the lead is self-correcting.** Seeking B to A's
  *current* time always lands B one seek-latency behind (A keeps playing during the seek),
  which measured 40–110 ms in headless Chrome and made every sample exceed the 40 ms
  threshold — so the pair hard-seeked forever and never reached the nudge band. The engine
  seeks to `A.currentTime + lead` and then corrects the lead from the first sample after the
  seek: with lead `L` and seek duration `τ`, that sample is exactly `L - τ`, so
  `lead -= drift` recovers `τ`. Two seeks at most, then the pair sits in the dead band
  (measured 7.3 ms average). The lead is capped at 80 ms and reset when the source changes
  or the clock is swapped. `decideCorrection` itself is untouched: the ±3 %/±10 ms/40 ms
  thresholds still come from the tested pure module.
- **A stall is detected by `seeking`, not by a timer.** The first implementation ignored
  `waiting`/`stalled` for 300 ms after a programmatic seek, but drift seeks refresh that
  window and real stalls were then ignored. `handleStall` now ignores the event only while
  an element is actually `seeking`, which is precise and needs no clock.
- **The composition root pauses the engine before replacing a file** (`selectFile`), instead
  of relying on the `emptied` event alone. Headless Chrome showed B still running after A was
  replaced; `emptied` remains the safety net for `media.clear()`/`releaseAll()`.
- **Step 30 fps until the estimator lands**: `stepFrames` uses `FALLBACK_FPS` and pauses
  first, because a moving playhead hides a one-frame difference.
- **`getCurrentTime()` returns the current *master* element's time**, not always
  `videoA.currentTime`; after `swap()` A is the follower, so the contract comment was updated.
- **Timeline end pins both elements to `min(durationA, durationB)`** after pausing, so the
  readout, the thumb and the last frame agree.
- Two 3-minute fixtures were generated locally with ffmpeg (gitignored, `test-media/`):
  `long-a.mp4` (testsrc2 + 440 Hz tone) and `long-b.mp4` (testsrc + 880 Hz tone), both
  1280×720/30 fps/H.264+AAC, 180.000 s.

**Known limitations / not done yet**

- **FPS still reads `—` and there is no frame counter or frame-step UI.** `logic/fps.ts` has
  no estimator yet, so the engine does not call `fpsEstimate`; frame stepping assumes 30 fps.
- No UI yet for speed, loop, audio source, fullscreen, swap, the tolerance popover trigger or
  the shortcut list, and no global shortcuts — the engine side of all of them is complete.
- Playback was validated headless (timing, not looks). Whether the pair *looks* locked
  together, and whether the audio selector actually swaps the tone, needs a real browser.
- During a stall the button keeps reading "Pause" while the picture is frozen; that is
  deliberate (the intent is still "playing") but worth a sanity check by eye.
- Drift after a resume is re-anchored with `applyTime`, so a resumed pair can hop by up to the
  accumulated drift in one step. With local files that was 2 ms in practice.
- `/favicon.ico` 404s appear in DevTools; nothing in the app requests it.
- Renamed tags, speed, loop and audio live in memory only and are lost on `pagehide`.

**Manual verification needed (browser)** — use `test-media/long-a.mp4` + `long-b.mp4`

1. `npm run dev`, drop `long-a.mp4` on A and `long-b.mp4` on B. The scrubber spans
   `03:00.000`, the readout reads `00:00.000 / 03:00.000`, Play is enabled and the two test
   patterns line up along the divider.
2. Press Play (or click it). Both pictures start together, the button changes to Pause, the
   readout advances smoothly to the millisecond and the two patterns stay aligned at the
   divider for at least a minute — no B-picture lag, no periodic jump.
3. Pause. Both freeze on the same frame and the readout stops.
4. Drag the scrubber from 0 to the end and back for ~10 s. Both stay paused, the readout
   tracks the thumb, no black flashes or stutter, and releasing while it had been playing
   resumes once from the new position.
5. Click once in the middle of the track, then use Tab + arrows/PageUp/PageDown/Home/End on
   the focused scrubber. Every position lands on both videos; `aria-valuetext` is announced.
6. Play from ~02:59 and let it hit the end. Playback stops on `03:00.000`, the button returns
   to Play, nothing turns red; pressing Play starts again from 0.
7. Play, then replace A with `c-10s-24fps-4x3.mp4`. Playback stops immediately, both pictures
   freeze, the scrubber shrinks to `00:10.000`, the readout resets and B does not keep going.
8. Play and switch to another tab for ~30 s, then come back. Audio continues, the pictures are
   still aligned (drift is corrected on return), and no callback errors appear in the console.
9. Throttle the CPU to 6× in DevTools and scrub quickly into unvisited parts of the files. If
   a video runs dry, both pause briefly and resume together instead of one racing ahead.
10. Audio: the 440 Hz tone plays and the 880 Hz tone is silent (audio source A). Mute the tab
    and confirm no network activity in DevTools beyond the two blob URLs. After Pause, the
    Performance panel shows no rVFC/rAF callbacks still running.
11. Resize to 360 px and to 200 % zoom: the control bar wraps without horizontal scrolling and
    the Play button and scrubber keep their 44 px targets.

---

## Phase 5 — FPS, frame step, transport controls, shortcuts ✅

**Done**

- `src/logic/fps.ts`
  - `estimateFps(mediaTimes)` — keeps only plausible single-frame deltas (1/240 s … 1/5 s),
    inverts the **median** delta, rounds to 3 decimals and returns `sampleCount`; `null`
    below `MIN_FPS_SAMPLE_COUNT` (8) deltas. A dropped frame, seek or loop is one outlier the
    median ignores instead of a value that poisons the average.
  - `frameIndexAt(seconds, fps)` — the frame actually on screen (`floor` of the playhead in
    frames, `FRAME_EPSILON = 1e-3` frames of slack), `snapToFrame`, `frameStepTarget` (whole
    steps from the displayed frame, clamped at 0) and `formatFrameCounter` (`Frame 123`,
    or `Frame —` until there is an estimate).
- `src/logic/keys.ts` (new) — `resolveShortcut(press)` with the precedence rules as data:
  text entry wins; Ctrl/Meta/Alt are left to the browser; Space on a focused button stays
  native; arrows on a focused range stay with the slider; held keys repeat for frame/seek
  only; Shift+arrows = ±1 s; letters are case-insensitive; `?` = help.
- `tests/fps.test.ts` extended and `tests/keys.test.ts` added — 150 tests total.
- `src/sync.ts`
  - One rVFC **FPS probe per slot**, independent of the master/follower roles so `swap()`
    and drift corrections cannot disturb an estimate. Probes run only while both the engine
    and the page are playing/visible, stop themselves after reporting once, are stopped by
    pause/scrub/stall/hidden/destroy and are **reset on `emptied`** so a replaced source is
    measured again.
  - `handlers.fpsEstimate(slot, fps)` reports each estimate once; `stepFrames` now uses A's
    measured rate (fallback 30) and still pauses first and seeks both elements through
    `seek()`.
  - `setSpeed` re-anchors the pair: it sets the rate on both, and if playback was running it
    pauses, then restarts through `play()` (which waits for both to be ready and seeks both).
- `src/media.ts` — `swap(): Promise<MediaSwapOutcome>` exchanges the two object URLs
  **without revoking either**, re-awaits metadata for both, supersedes any in-flight load,
  and reverts the assignment if a source fails to load. `attachSource` keeps the
  generation/`settle` guards, so a swap can never finish against a released URL.
- `src/ui/controls.ts` — frame counter, Speed select (0.25/0.5/1/1.5/2 from
  `PLAYBACK_SPEEDS`), Audio select (A/B/Mute), Loop (`aria-pressed`), Swap A/B and
  Fullscreen; `toggleFullscreen()` is exposed for the `F` shortcut. The fullscreen target is
  `.compare`, so the stage **and** the controls stay on screen; the button label,
  `aria-pressed` and `title` follow `fullscreenchange`. Swap and fullscreen are disabled
  until a timeline exists; fullscreen is disabled when unsupported.
- `src/ui/shortcuts.ts` — `createShortcuts` (one `document` keydown listener, delegates to
  `resolveShortcut`, `preventDefault` only when an action resolved) and `createShortcutHelp`
  (a `?` trigger plus a non-modal `role="dialog"` panel with seven `<kbd>` rows generated
  from `SHORTCUT_HELP`; Escape / outside click / trigger / Close all close it and focus
  returns to the trigger).
- `src/main.ts` — header actions row (Settings + `?`), `fpsEstimate` → slot, info row, FPS
  chip and frame counter; control callbacks; M cycles A → B → Mute; shortcuts wired to the
  engine; `handleSwap` exchanges slot content (file, URL, label, metadata, status/error),
  clears both estimates, swaps the audio source so the same soundtrack keeps playing,
  restores the playhead with `engine.seek(time)` and resumes if it had been playing.
- `src/styles.css` — actions row, select/toggle/frame styles (44 px targets,
  `aria-pressed` accent state), help popover with `<kbd>` chips, `.compare:fullscreen`
  layout (stage capped to the viewport, controls still visible), and a ≤559 px rule that
  lets the speed/audio fields and the frame counter grow instead of overflowing.

**Gate:** `npm run typecheck && npm test && npm run build` — all green (150 tests, 8 files).

**Headless Chrome verification** (built `dist/` served locally, DevTools protocol, throwaway
scripts; `test-media/` fixtures)

- FPS read `—` before playback, then `30 fps` for both fixtures on the first estimate; the
  frame counter read `Frame —` until then and advanced one per step afterwards.
- ArrowRight landed on the next frame boundary of A and **both** elements on the identical
  time (drift 0.00000); ArrowLeft landed exactly one frame back; Shift+ArrowRight moved
  exactly 1.000 s with the pair still level.
- Speed 0.5x and 2x applied to A; B sat inside the ±3 % nudge band. After the `setSpeed`
  fix, the drift samples across a 0.5x → 2x change were 25, 12, 0.2, 0.8, 8, 4 ms.
- Loop wrapped both videos to ~0.4 s while still playing, and the pair was back inside the
  threshold (7 ms) after the wrap.
- Audio A/B/Mute set exactly one unmuted element; `M` from Mute returned to A and kept the
  select in step.
- Swap exchanged the element `src`s and the labels with their files, kept the playhead at
  exactly 4.000 s on both elements, kept the soundtrack selected, stayed paused when it was
  paused, resumed in sync (23 ms) and re-estimated FPS (`—` → `30 fps`).
- Fullscreen, entered with a **trusted** mouse event: `document.fullscreenElement` was the
  `.compare` box, the button read “Exit fullscreen” with `aria-pressed="true"`, the controls
  were 114 px tall inside fullscreen, and leaving restored the button.
- Shortcuts while editing tag A: Space, ArrowLeft/Right, Shift+Arrow, L, M, F and `?` left
  loop state, audio, playhead, play state and the typed text untouched; after blurring, `L`
  worked again. `?` opened a 7-row dialog and focused it; Escape closed it and returned
  focus to the trigger.
- No page exceptions; the only console errors were the pre-existing `/favicon.ico` 404s.

**Decisions**

- **Median, not mean; no number without enough samples.** A seek jump or a dropped frame is
  an outlier the median ignores, and showing a frame rate derived from two deltas would be a
  guess. Below 8 deltas the UI keeps `—` and frame stepping uses the 30 fps fallback.
- **The frame epsilon is measured in frames (1e-3), not seconds.** Seeking to 44/30 s made
  Chrome report 43.99998 frames; a 1e-6 *second* epsilon treated that as frame 43 and
  ArrowLeft skipped two frames. 1e-3 frames is 33 µs at 30 fps — invisible, but far above
  double-rounding noise.
- **Frame stepping is “next/previous picture”, not “±1 frame from the exact time”.** It
  starts from the displayed frame index, so one press always changes the picture even when
  the playhead was paused mid-frame, and it never skips a frame after a seek.
- **FPS probes are per element and report once.** They are deliberately outside the
  master/follower drift loop: swapping the clock role or a drift hard-seek cannot reset an
  estimate, and a replaced source re-measures because `emptied` clears the samples.
- **Swap exchanges content, not the clock role** (approved before implementation): A stays
  the master and therefore stays the left-hand video. The URLs are exchanged, not revoked;
  app state only follows a successful swap, and a failed swap reverts the elements so state
  and `src`s cannot disagree. Estimates are cleared because they belong to the source.
  Audio follows its file, so the user keeps hearing the same soundtrack. The swap is a
  reload, so expect a brief freeze on very large files.
- **`setSpeed` re-anchors via pause → apply → `play()`.** Found in headless Chrome: a rate
  change makes each decoder re-buffer independently, drift crosses 40 ms, the engine
  hard-seeks B into an unready decoder, and B then sits in `seeking` at `readyState 1` for
  ~1.8 s while A runs on (measured drift up to 164 ms). Restarting the pair costs one short
  hitch and lands them on the same frame; this is the one place where a speed change is not
  seamless.
- **Shortcut precedence lives in `logic/keys.ts`.** Typing wins over everything, which is
  what makes “ignored while a tag label is edited” a tested property rather than a side
  effect of focus. Space is left to a focused button (otherwise it would activate the button
  *and* toggle playback) and arrows are left to a focused range (the scrubber).
- **The help panel is a non-modal dialog built from `SHORTCUT_HELP`**, so the list and the
  listener cannot drift apart; focus moves into it on open and back to the trigger on close.
- **Fullscreen targets `.compare`** rather than the stage, so scrub/speed/audio stay usable;
  the stage is capped to `100dvh - 190px` so the control bar remains visible.

**Known limitations / not done yet**

- `F` needs a real user gesture, so headless could only verify the button path (same
  `toggleFullscreen()` call). Pressing `F` on a real window still needs a human.
- A speed change is a controlled hitch (pause + re-anchor), not a seamless rate switch.
- Without `requestVideoFrameCallback` (very old Safari) the info bar keeps `—`, the frame
  counter stays `Frame —` and stepping uses 30 fps. No fake numbers.
- An estimate is only produced for a video that has actually played; dropping a file and
  never pressing Play leaves its FPS unknown.
- The estimate is a rounded median of the first ~8+ frames; VFR sources report their
  dominant rate, not a range.
- Renamed tags, speed, loop, audio source and an open help panel live in memory only and are
  lost on `pagehide`.
- `/favicon.ico` still 404s; nothing in the app requests it.

**Manual verification needed (browser)** — `test-media/long-a.mp4` + `long-b.mp4`, plus
`c-10s-24fps-4x3.mp4` for the frame-rate path

1. `npm run dev`, load `long-a.mp4` on A and `long-b.mp4` on B. Before pressing Play the info
   bar FPS reads `—` and the counter reads `Frame —`. Press Play for ~2 s: both rows switch to
   `30 fps`, the counter starts at a plausible number and the chip area stays quiet.
2. Pause and press ArrowRight/ArrowLeft repeatedly. The picture changes by exactly one frame
   per press on **both** sides of the divider, the counter moves by one, and holding the key
   steps continuously. Then put `c-10s-24fps-4x3.mp4` on A (B can stay 30 fps): each press
   moves A by 1/24 s — noticeably larger than 1/30 — both elements land on the same time, and
   the FPS chip appears.
3. Change Speed while playing: 0.5x, 1.5x, 2x. Both sides change together after a very short
   hitch; no side runs ahead; the select keeps reading the chosen rate while B may momentarily
   run ±3 % internally.
4. Loop on, play from ~02:59: the pair wraps to 00:00 together, the button never flickers, and
   **the 440 Hz tone** restarts with the picture. Loop off, play to the end: both stop on
   03:00.000, nothing turns red, Play restarts from 0.
5. Audio: A plays the 440 Hz tone, B plays the 880 Hz tone, Mute silences both. Change the
   select mid-playback — the tone switches immediately, the pictures do not jump. Press `M`
   three times: A → B → Mute → A and the select follows every step.
6. Press `F` (or the Fullscreen button). The stage grows, the control bar and info bar stay
   usable, Escape/F leaves. Try it while playing: playback continues.
7. Swap A/B while paused at ~00:30: the pictures change sides, the tags move with them, the
   readout stays at 00:30.000, the same soundtrack keeps playing (the A/B select swaps too),
   and Play resumes both together. Repeat while playing: the picture freezes briefly while the
   files reload, then resumes at the same time on both sides.
8. Click into tag A and type `? l m f` plus Space and arrows. Nothing plays, loops, seeks or
   opens the shortcut list; Enter commits the label. Click outside and press `L`/`M`/Space:
   they work again.
9. Press `?`: the list shows seven rows and focus is inside the panel; Escape closes it and
   focus returns to `?`. Clicking outside also closes it.
10. Resize to 360 px and 200 % zoom: the control bar wraps (Play, timeline, frame counter,
    Speed, Audio, Loop, Swap, Fullscreen) without horizontal scrolling, every control keeps a
    44 px target, and the `?`/Settings popovers stay inside the viewport. Check light mode and
    `prefers-reduced-motion: reduce` once.
11. With DevTools Performance, pause and confirm no rVFC/rAF callbacks keep running (other than
    the finished FPS probes). After several swaps there are still exactly two blob URLs and no
    new ones per swap; the Network panel shows nothing but the document, the two assets and the
    local video requests the page makes itself.

**Next:** Phase 6 is undefined — side-by-side, difference blend and synced zoom/pan are
stretch features and stay unbuilt until asked. Candidate polish: persist labels/settings/
controls in `sessionStorage`, a keyboard-only way to open the tag rename field, and a distinct
“swap failed” status instead of the generic media error.






---

## Phase 6 — Leak / a11y / narrow-viewport audit ✅

**Done**

- **Listener leak in `media.attachSource`.** A superseded swap attempt resolved with
  `finish('superseded', false)`, which skipped `detachListeners()` and then nulled the record
  hook — so its `loadedmetadata`/`error` pair stayed attached forever (two leaked listeners per
  interrupted swap). Each attempt now owns `removeOwnListeners()` and always runs it; it only
  clears the shared record fields when they still point at *that* attempt. Kept exactly two
  `createObjectURL`/`revokeObjectURL` call sites (both in `media.ts`), unchanged.
- **Two `pagehide` teardowns.** `media.ts` had its own `pagehide` listener registered before the
  composition root's, so it revoked the URLs first and main then paused already-released
  elements, driving `emptied`/`load()` a second time. Removed the media-level listener:
  `main.handlePageHide` is now the only owner (`engine.pause()` → `media.releaseAll()` →
  `resetAllSlots()`). `media.destroy()` no longer removes a window listener.
- **Replacing a file mid-playback left the pair at different times.** `handleEmptied` was
  element-agnostic and always emitted 0, so replacing B at 00:30 kept A at 30 s while the
  readout said 00:00 and the new B sat on frame 0. It now receives the emptied element, emits 0
  only when the *master* went away, and `selectFile` re-anchors both elements with
  `engine.seek(engine.getCurrentTime())` after a successful load (replacing A resets to 0,
  replacing B keeps the playhead and seeks the new file onto it).
- **Per-slot FPS invalidation.** `handleEmptied` used `resetFpsProbes()` (both slots), so
  replacing one file discarded the other file's estimate while `AppState` kept it — engine and
  UI disagreed and the frame counter silently fell back to 30 fps. Split into
  `resetFpsProbe(slot)`; both are still reset implicitly on swap (both elements empty).
- **Playback errors now name the file.** `SyncEventHandlers.mediaError` carries the
  `MediaErrorKind`, and `main.handleMediaError` rebuilds the message with the real filename via
  `mediaErrorMessage`, instead of the generic "Video A stopped playing." alone.
- **`application/octet-stream` no longer means "not a video".** Windows browsers report it (and
  `binary/octet-stream`) for `.mkv`/`.mov` from the file manager; those types now fall through to
  the extension check so the media element makes the real decision. Specific types
  (`text/plain`, `image/png`) stay authoritative. Three new specs.


- **Duplicate live-region announcements.** `status.render()` now memoizes on
  tone + message + detail + action label; an unchanged status only refreshes the stored click
  handler and leaves the DOM alone, so the repeated `syncStatus()` calls cannot re-announce.
  The region itself stays `role="status" aria-live="polite" aria-atomic="true"`, with the
  action button outside it.
- **360 px: Settings panel hung off-screen.** Anchored to `.settings`, the 320 px panel needed
  ~348 px and started at x ≈ −28 at 360 px wide. Below 560 px both popovers now anchor to
  `.app__actions` (`position: relative` + `position: static` on the wrappers), landing inside
  the viewport while still right-aligned to the header.
- **360 px: timeline readout overflow.** `hh:mm:ss.mmm / hh:mm:ss.mmm` (~210 px of monospace)
  plus a 120 px scrubber cannot fit ~304 px of content box. `.controls__timeline` wraps and the
  readout is right-aligned when it must drop under the track.

**Audited, no change needed**

- Object URLs: one creator, one revoker, revoke-before-create on replacement, `releaseAll()` is
  idempotent, `AppState.objectUrl` is a mirror and never a second owner.
- rVFC/rAF: `stopSampling`, `stopProbe` and `cancelScrubFrame` all cancel against the element
  they were scheduled on; `swap()` stops sampling before exchanging roles; the FPS sample
  buffer is capped at 64; nothing restarts after `destroy()`.
- 54 `addEventListener` / 51 `removeEventListener`: the three unmatched are the app-lifetime
  window handlers in `main.ts` (`dragover`, `drop`, `pagehide`). Every UI controller removes
  everything it added, and the popovers' document `pointerdown` listeners are paired with
  open/close.
- 44 px targets everywhere (play/loop/swap/fullscreen/settings/help/reset/close/status action,
  inputs, selects, scrubber, 44 px wipe hit strip, 44 px tag chip); `:focus-visible` rings are
  global plus explicit on the dropzone, status action and tag input; the global
  `prefers-reduced-motion` block covers every transition (nothing is JS-animated); light-mode
  tokens cover every surface.

**Gate:** `npx tsc --noEmit`, `npx vitest run` (152 tests, 8 files), `npx vite build` — all green.

**Decisions**

- Single-owner teardown: the composition root owns `pagehide` ordering; `media` only exposes
  `releaseAll()`/`destroy()`. Two listeners were functionally idempotent but made the ordering
  implicit and fragile.
- Replacing the *master* resets the playhead to 0; replacing the *follower* keeps it. Reset is
  the only honest option when the clock itself is gone, and preserving the master's position is
  what makes replacing B mid-comparison usable.
- The live region is memoized instead of cleared-and-refilled: emptying the nodes first would
  announce "nothing", then the text, doubling every message.
- `octet-stream` is treated as "unknown", not as "not a video": the extension plus the media
  element give an honest error instead of a misleading one. Deliberately not a bare extension
  allowlist — a non-empty specific type still wins.
- Popover anchoring is fixed in CSS rather than by measuring in JS: no layout thrash, no resize
  listener, and the `?` panel keeps identical behaviour.

**Known limitations / not done yet**

- Both popovers are `role="dialog"` without focus trapping; they are non-modal and Escape/outside
  click closes them. Acceptable for a comparison tool, worth revisiting if they ever become
  modal.
- At divider 0 % / 100 % the 44 px wipe strip is half-clipped by `.stage__frame { overflow:
  hidden }`, leaving a 22 px edge target. Left as is: `overflow-clip-margin` would fix it but
  changes the visual edge and needs a manual browser check.
- The UI controllers' `destroy()` methods are unreachable (the app mounts once and never
  unmounts), so they are only exercised by review, not by the app.
- Renamed tags, speed, loop, audio source and an open popover live in memory only and are lost
  on `pagehide`.

**Manual verification needed (browser)** — `test-media/long-a.mp4` + `long-b.mp4`

1. Play, then pause at ~00:30 and replace **B**. The readout stays at 00:30.000, the scrubber
   keeps its position, A's picture does not jump, and the new B appears on the same time.
2. Replace **A** while paused at ~00:30: the readout resets to 00:00.000 and both sides show
   their first frame. Replace A again while playing: playback stops on load, then Play starts
   both together.
3. Play and replace B, then immediately replace B again before it finishes loading. No console
   errors, exactly one file ends up on screen, and the blob-URL list (DevTools → Memory) does
   not grow per attempt.
4. Drop a ProRes `.mov` on A, then an HEVC `.mkv`: the status names the file, says the container
   or codec is unsupported and suggests H.264 MP4 / WebM. A `.mkv` with an octet-stream MIME
   type is accepted and plays if the browser supports it.
5. Resize to 360 px and open Settings, then `?`: both panels are fully inside the viewport, and
   the time readout wraps under the scrubber instead of pushing the row wide. No horizontal
   scrollbar at any width.
6. Tab through the page: every control shows a visible focus ring, the duration status is
   announced once per change (not twice after a file swap or a tolerance edit), and an inline
   dropzone error is announced through the status region only.
7. Switch the OS to light mode and to reduced motion: all surfaces stay readable and nothing
   animates.

---

## Phase 7 — Per-video audio mix ✅

Requested change: replace the single `A / B / Mute` audio selector with a volume knob for each
footage, so both soundtracks can be heard and balanced instead of one being muted.

**Done**

- `src/logic/mix.ts` (new, pure): `AudioMix { a, b }`, `MAX_VOLUME`, `DEFAULT_AUDIO_MIX`
  (`{ a: 1, b: 0 }`, the old "audio from A" default), `clampVolume`, `volumeToPercent`,
  `percentToVolume`, `formatVolume`, `isMixSilent`, `nextSoloMix`.
- `src/ui/mix.ts` (new): the "Audio" panel under the transport bar — one native
  `<input type="range">` per video with an A/B badge and a percent read-out. 44 px targets,
  `aria-label="Video A/B volume"`, `aria-valuetext="NN%"`, `role="group"` around the pair.
  `render()` never overwrites the slider the user is dragging.
- `src/state.ts`: `AudioSource` and `AppState.audioSource` removed; `AppState.mix` added.
  `AudioMix` is defined in `logic/mix.ts` and re-exported from `state.ts`, because
  `state.ts → logic/*` is the only allowed direction (logic never imports state).
- `src/sync.ts`: `setAudioSource` → `setMix`. Each element gets `volume = clamp(level)` and is
  `muted` only at exactly 0, so a silent side stops decoding audio. Levels are element
  properties, so `swap()` cannot move them: the A slider always owns the A picture.
- `src/ui/controls.ts`: the Audio `<select>` (and its `AudioSource` parser) is gone; the bar
  keeps Speed / Loop / Swap / Fullscreen. `.compare__controls` is now a column so the mixer
  panel sits directly under the transport bar.
- `src/main.ts`: `handleMixChange` writes state → engine → panel; `M` cycles via
  `nextSoloMix` (A only → B only → silent → A only); the swap handler no longer remaps audio.
- **Dragging a level pauses playback** (`onAdjustingChange` on the mixer panel, handled by
  `handleMixAdjustingChange`). Changing gain on a playing element makes the browser rebuild its
  audio path, and the two elements are serviced independently, so a drag could leave the pair
  audibly offset. `pointerdown` on a slider pauses both (the browser flips the button to Play),
  and `pointerup`/`pointercancel`/`change`/window `blur` restarts via `engine.play()`, which
  force-aligns both elements on one time first — so nothing accumulated mid-drag survives. A
  drag that starts while paused does not auto-play, and an explicit Space/play-button press or a
  scrub during the drag cancels the pending restart (`mixResume = false`) so the release never
  resumes behind the user's back. Keyboard arrow steps do not pause: they are discrete and
  would otherwise stop/start playback on every keypress.
- `src/styles.css`: `.mix`, `.mix__title`, `.mix__channel`, `.mix__badge`, `.mix__range`,
  `.mix__value`, plus a `< 560 px` rule that hides the "Audio" caption and gives each channel
  its own row. Existing tokens only, so light mode and reduced motion come for free.
- `src/ui/shortcuts.ts`: `M` help text now reads "Cycle audio: A only → B only → silent".
- `tests/mix.test.ts` (new, 21 specs): clamping (NaN → silence, ±Infinity → ends), percent
  conversions incl. a 0-100 round-trip, formatting, silence detection, the full `M` cycle,
  blend handling, immutability, and the initial state's mix.

**Gate:** `npm run typecheck`, `npm test` (173 tests, 9 files), `npm run build` — all green.

**Decisions**

- Levels live on the *element*, not on the file: after `swap()` the slider still controls the
  picture it is next to, which is what "one knob per footage" means. The old file-bound
  remapping in `handleSwap` was removed with it.
- A level of exactly 0 also sets `muted`, so browsers can skip decoding a silent soundtrack
  instead of mixing it at 0 %.
- `M` was kept as a solo-preset cycle rather than deleted: it is in the documented behaviour
  spec, and cycling `{1,0} → {0,1} → {0,0}` reproduces the old A/B/Mute order exactly.
- `NaN` clamps to silence, not to 1. A broken value must never become unexpected loud audio.
- Both videos can now be audible at once by design; the mix is per-side and additive, which the
  browser does for us because each video has its own media element.

**Known limitations / not done yet**

- No master gain or channel balance, no per-video mute buttons (a slider at 0 is the mute).
- The mix is not persisted across `pagehide`, like every other UI setting.
- The `.clinerules` spec still describes the old `A / B / Mute` selector; the rule file was not
  edited (it is the project's contract, not app state).

**Manual verification needed (browser)** — `test-media/long-a.mp4` + `long-b.mp4`

1. Load both videos, press Play: only A is audible, the Audio panel shows `A 100% / B 0%`.
2. Raise B to ~50 %: both soundtracks are heard together, and neither video's picture changes.
3. Drag A to 0 %: A goes silent without a click or pop, and its slider track still responds.
4. Press `M` three times: B only → silent → A only. The sliders and the `?` list agree with it.
5. Set `A 40% / B 0%`, press **Swap A/B**: the pictures exchange, the sliders keep their
   positions, so the side that was audible is still audible (now the other file).
6. Play at 2x with both channels open: the mix stays balanced through speed changes, a scrub
   and a pause/resume.
7. At 360 px wide: each channel gets its own row, no horizontal scrollbar, and both sliders are
   still 44 px tall and draggable with a finger.
8. Play, then drag A's slider: the video pauses on pointer-down (button reads Play), stays
   paused for the whole drag, and resumes on release from the same frame — the two pictures stay
   aligned and both soundtracks land together. Dragging while paused must **not** start playback.
9. Drag a slider and, mid-drag, press Space (or click Play), then release: playback follows what
   you chose, not the release.

**Next:** reported regression — audio still desynced with both channels open (Phase 7.1).


---

## Phase 7.1 — Why it still desynced, and the real fix ✅

Reported after Phase 7: *"it still desyncs, and at some point you don't hear one source when
both should be present."* Two independent causes, both structural, both fixed.

**Cause 1 — the drift corrector detunes B.**
`decideCorrection` biased B's `playbackRate` by ±3 % inside the 10–40 ms band. With one
audible source that is invisible; with **both** audible it is a permanent 3 % tempo/pitch
difference between two sources the user is listening to at once — heard as beating and
flanging, i.e. exactly "the audio is desynced". Every hard seek also flushed B's decoder, so
its soundtrack went silent for ~100 ms: "you don't hear one source".

Fixed in `src/logic/drift.ts`: `DriftSample.audibleVoices` (default 1). Above 1 the nudge is
**skipped** and B keeps the base rate inside the band. Because the nudge is then unavailable,
the hard seek is taken earlier while blended (`BLENDED_DRIFT_HARD_SEEK_SECONDS` = 20 ms instead
of 40 ms), which is only acceptable because the seek is now ducked (see cause 2) — it keeps the
pictures within one frame. The engine reads the count from `SyncEngineOptions.audibleVoices`
(a getter into `AppState.mix`) on every sample, so soloing a side instantly restores normal
nudging. 8 new specs.

**Cause 2 — `volume`/`muted` on two media elements is not a mixer.**
Each `<video>` drives its own audio pipeline; `volume` is read-only on iOS, and changing it on a
playing element walks through that pipeline. New `src/audio.ts` (`createAudioMixer`) routes both
elements through one `AudioContext`:

- `createMediaElementSource` → `GainNode` → `destination` per video, so the two soundtracks are
  summed by the browser's audio graph on one output clock instead of two competing pipelines;
- levels are `setTargetAtTime(…, 10 ms)` ramps: a slider drag can no longer click or disturb
  the decoder, and it works on iOS where `volume` is ignored;
- `unlock()` (called from the play button/Space and from a slider press) creates and resumes the
  context inside a gesture; the graph is adopted **only once the context is running**, because
  a suspended context routing the media elements would silence them. Until then the element
  path (`volume`/`muted`) is used, so nothing ever goes quiet by accident;
- fresh gain nodes start at 0 before connecting, so a side the user muted cannot be heard at
  full level for one tick while the graph is being built;
- `duck(slot, 80 ms)` fades the seeked source down and back up around a corrective hard seek
  (`SyncEventHandlers.audioCorrection`), turning the decoder flush into a smooth dip.

`src/sync.ts` no longer touches audio at all: `mix`/`setMix`/`applyAudio` are gone and the only
audio-adjacent thing left is the `audibleVoices` getter. `src/main.ts` owns the mixer
(`audioMixer`), applies the mix, unlocks on gestures and wires `audioCorrection`.

Also: `ui/mix.ts` shows an honest note while both channels are open ("the two players can sit a
few milliseconds apart even when their pictures match"). Two separate media elements are not
sample-lockable — that is a platform property, and pretending otherwise would send the user
chasing an unfixable symptom.

**Gate:** `npm run typecheck`, `npm test` (183 tests, 9 files), `npm run build` — all green.

**Decisions**

- Audio ownership moved out of the sync engine into `audio.ts`. Playback stays single-owner in
  `sync.ts`; levels now have a single owner too, and neither module duplicates the other.
- The nudge is dropped rather than shrunk when blended: 1 % detune is as audible as 3 %, so
  there is no "small enough" rate bias between two sources the user hears together.
- The audio graph is deliberately *not* destroyed on `pagehide`: closing the context would leave
  both elements bound to a dead context, and a bfcache restore runs no init code.
- Ducking is best-effort: without an `AudioContext` there is no gain to automate, and the seek's
  own dropout is all that happens.

**Known limitations / not done yet**

- Two media elements cannot be sample-locked. With both channels open, a few ms of offset
  between the soundtracks is possible even when `currentTime` is identical. Mixing different
  content is fine; mixing the *same* content (e.g. a re-encode against its source) produces
  comb filtering that no amount of drift correction removes.
- A corrective hard seek while blended is now the only audible correction left, and it is a
  dip, not nothing.
- `duck()` has no effect in the element fallback path (no `AudioContext`).

**Manual verification needed (browser)** — `test-media/long-a.mp4` + `long-b.mp4`

1. Load both, press Play, open the mix: A at 100 %, B at 0 % → only A is heard, no console
   errors, and DevTools shows no `AudioContext` warning.
2. Raise B to ~50 %: both are heard, **no 3 % detune** (previously it sounded like a warbling
   tape), and the slider glides without clicks.
3. Play for ~30 s with both open: the pictures stay within a frame of each other, and any
   correction is a short dip in B, not a click or a detune.
4. Solo back to A with `M`: the single-source case nudges again, as before.
5. Drag a slider mid-playback: playback pauses, the drag is silent (no clicks), and on release
   both resume aligned.
6. Swap A/B with both open: levels stay with their side, sound continues.
7. Safari (if available): levels are actually audible (they are ignored on iOS via `volume`).





---

## Phase 8 — Visible step controls ✅

Requested: *"Add a button where we can go to the next frame or next unit of time."*

**Done**

- `src/logic/step.ts` (new, pure): `STEP_UNITS` (`'frame' | 1 | 5 | 10`), `StepUnit`,
  `StepDirection`, `stepUnitLabel` (`Frame`, `1 s`, `5 s`, `10 s`), `stepDeltaSeconds`,
  `stepTarget` (clamped to 0 … timeline at both ends, frame steps via `frameStepTarget` so
  forward always shows the *next* frame even from mid-frame), `stepActionLabel`
  (`Previous frame` / `Next frame` / `Back 5 s` / `Forward 5 s`), `formatStepUnitValue`,
  `parseStepUnit`.
- `src/state.ts`: `CompareSettings.stepUnit` (default `'frame'`, so the buttons agree with the
  arrow keys until the user asks for something coarser) + `stepUnit` override.
- `src/ui/controls.ts`: a `role="group"` step cluster next to the frame counter —
  `◀ [step unit select] ▶`, native buttons and a native `<select>`, 44 px targets,
  `aria-label="Step unit"`, and per-direction `aria-label`s that name the real action. All three
  are disabled while no timeline exists.
- `src/main.ts`: `handleStep(direction)` — `'frame'` delegates to `engine.stepFrames(±1)`
  (which pauses and uses A's estimate); time units pause first, then seek to
  `stepTarget(...)`. `handleStepUnitChange` stores the unit and re-renders the labels.
- `src/styles.css`: `.controls__steps`, `.controls__step`, `.controls__step-unit` (tokens only,
  so light mode and reduced motion are unchanged; the cluster wraps as a unit at 360 px).
- `src/ui/shortcuts.ts`: the arrow row in `?` now says the buttons follow the Step unit while
  the keyboard keeps one-frame steps.

**Gate:** `npm run typecheck`, `npm test` (201 tests, 10 files), `npm run build` — all green.

**Decisions**

- Stepping always pauses. Frame-accurate inspection while the picture moves is meaningless, and
  it makes the button behaviour identical to the keys (`stepFrames` already paused).
- The keyboard is unchanged on purpose: Left/Right stays one frame, Shift+Left/Right stays one
  second, exactly as the written spec says. Only the visible buttons honour the select, so a
  user who prefers 5 s steps does not lose frame-accurate key control.
- `stepTarget` clamps rather than wraps: pressing forward at the end stays at the end (a wrap
  would silently jump to 00:00 in the middle of an inspection).
- The unit lives in `settings`, not in `controls`: it is user configuration, and the select is
  just one view of it.
- `parseStepUnit` validates the DOM value instead of trusting it, matching how the speed select
  is handled, so a stray value can never reach the engine.

**Known limitations / not done yet**

- No per-press modifier (like Alt = 10 s) and no long-press repeat; the unit select covers it.
- The step unit is not persisted across `pagehide`, like every other UI setting.
- A frame step uses A's estimate; before rVFC has sampled (~a few frames of playback) it falls
  back to 30 fps, which is why the counter shows `Frame —` until an estimate exists.

**Manual verification needed (browser)** — `test-media/long-a.mp4` + `long-b.mp4`

1. Pause mid-clip and press `▶` with unit **Frame**: exactly one frame forward each press, the
   counter increments by 1, and the wipe divider still lines both pictures up.
2. Press `◀` at 00:00.000: nothing happens, no negative time, no console error.
3. Switch the unit to **5 s** and press `▶` three times: +5 s each, and the readout matches.
   Press `◀` near the start: it stops at 00:00.000.
4. Press a step button while playing: playback pauses first, then steps once.
5. With the select focused, press `ArrowLeft`/`ArrowRight`: the keys change the *select*, not the
   playhead (a focused form control keeps its own keys), and `Space` still toggles playback
   after clicking away.
6. Arrow keys on the page body still step exactly one frame regardless of the selected unit, and
   Shift+Arrow still jumps one second.
7. At 360 px the `◀ Frame/1 s/5 s/10 s ▶` cluster wraps as one unit, with no horizontal scrollbar.
8. With no videos loaded, the step buttons and the unit select are visibly disabled.

**Next:** Phase 9 — third audio source (external track replaces both video soundtracks).

---

## Phase 9 — third audio source (external track)

**Done**

- `src/logic/audio.ts` (new, pure, DOM-free): `AUDIO_TRACK_EXTENSIONS`, `AUDIO_TRACK_ACCEPT_ATTRIBUTE`,
  `isProbablyAudioTrack` (specific MIME type wins; empty/generic type falls back to the
  extension), `nonAudioTrackMessage`, `audioTrackErrorMessage` (one message per media-error kind,
  always naming the file) and `FALLBACK_TRACK_LABEL`.
- `src/state.ts`: `ExternalTrack` (`file`, `objectUrl`, `label`, `status`, `error`,
  `durationSeconds`), `createEmptyTrack()` — deliberately *not* a `VideoSlot`, because the track
  has no picture, no fps and no aspect ratio, and must survive a video swap untouched — plus
  `AppState.track` and `AppState.trackLevel` (default 1) with overrides.
- `src/media.ts`: the loader now also owns a third element (`HTMLAudioElement`) and its object
  URL — `audioTrack`, `loadTrack(file)`, `clearTrack()`, `getTrackUrl()`, `releaseAll()` clears it,
  `destroy()` removes it. The track keeps the same generation/settle bookkeeping as a slot so a
  superseded pick can never write over a newer one. The element is attached to `document.body`
  (unrendered) rather than left detached, for Safari.
- `src/audio.ts`: the mixer grew a third channel. `setTrackLevel(level)`, `setTrackActive(active)`
  and `duck('track')`; a single `effectiveLevel(channel)` decides that *track mode* means videos
  at 0 and track at its own gain, so no call site has to mute the videos by hand. Still one
  `AudioContext`, still ramped with `setTargetAtTime`.
- `src/sync.ts`: the track is a second follower. `playTrack`, `seekTrack`, `pauseTrack`,
  `correctTrack` wired into `play`, `pause`, `seek`/`applyTime`, stall recovery, loop restart and
  `destroy`. `correctTrack` uses a hard seek only, and skips once the track has ended or the
  playhead is past its duration, so a short track cannot be re-seeked every frame.
- `src/ui/settings.ts`: new "Audio track" section — `Choose audio file…` / `Replace audio file…`,
  a `Remove` button, and a `role="status"` line (`name · mm:ss.mmm`, `Loading …`, the error, or
  "No audio track."). `setTrack(view)` re-renders even while the panel is closed.
- `src/ui/mix.ts`: a third `♪` channel for the track, hidden until a track is loaded, with its own
  callback and note ("playing instead of the video soundtracks"). The "Silent" chip no longer
  appears when the track is carrying the sound.
- `src/main.ts`: `handleTrackFile` (guard → loading → outcome → mode → join the playhead),
  `handleRemoveTrack`, `handleTrackLevelChange`, `applyTrackMode`, `renderTrackViews`,
  `trackView()`, `resetTrack()`; `pagehide` now clears the track state too.
- `src/styles.css`: the pick/remove buttons and the status line, using existing tokens.
- `tests/audio.test.ts` (new, 20 tests): MIME/extension matrix, accept attribute, every message,
  the track labeler and the track's place in the initial state.

**Gate:** `npm run typecheck`, `npm test` (221 tests, 11 files), `npm run build` — all green.

**Decisions**

- Track mode is derived, not switched: the track is active exactly while `status === 'ready'`.
  A separate toggle could disagree with the file that is actually loaded.
- The track *replaces* both video soundtracks instead of adding to them. Mixing three sources
  would make the "which one is out of sync" question unanswerable, and the feature was asked for
  as an alternative soundtrack.
- The track is corrected by hard seek only. A ±3 % rate nudge is a pitch change, and this is the
  one source the user is listening to; the correction is covered by the existing duck.
- A failed or removed track leaves no track loaded. The loader has already revoked the previous
  URL by the time an error surfaces, so "restoring" the old file would point at a dead source.
- Loading or replacing a track does not pause the comparison: the new file is seeked to the
  current playhead once it is ready.
- `audibleVoices` still counts only the videos, so the drift corrector may nudge B while the track
  plays — B is muted then, so nothing is heard.

**Known limitations / not done yet**

- `M` still cycles the two video levels, which is inaudible while a track is loaded; the panel
  note is the only hint. Worth revisiting if it feels dead in use.
- Track duration is shown in Settings but not compared with the timeline; a short track simply
  runs out and its channel goes quiet (it is not stretched or looped).
- A track whose `play()` is refused by the autoplay policy fails silently: the pictures keep
  playing, and only the track channel is missing.
- No per-track offset/trim control.

**Manual verification needed (browser)** — `test-media/` videos + any local `.mp3`/`.m4a`

1. Settings → **Choose audio file…** → pick an MP3: the status line reads `name · 00:04.000`, the
   `♪` channel appears in the mixer panel, and the two video sliders no longer control anything
   audible.
2. Press Play: the track is heard *instead of* the videos, and stays in step through a minute of
   playback, a wipe drag and a scrub.
3. Pause/resume, then loop: the track starts at the right instant each time, with no click at
   the seam.
4. Change speed to 2×: both videos and the track stay together (the track plays faster and
   higher-pitched, as a media element should).
5. Replace the track mid-playback with a second file: playback continues, the new track joins the
   current playhead, and the old file's channel is gone (no double audio).
6. Remove: the `♪` channel disappears, the video levels are heard again immediately, and the
   console shows no error.
7. Pick a `.txt`: the settings status shows the "not an audio file" message and nothing starts
   playing.
8. Pick an unsupported audio file (e.g. an unusual `.flac` in Safari): the message names the file
   and suggests re-encoding; the videos keep playing.
9. Drag the `♪` slider while playing: playback pauses, then resumes aligned on release; the level
   ramps without zipper noise.
10. Reload the page (or close the tab) with a track loaded: check `chrome://blob-internals` — the
    track's blob is gone — and no request leaves the machine.
11. At 360 px the settings panel and the three mixer rows still fit without horizontal scroll.

**Next:** Phase 10 — independent mode (each video gets its own transport controls).

---

## Phase 10 — independent (desynced) mode

**Done**

- `src/logic/slots.ts` (new, pure, DOM-free): `SLOT_END_EPSILON_SECONDS`, `slotLimit`,
  `clampSlotTime` (`+Infinity` clamps to the end, NaN and `-Infinity` to the start),
  `slotAtEnd`, `slotPlayStart` (a row parked on its last frame starts over), `slotStepTarget`
  (that slot's own fps, clamped to *its* duration — never to the shorter timeline).
- `src/state.ts`: `AppState.independent`, `playheads: Record<SlotId, number>`,
  `slotPlaying: Record<SlotId, boolean>` and an `independent` override.
- `src/sync.ts`: the engine grew a second, parallel transport path.
  - Handlers `slotTimeUpdate` / `slotPlayStateChange`.
  - `setIndependent`, `isIndependent`, `toggleSlot`, `pauseSlot`, `isSlotPlaying`, `seekSlot`,
    `stepSlotFrames`, `beginSlotScrub`, `scrubSlotTo`, `endSlotScrub`, `getSlotTime`,
    `getSlotDuration`.
  - Independent mode runs its own rAF readout loop (`tickSlots`) instead of the rVFC drift
    loop; per-row scrubs are rAF-throttled and resume on release exactly like the shared one.
  - `ended` is per row: loop restarts that element alone, otherwise only that row pauses.
  - `play()`/`pause()`/`togglePlay()` still mean "both" (each from its own position), so Space
    and the shared Play button keep working; `isPlaying()` reports "anything running".
  - `swap()` refuses to run in independent mode, `seek()` moves both rows clamped to their own
    lengths, `stepFrames()` steps A, `setSpeed()` keeps both elements running.
- `src/ui/transport.ts` (new): one reusable row — badge, Play/Pause, native range scrubber,
  `mm:ss.mmm / mm:ss.mmm` readout, `◀`/`▶` frame steps, 44 px targets, slot-aware labels
  (`Play video B`, `Video B timeline`, `Next frame of video B`). Owns no playback state.
- `src/ui/controls.ts`: an `Independent` toggle (`aria-pressed`) as the first control; in
  independent mode the shared timeline, frame counter and step cluster hide (one playhead per
  row instead), and `Swap A/B` is disabled. The Play label follows "either row running".
- `src/main.ts`: `transports` host between the bar and the mixer, two `SlotTransport` rows,
  `handleToggleIndependent`, `renderTransports`, `handleSlotTimeUpdate`,
  `handleSlotPlayStateChange`; `selectFile` re-anchors only the replaced row, the Settings
  track picker only re-anchors A, `handleSwap` refuses while the mode is on, `pagehide` clears
  both playheads.
- `src/ui/shortcuts.ts`: the `?` list explains that Space starts both and the arrows step A.
- `src/styles.css`: `.transports`, `.transport*` (tokens only, wrap at 360 px) plus explicit
  `[hidden]` rules for `.controls__timeline`, `.controls__steps` and `.controls__frame`, whose
  `display: flex` would otherwise outrank the UA rule.
- `tests/slots.test.ts` (new, 15 tests): limits, clamping (including `±Infinity`), end
  detection, restart-on-play, and frame stepping clamped to one slot's own duration.

**Gate:** `npm run typecheck`, `npm test` (236 tests, 12 files), `npm run build` — all green.

**Decisions**

- Enabling the mode pauses both videos. Two independent playheads cannot meaningfully inherit a
  shared one, and a predictable starting state beats a clever one.
- Disabling the mode pauses both and hard-seeks B onto A's playhead — the only direction that
  guarantees the user cannot leave the mode silently misaligned.
- In independent mode the shared Play button (and Space) still means "run both", each from its
  own position. That is the fastest way to see the two pictures diverge, which is the point.
- Each row clamps to *its own* duration. Clamping to `min(durationA, durationB)` would make the
  longer file unreachable in the mode that exists to inspect it.
- Keyboard arrows step video A only. A "last used row" rule would be hidden state; the rows have
  their own `◀`/`▶`, and the `?` list says which is which.
- `Swap A/B` is disabled (and `swap()` refuses) in independent mode: exchanging sources would
  also have to exchange two playheads, which is precisely the state the mode keeps apart.
- The readout loop is `requestAnimationFrame`, not `requestVideoFrameCallback`: rVFC is attached
  to one element, and in this mode neither element is "the" clock.
- The external track stays A's soundtrack and runs only while A runs; with a track loaded, B's
  own audio stays silent, exactly as in linked mode.

**Known limitations / not done yet**

- Row step buttons are always one frame; the Step unit select applies to the shared bar only.
- Loop is per row (each element restarts itself), which is the only reading that makes sense
  when the two lengths differ.
- Speed stays global: one rate for both rows, no per-video rate.
- Buffering is not coordinated: a stalling row pauses alone instead of pausing the pair.
- The mode is not persisted across `pagehide`, like every other UI setting.
- The frame counter (and `Frame N` readout) is a linked-mode affordance; rows show time only.

**Manual verification needed (browser)** — `test-media/` videos

1. Press **Independent** while playing: both videos pause, the shared timeline/frame/steps
   disappear, and two rows (`A`, `B`) appear with each video's own duration.
2. Press `A`'s Play: only A moves; B's picture is frozen and its readout does not change. Press
   `B`'s Play: both run, and their times can pass each other.
3. Drag A's scrubber to the middle: A follows the thumb, B does not move, and the stage wipe
   still shows both at their own frames.
4. Press `A`'s `▶` twice: exactly one frame per press on A and nothing on B. Then `B`'s `◀`.
5. Stop the shared **Play** while both run: both stop, each keeping its own position.
6. Let the shorter video end: only that row pauses at its own end (the other keeps running with
   loop off); with Loop on, that row restarts alone.
7. Press **Independent** again: both pause, B's picture jumps onto A's, and the shared timeline
   returns showing A's time.
8. Space and the arrow keys in independent mode: Space starts/stops both, arrows step A only.
9. Load a third audio track (Settings) and play A in independent mode: the track is heard with
   A; pause A and it stops. B's own audio stays silent while a track is loaded.
10. Replace a file while in independent mode: the replaced row resets to 00:00.000 and the other
    row does not move.
11. At 360 px the two rows stack without horizontal scrolling and every control stays ≥44 px.

## Phase 10.1 — Fix: the third audio source could silence everything ✅

**Bug (reported):** choosing a third audio source broke the audio.

**How it was pinned down.** The app was built with a temporary probe page that imported the real
`media.ts`, `audio.ts` and `sync.ts`, wrapped `AudioContext.prototype.createGain` so every mixer
channel was also tapped by an `AnalyserNode`, and drove the three flows in headless Chrome
(`file://`/http, `--autoplay-policy=no-user-gesture-required`). Measured RMS per channel instead
of guessing:

| Flow | gains A / B / track | RMS A / B / track | `track.paused` |
|---|---|---|---|
| play with no track (baseline) | 1 / 0 / 0 | 0.088 / 0 / 0 | – |
| **play, then choose a track** | **0 / 0 / 0** | **0 / 0 / 0** | **true** |
| choose a track, then play | 0 / 0 / 1 | 0 / 0 / 0.426 | false |
| choose a track while playing, then remove it | 1 / 0 / 0 | 0.089 / 0 / 0 | – |

So the graph was fine (`createMediaElementSource` on a src-less element works, and a source
assigned later still plays) — the state machine was not.

**Cause**

1. Loading the track made the mixer silence both videos (correct: the track *replaces* them) but
   nothing ever called `play()` on the track element. `playTrack()` only ran from `play()`, a loop
   restart or a stall recovery, so a track chosen while playback was running sat paused between
   two muted videos: total silence.
2. A second, compounding defect: `correctTrack()` ran on every drift sample without checking that
   the track was running. A paused element's clock is frozen, so every sample looked like drift,
   and each one hard-seeked *and* ducked the track. Its gain never left 0 — this is why the
   measured track gain was `0` rather than `1`, and why the track would still have stuttered had
   it been started.

**Fix**

- `sync.ts`: new `attachTrack()` — seeks the track to the picture and, if the picture is running
  (`playing && !suspended`, or the A row in independent mode), starts it. Paused transport only
  re-aligns. `main.ts` calls it whenever the track source changes (loaded, replaced, removed).
- `sync.ts`: `correctTrack()` now corrects only a *running* track, only while the picture runs,
  and at most once per 250 ms (`TRACK_CORRECTION_INTERVAL_MS`), so a lagging decoder cannot turn
  into per-frame seek + duck churn.
- `main.ts`: a rejected or broken track file now detaches the element (`media.clearTrack()`),
  which also revokes the failed blob URL; previously the element kept a dead `src` and looked
  loaded, and `resetTrack()` dropped the URL without revoking it.

**Verified:** same probe, after the fix — track chosen during playback: gains `0 / 0 / 1`,
RMS `0 / 0 / 0.4225`, `track.currentTime` 3.97 against the videos' 3.97, still `1` a second later
(no duck churn); removing it restores `1 / 0 / 0` with the video soundtrack back. The final run
repeated the whole flow without the analyser taps (plain gain read-outs plus a heartbeat) to make
sure the graph under test is the one the app builds: alive throughout, `1/0/0` → `0/0/1`
(track 3.12 s against the videos' 3.12 s) → `1/0/0`, page still running.

**Gate:** `npm run typecheck`, `npm test` (236 tests, 12 files), `npm run build` — all green.

**Manual verification needed (browser)** — `test-media/` videos plus any MP3/WAV

1. Play the pair with A at full level, then choose a track in Settings **while it is playing**: the
   track is heard immediately, in step with the picture (no silent gap, no restart from 00:00).
2. Keep playing for ~10 s: no stutter, no repeated dips, no drift between track and picture.
3. Remove the track while playing: the music stops and video A's own sound returns at its slider
   level.
4. Replace a playing track with another file: the new one joins at the current time.
5. Choose a track while **paused**, then press Play: the track starts with the videos.
6. Independent mode: load a track, press A's row Play → track plays with A; pause A → it stops;
   press B's Play only → the track stays silent (it is A's soundtrack).
7. Pick a non-audio file (e.g. a `.txt`) while a track is loaded: friendly error, no track left,
   video A's sound back.

**Next:** none — awaiting review of Phases 9, 10 and this fix.

## Phase 10.2 — Fix: the audio source could not be switched while a track was loaded ✅

**Bug (reported):** "now I can't even change the audio source properly — when I switch to the
other audio source of the footage it breaks."

**Measured first.** A probe drove the real `audio.ts` + `media.ts` and read every mixer gain
through an `AnalyserNode`:

| State | gains A / B / track | RMS A / B / track |
|---|---|---|
| videos playing, A at 100 % | 1 / 0 / 0 | 0.0877 / 0 / 0 |
| third source loaded | 0 / 0 / 1 | 0 / 0 / 0.4231 |
| **then switching the videos to B** | **0 / 0 / 1** | **0 / 0 / 0.4231** |

The switch did nothing: both video channels were pinned at 0. With the track fader also at 0 %
(or a track that had run out) that is indistinguishable from dead audio, and no slider the user
could reach brought the footage back.

**Cause.** Phase 9 made the track an *override*: `setTrackActive(true)` forced both video gains to
0 and ignored their levels entirely. "Track mode" was derived from `status === 'ready'`, so the
video faders became decorative for as long as a track existed. That also made `M` useless in that
state, because the cycle only moved video levels.

**Fix — the third source is a third fader, not a mode**

- `audio.ts`: `setTrackActive()` and the `trackActive` override are gone. `effectiveLevel()` is now
  simply the channel's own level, so every fader is always live.
- `main.ts`: loading a track applies a *level preset* (`presetTrackLevels()`): video faders to 0 %,
  track to 100 %. The resulting sound is identical to before, but nothing is disabled.
  `restoreVideoLevels()` puts back the levels the user had before the track — and only while the
  video faders still sit at the preset's 0 %, so a source picked in the meantime is not stomped.
  If there was nothing to restore, it falls back to A rather than to silence.
- `logic/mix.ts`: new `nextAudioLevels(levels, trackLoaded)` drives `M` through
  **A → B → silence → track → A** (the track step only exists while a track is loaded, and the
  order means one press from the freshly-loaded-track state brings the footage back). `nextSoloMix`
  is now that same function with no track, so the video-only cycle is unchanged and still tested.
- `logic/mix.ts`: `audibleSourceCount(mix, trackLevel, trackLoaded)` — the ±3 % nudge must also be
  suppressed when the track plays *against* a video, not just when both videos play.
- `ui/mix.ts`: new `renderTrackLevel()` so the track slider follows `M`; wording changed from
  "replaces the video soundtracks" to "mixed in with the videos". Settings hint and the `?`
  shortcut list updated to match.

**Verified after the fix**, same probe, then end to end in the real app (real UI, real files,
analyser taps injected before the app's scripts):

```
play           A .0879 audible                      (gains 1/0/1 — track has no source yet)
load track     track .424 audible, videos 0 %       (0/0/1)
press M        A .0883 audible, track 0 %           (1/0/0)   one press, footage back
press M        B .0884 audible                      (0/1/0)
Remove track   B still audible                      (0/1/0)   the pick is not stomped
```

No page errors; every state above was reached through the real controls (Settings file input, `M`,
the Remove button).

**Gate:** `npm run typecheck`, `npm test` (245 tests, 12 files), `npm run build` — all green.

**Supersedes:** the Phase 9 decision "Track replaces, never adds". The default *sound* when a track
is loaded is unchanged; what changed is that the video faders keep working, which is also why the
`M` cycle had to grow a track step.

**Manual verification needed (browser)** — `test-media/` plus any MP3/WAV

1. Play with A's own sound at 100 %, then load a third source: you hear the track, video sliders
   drop to 0 %, and the track slider appears at 100 %.
2. Press `M`: A's own soundtrack comes back in one press. Press `M` again: B's. Again: silence
   (all three faders 0 %). Again: the track.
3. With a track loaded, drag the **A** or **B** slider up by hand: the footage's audio mixes in
   with the track at once (no mode to escape, no dead slider).
4. Remove the third source while listening to B: B keeps playing at 100 % and the track slider
   disappears. Remove it while the video faders are still at the preset 0 %: A comes back.
5. Load a track, switch to B, then pick another track file: the new file plays and B stays at
   100 % (replacing a track does not reset your choice).
6. Load a track while **paused**, press Play: the track runs with the picture; press `M` to go back
   to the footage with the picture still running.
7. Independent mode with a track loaded: A's row plays the track, pause stops it, B's row alone is
   silent, and the video faders still do what they say.

**Next:** none — awaiting review.



---

## Phase 11 — Local codec converter (Lagarith, ProRes, DNxHD, FFV1, AVI, MXF…)

**Done**

- New pure module `src/logic/codec.ts` + `tests/codec.test.ts` (35 specs):
  `parseProbeLog` (reads codec/size/duration/audio out of ffmpeg's own `-i` output),
  `chooseConversionPlan`, `proxyVideoFilter`, `buildProxyArgs`, `proxyFilename`,
  `safeInputName`, `codecLabel`, `conversionBlocker`, the size/limit/failure/cancel messages,
  and `proxyWarning` for the info bar. `MAX_CONVERSION_BYTES` = 2 GiB, `PROXY_HD_HEIGHT` = 720.
- New `src/transcode.ts`: the only module that talks to ffmpeg.wasm. Single-thread
  `@ffmpeg/core` 0.12.10 + `@ffmpeg/ffmpeg` 0.12.15. `load` → `WORKERFS` mount (falls back to
  `writeFile`) → `ffmpeg -i` probe → chosen plan → `exec` with progress → `readFile` → `File`.
  `cancel()` terminates the worker and invalidates the instance; a failed/cancelled job is
  never reused. The module is imported with `import('./transcode')` on first conversion, so the
  core is never fetched for files that play natively.
- `scripts/copy-ffmpeg-core.mjs` copies `ffmpeg-core.js` and `ffmpeg-core.wasm` into
  `public/ffmpeg/` before `dev`/`build`. `public/ffmpeg/` is gitignored; the files land in `dist/`
  and are fetched from the page's own origin via `new URL('ffmpeg/…', document.baseURI)`.
- `src/state.ts`: `SlotSourceKind`, `ConversionStage`, `SlotConversion`, and per-slot
  `source`, `sourceCodec`, `sourceDurationSeconds`, `sourceWidth`, `sourceHeight`, `conversion`.
  `CompareSettings.fastProxy` (default **off** = full resolution) and the matching
  `InitialStateOverrides.fastProxy`.
- `src/main.ts`: conversion offer on any failed slot ("Convert A locally" / "Convert both
  locally"), one job at a time, live percentage in the drop zone, a stable
  "Converting video A locally…" message in the polite status region with a **Cancel conversion**
  action, proxy load through the existing media loader, and `source`-aware swap/clear/reset.
  The duration check now compares `sourceDurationOf()` — the *chosen* file — while the timeline
  keeps using the element (proxy) durations. Cancellation is requested when the slot is replaced,
  on `pagehide`, and by the Cancel button.
- UI: drop-zone conversion line (`Loading the local converter…` / `Reading the file…` /
  `Converting locally… 42 %`), `Proxy:` chip in the info bar, "Codec converter" section in
  Settings (fast 720p checkbox + license note), `.dropzone--converting` and
  `.info-chip--proxy` styles, and `VIDEO_ACCEPT_ATTRIBUTE` moved to `logic/file.ts` with the full
  editing-extension list (`.avi .mxf .wmv .ts .m2ts .dv .vob .rm .h264 .y4m …`).
- `THIRD_PARTY_NOTICES.md` for ffmpeg.wasm / FFmpeg (GPL-2.0-or-later).
- `vite.config.ts`: `optimizeDeps.exclude: ['@ffmpeg/ffmpeg']` and `worker.format = 'es'`
  (the wrapper spawns an ES-module worker with static imports).


**Decisions**

- **Single-thread core only.** GitHub Pages cannot send COOP/COEP, which the multithread build
  requires for `SharedArrayBuffer`. Single-thread conversion is slower but works on every target
  host without headers.
- **Opt-in, not automatic.** A decode failure only *offers* conversion; nothing large is downloaded
  until the user clicks it. Native MP4/WebM playback keeps its zero-dependency, zero-fetch path.
- **Copy only what is genuinely safe.** H.264 → MP4 (`-c:v copy`), VP8/VP9/AV1 → WebM
  (`-c:v copy`); everything else, including HEVC, is re-encoded to H.264 because a browser without
  a platform HEVC decoder would reject the "copy" and force a second conversion. Audio is copied
  only when the target container supports it (AAC/MP3 in MP4, Opus/Vorbis in WebM), otherwise
  transcoded (AAC / libopus); silent sources get `-an`.
- **Probe with `ffmpeg -i`, not ffprobe.** The input banner is printed by every `ffmpeg` build and
  is parsed by a pure, tested function. A probe that cannot be parsed still falls back to a full
  transcode instead of failing.
- **`WORKERFS` first.** Mounting the `File` avoids copying hundreds of megabytes into the wasm
  heap; `writeFile` is the fallback when mounting is unavailable.
- **Proxy output settings:** `libx264 -preset ultrafast -crf 20 -pix_fmt yuv420p -g 60`,
  AAC 128 kb/s stereo, `+faststart`, explicit `-f mp4|webm`, `-map 0:v:0` plus `0:a:0?`
  (extra tracks dropped). Full resolution by default; "Fast 720p proxy" in Settings scales down
  (never up) and enforces even dimensions.
- **The chosen file stays the slot's identity.** `slot.file`, `slot.label`, the source duration and
  the source codec keep describing the file the user picked; only the played picture comes from
  the proxy. The duration check therefore compares the originals, a proxy is never silently
  presented as the master (hence the chip), and A/B swap exchanges the proxy URL with the file.
- **2 GiB cap** with an honest message (`MAX_CONVERSION_BYTES`), because wasm32 cannot address more
  and a longer conversion would die on memory anyway.
- **Cancellation rules:** replacing a file, clearing a slot, `pagehide` or the Cancel button all
  terminate the worker; the awaiting job returns `cancelled` and the slot keeps its original error
  with a "conversion was cancelled" note. Results that arrive for a replaced file are discarded.
- The percentage lives in the drop zone, not in the status region: the polite live region gets two
  announcements per conversion ("Converting…", then the result), not one per percent.
- `@ffmpeg/util` is **not** used (no `fetchFile`/`toBlobURL` needed), so it is not a dependency.
  `@ffmpeg/core` is a dependency (not a devDependency) because the build copies its assets from
  `node_modules`.


**Verified**

- `npm run typecheck && npm test && npm run build` — build green, all specs passing.
- `dist/` contains `ffmpeg/ffmpeg-core.js` + `ffmpeg/ffmpeg-core.wasm` (32 MB) next to
  `assets/…`, `index.html` references `./assets/…`, and the wrapper's worker is emitted as
  `assets/worker-*.js` and referenced relative to the transcode chunk.
- Headless Chrome, real UI, real files (throwaway CDP harness, removed afterwards):
  - `ffv1.avi` (FFV1 + PCM in AVI): status `Video A could not be loaded.` +
    `Convert A locally`; after the click the slot is `ready`, the video reports 3 s / 640 px, and
    the info bar shows `Proxy: FFV1 640 × 480 was converted locally to H.264…`.
  - The same file in B: `Durations match (A 00:03.000 / B 00:03.000)` — the check used the source
    durations.
  - Play with both proxies: both elements playing, A 1.512 s / B 1.508 s, drift −4 ms.
  - Swap with two proxies: both slots stay `ready`, both chips and both info rows survive.
  - `prores.mov` and H.264-in-MKV played natively in that Chrome build, so no offer was shown —
    which is the intended behaviour (conversion is a fallback, not a default).
  - No page exceptions were reported during any of it.


**Manual verification needed (browser)** — `test-media/` now also has `ffv1.avi`,
`prores.mov` and `h264.mkv`

1. Drop a **Lagarith** AVI (your own file) on A: you get the unsupported message with
   *Convert A locally*; after clicking, the drop zone counts up, the status switches to
   "Converting video A locally…", and the picture appears at the same playhead once it finishes.
2. Confirm the first conversion fetches `ffmpeg/ffmpeg-core.wasm` (DevTools → Network) and that a
   second conversion does **not** re-download it. Compare a normal MP4 pair first: no request at all.
3. Press **Cancel conversion** mid-job: the worker stops, the drop zone returns to the error state
   with a cancellation note, and clicking *Convert A locally* again works.
4. Replace the file while it is converting: the old job stops, no stale proxy appears, and the new
   file behaves normally.
5. Convert two different editing files (one AVI, one MOV) and check the duration line and both
   chips; then swap A/B, scrub, play, and confirm both proxies stay in sync.
6. Load an H.264-in-MKV file (if your Chrome refuses MKV): the status should say *Remuxing into
   MP4* and finish almost instantly, because the picture is copied.
7. Toggle **Settings → Codec converter → Fast 720p proxy**, convert a 1080p editing file, and
   confirm the proxy is 720p (info bar) while the chip still names the source resolution.
8. Try a file over 2 GB: you should get the limit message immediately and no download.
9. Check the layout at 360 px while converting (drop-zone line, Cancel button), with reduced
   motion and in both colour schemes. Then reload the page mid-conversion: nothing should linger.

**Next:** awaiting review. Not built (deliberately): HDR/10-bit proxy fidelity, pixel-perfect
comparison between proxy and master, multithread conversion, batch queueing.


---

## Phase 12 — Full-width footage + Adobe-style workspace ✅

**Done**

- **Layout — the footage is now the workspace.** `src/styles.css` was rewritten from scratch.
  `.app` is one vertical column (title bar → `main`), and `.compare` stacks its parts instead of
  sitting next to the loader: `stage → transport → mixer → per-video transports (independent
  mode) → inspector → replace strip`. The stage spans the window edge to edge with no side
  padding, so both videos are as wide as the window instead of half of it.
- `.stage__frame` keeps A's aspect ratio and fills the width. Its only cap is
  `max((100dvh - --stage-chrome) * AR)`, so on a 16:9 window the viewer stops at the width that
  still leaves the transport on screen (exactly what Premiere's program monitor does) while a
  short window shrinks it instead of pushing playback out of view. `--stage-chrome` steps from
  210 px to 252 px (≤ 1200 px) to 330 px (≤ 700 px) because the bars wrap onto more rows there.
- Everything informational moved below the viewer: transport bar, audio mixer, the two source
  inspectors (resolution / FPS / duration), the duration-check strip and the compact "replace"
  strip. `.loader--compact` now uses `flex-direction: column-reverse` so the check reads *above*
  the replace zones instead of being buried at the very bottom.
- No markup changes were needed in `src/main.ts` or `src/ui/*` — every class name the modules
  emit (`compare__stage`, `compare__controls`, `compare__info`, `transports`, `loader--compact`,
  `dropzone[data-state]`, `status[data-tone]`, `mix__channel[data-slot]`, …) is styled again, and
  the only DOM contract touched is presentational.

**Styling — Adobe (Spectrum) workspace**

- Dark charcoal palette taken from Photoshop / After Effects: `#1e1e1e` app, `#323232` panels,
  `#262626` inset fields, `#3d3d3d` buttons, Spectrum blue `#2680eb` for selection and the one
  primary action. Light scheme re-tinted with Spectrum light tokens (#f0f0f0 / #1473e6) instead
  of being dropped.
- 3 px corners everywhere, 1 px separators, inset top highlight on every panel, slim square
  scrollbars, small uppercase tracking-wide section labels (`SETTINGS`, `AUDIO`, `SPEED`).
- Title bar: sticky, gradient, "VC" app tile, Settings and "?" as flat Adobe buttons. Both
  popovers are now flyouts with a 2 px blue top edge and a deep drop shadow.
- Controls: flat grey buttons with a blue hover border, blue **Play** primary, native selects and
  range inputs tinted with `accent-color`, monospace readouts on inset plates, `aria-pressed`
  toggles switch to the blue tint.
- Stage: A/B corner chips are layer chips — blue A, orange B — pinned to the corners, monospace
  rename field, black translucent pill over the video. The wipe handle is a Spectrum-blue disc
  with two CSS grip dots and a white focus ring; the divider is a 1 px hairline.
- Duration check reads as an Adobe notice: tone edge on the left (green / amber / red) with the
  message tinted to match. Warning chips are squared Spectrum chips instead of 999 px pills.
- Accessibility kept intact: 44 px minimum on every interactive element, visible `:focus-visible`
  rings, `prefers-reduced-motion`, `prefers-color-scheme`, and a 360 px layout that keeps the A/B
  tags on one row and reflows the transport into four tidy rows.

**Verified**

- `npm run typecheck && npm test && npm run build` — 282 tests pass, build clean.
- Measured in headless Edge over CDP at 1920×1080, 1440×900, 1280×720, 1024×768 and 390×844:
  `scrollWidth === clientWidth` and zero elements past the right edge at every size. At 1440×900
  the frame is 1227×690 with transport, mixer and inspectors visible without scrolling.
- Screenshot-checked the empty state, the loaded state, the Settings flyout and the "?" list.

**Decisions**

- The viewer is capped by viewport height, not just width. A literal full-width frame on 1440×900
  is 810 px tall and pushes the transport below the fold; the cap trades ~15 % width for a
  transport that is always visible, which is what an NLE does.
- The mixer stays under the transport at every width. A side-by-side variant was tried and
  reverted: at 1440 px it squeezed the transport into two rows and clipped the time readout.
- `--stage-chrome`  is a hard-coded budget per breakpoint rather than a measured value. Measuring
  the real chrome height would need JS writing a custom property on every resize; three media
  queries cover the wrapping cases with no runtime code.

**Must verify by hand (test-media/)**

1. Load a 1080p pair and confirm both pictures span the window width, the divider wipes cleanly
   and the A/B chips stay pinned in their corners while dragging.
2. Play and scrub: the transport, mixer and inspectors sit fully below the viewer at 100 % zoom
   on a 1440×900 and a 1920×1080 window, without scrolling.
3. Drag the wipe handle with the mouse and by touch; Tab to it and use ArrowLeft/Right,
   Shift+Arrow, Home and End. The blue disc and the white focus ring should be obvious.
4. Open Settings and "?" — they should drop down from the title bar with a blue top edge, stay
   inside the viewport at 360 px wide, and close on Escape.
5. Check the duration mismatch state (a 10 s and a 3 s file): amber edge, "Compare anyway"
   visible, and the strip sits above the replace zones once both videos load.
6. Switch to Independent, Loop and Mute/mix states and confirm the blue `aria-pressed` tint and
   the per-video rows still read clearly.
7. Fullscreen (F): the viewer fills the screen and the bars remain reachable by scrolling.
8. Set the OS to light mode and to reduced motion, then re-check contrast and that nothing
   animates.

**Next:** awaiting review. Not built (deliberately): draggable panel splitters, side-by-side view,
a real timeline with clips, and user-selectable themes.


## Phase 13 — Brand rename, first-visit welcome card, SEO ✅

**Done**

- **Name.** The product and the site are now **Comparitoer** everywhere it is visible: `<title>`,
  the app's `<h1>`, the title-bar tagline (`Compare two videos in sync. Nothing leaves this
  device.`), the `"C"` monogram in `src/styles.css`, the stylesheet header comment and the
  `package.json` description. `package.json` `name` was already `comparitoer`.
- **First-visit welcome card** — new `src/logic/welcome.ts` (pure: `WELCOME_STORAGE_KEY =
  'comparitoer.welcome.v1'`, `WELCOME_DISMISSED_VALUE`, `WelcomeMessage`, `WELCOME_MESSAGE`,
  `isWelcomeDismissed`, `isWelcomeDismissedIn`), new `src/ui/welcome.ts`
  (`createWelcome({ message })` → `element` / `dismiss` / `destroy`) and `tests/welcome.test.ts`
  (8 specs). Wording lives only in `WELCOME_MESSAGE`; nothing else has to change to rewrite it.
- The card is an `aside.welcome` with `role="note"` (informational, never steals focus), a title,
  one paragraph, and a `×` button with a 44 px hit area. It is appended to `document.body` after
  the shell mounts, floats bottom-left (`position: fixed`, safe-area insets, `z-index: 80` above
  the 70 popovers) and stretches to the viewport width at ≤ 559 px.
- Dismissal is explicit only (button or Escape) and is written to `localStorage`; a dismissed
  card is not appended at all on the next visit. Storage is read and written inside `try/catch`,
  so Safari private mode / blocked cookies show the card but cannot remember it — the app never
  breaks because of storage.
- `src/main.ts` gains one import pair and one call after `mountAppShell(root)`; the composition
  root, `pagehide` cleanup and the sync engine are untouched (the card owns no URLs or callbacks).
- **SEO.** `index.html` now carries a keyword title (~52 chars), a ~150-char description,
  `robots`, `application-name`, dark/light `theme-color`, an SVG favicon, Open Graph and Twitter
  tags, and a `WebApplication` JSON-LD block (`alternateName: "Video Compare"`, category
  `MultimediaApplication`, free offer, feature list — no invented ratings).
- Static, crawlable `<section class="about">` after `#app`: `h2` intro, "How it works" `<ol>`,
  "What you can do" `<ul>` with the real feature vocabulary (tolerance, wipe, drift correction,
  independent mode, audio mix, local proxy), a five-item `<details>` FAQ, and the "Your files
  never leave this device" note. Plus a `<noscript>` line for JavaScript-off visitors. The app
  keeps the page's only `h1`; the static block starts at `h2`.
- New `public/favicon.svg` (hand-written "C" tile in Spectrum blue, 324 bytes) and
  `public/robots.txt` (`User-agent: *` / `Allow: /`). Both are copied into `dist/`.

**Gate:** `npm run typecheck && npm test && npm run build` — 290 tests pass (14 files), build
clean. Verified in `dist/index.html`: every tag survived, the JSON-LD blob parses with
`JSON.parse`, assets are still `./assets/...`, the About section is present, and `dist/` contains
`index.html`, `robots.txt`, `favicon.svg`, `assets/` and `ffmpeg/`.

**Decisions**

- One storage key with a `.v1` suffix instead of hashing the message: bump to `.v2` when the copy
  changes enough that returning visitors should see the card once more. No expiry — a welcome
  note is not a consent banner.
- Corrupt or foreign values in the key count as "not dismissed", so a damaged entry can never
  hide the card permanently.
- `role="note"` rather than `alert`/`dialog`: no focus trap, no live-region interruption, and
  Escape just closes it without `preventDefault`, so an open popover can still handle the key.
- The card is appended to `body`, not `#app`: `#app` is a full-height flex column and a floating
  child there would join the layout flow.
- The About block is static HTML rather than JS-rendered: crawlers that do not execute the bundle
  still see the full text, and it costs nothing at runtime.
- No canonical / `og:url` / `og:image` / sitemap yet — all of them need the production URL, and a
  placeholder is worse than an absent tag. Add them (plus a 1200×630 `public/og-image.png`) once
  the domain is known.

**Must verify by hand (test-media/)**

1. Fresh profile: the welcome card appears bottom-left over the app, reads correctly, and does
   not cover the drop zones or the transport.
2. Reload after dismissing with `×`: the card is gone. Clear the `comparitoer.welcome.v1` key in
   DevTools → it comes back.
3. Open the card, press Escape: it closes and the shortcut list (if open) closes on the same
   press. Tab reaches `×` with a visible focus ring; the card never grabs focus on load.
4. Block storage for the site (or use Safari private mode): the card still shows and still closes.
5. Light mode and reduced motion: card contrast is fine and there is no slide/fade.
6. 360 px wide and fullscreen: the card fits the viewport and does not sit under the safe-area
   inset on a phone.
7. Scroll below the app: the About section reads as a page footer, the FAQ items open and close,
   and the title bar no longer overlaps it when scrolled.
8. Run the deployed URL through Lighthouse (SEO + a11y) and Google's Rich Results Test: the
   `WebApplication` entity should be detected, and crawlers should see the About text without
   executing JavaScript.

**Next:** awaiting review. Deferred until the production URL is known: canonical, `og:url`,
`og:image` + Twitter image, `sitemap.xml` and the `Sitemap:` line in `robots.txt`.

---

## Phase 14 — README, manual test checklist, deploy workflow refresh ✅

**Done**

- `.github/workflows/deploy.yml` verified and refreshed. Same shape as Phase 0 (build job:
  `npm ci → typecheck → test → build`; `configure-pages` → `upload-pages-artifact` with
  `path: dist` → `deploy-pages`), same `permissions: contents: read / pages: write /
  id-token: write`, same `pages` concurrency group, same `main` + `workflow_dispatch` triggers.
  Action majors bumped to the current releases (checked against the GitHub API, 2026-10-26):
  `checkout@v4 → v7`, `setup-node@v4 → v7` (still `node-version: 24`, `cache: npm`),
  `configure-pages@v5 → v6`, `upload-pages-artifact@v3 → v5`, `deploy-pages@v5` unchanged.
  Added `timeout-minutes: 15` / `10` so a hung install or deploy cannot hold a runner for hours,
  and a comment that `npm run build` also stages the ffmpeg core into `dist/ffmpeg/`.
- `README.md` (new): what the app is, requirements (Node 24 LTS, npm 10+, current
  Chromium/Safari/Firefox), `npm ci && npm run dev`, the scripts table, the definition of done,
  build output, Vercel (framework preset **Vite**, build `npm run build`, output `dist`,
  install `npm ci`, no env vars), GitHub Pages (Settings → Pages → Source: GitHub Actions,
  push to `main`, `https://gothmiku.github.io/comparitoer/`), the privacy/network section and a
  project-layout map linking `PROGRESS.md`, `TESTING.md` and `THIRD_PARTY_NOTICES.md`.
- `TESTING.md` (new): manual browser checklist built from the five acceptance criteria —
  equal-duration green status + 5-minute lockstep; duration delta + "Compare anyway" clamping;
  divider by mouse/touch/keyboard with pinned corner tags; scrub/frame-step/speed/loop staying in
  sync; and no network requests after load. Includes the fixture table from `test-media/`, a
  per-browser sign-off table and a final static-grep block.
- Network audit of `src/` (requested): `grep -rnE 'fetch|XMLHttpRequest|WebSocket|sendBeacon' src/`
  returns **no call sites**. The only three hits are the word "fetched" in comments in
  `src/transcode.ts` (lines 22, 50, 208). `XMLHttpRequest`, `WebSocket` and `sendBeacon` appear
  nowhere in the repository (57 files searched). `src/media.ts` remains the only owner of
  `createObjectURL`/`revokeObjectURL`.

**Gate:** `npm run typecheck && npm test && npm run build` — green. 290 tests / 14 files.
`dist/` contains `index.html`, `assets/` (js + css + source maps), `favicon.svg`, `robots.txt`
and `ffmpeg/ffmpeg-core.{js,wasm}` (31 MB). `dist/index.html` still references `./assets/…` and
`./favicon.svg`, so one artifact serves both a domain root and a Pages subpath.

**Decisions**

- **The ffmpeg core is documented as the one post-load request, not hidden.** The first time a
  file needs converting, `@ffmpeg/ffmpeg` loads `ffmpeg/ffmpeg-core.js` + `.wasm` from this
  site's own origin (~32 MB, once per session, only for unsupported files). That is a
  same-origin asset load, not an upload and not telemetry, but "no network requests after the
  initial load" is literally untrue in that one flow. The checklist therefore states the
  criterion for the compare workflow and then verifies the exception explicitly. The marketing
  copy in `index.html` ("no runtime network requests") was left untouched — changing it is a
  product-copy decision, not a test-doc one.
- **`npm run build` is documented everywhere instead of `vite build`.** The bare Vite command
  skips `core:copy`, which would ship a converter with no decoder on Vercel or Pages.
- **No CI badge in the README.** A badge is an external image request, it breaks on a private
  repo, and the "no third-party requests" story is cleaner without it.
- **Checklist lives in `TESTING.md`, not in `PROGRESS.md`.** `PROGRESS.md` keeps a per-phase
  log; the acceptance criteria need one stable place that is re-run unchanged. Per-phase manual
  lists stay where they are for history.
- **No `LICENSE` file added.** There is none in the repo and picking a license is the owner's
  call; the README links the ffmpeg licensing notice only.
- Action majors were bumped in one step rather than pinned to SHAs: this is a personal static
  site, and tag pinning makes the "refresh the workflow" chore recur. Switch to SHA pins if the
  repo ever needs hardened supply-chain posture.

**Must verify by hand (browser)** — the whole of `TESTING.md`, in Chrome plus one other engine.
Shortest useful pass:

1. `npm run dev`, drop `a-10s-30fps.mp4` + `b-10s-30fps-gray.mp4`: green `Durations match`.
2. Swap B for `b-12s-gray.mp4`: amber, `2000 ms`, video B longer; "Compare anyway" clamps the
   timeline to `00:10.000`.
3. Divider: drag with the mouse, emulate touch, then Tab to it and use arrows / Shift+arrows /
   Home / End; the A and B tags stay in their corners at every position.
4. `long-a.mp4` + `long-b.mp4`: play 5+ minutes with no visible drift, then scrub, frame step,
   every speed and loop and confirm the pair stays aligned.
5. Network tab with Preserve log: after load, only `blob:` media entries while comparing;
   `prores.mov` triggers exactly one same-origin `ffmpeg/ffmpeg-core.*` download.

Deploy checks: push to `main` and watch the Pages run, then load
`https://gothmiku.github.io/comparitoer/` and import the same repo on Vercel with the Vite
preset / `dist` to confirm both hosts serve the relative assets and the converter.

**Next:** awaiting review. Deferred: canonical/`og:url`/`og:image`/`sitemap.xml` (needs the
production URL) and the `index.html` network wording if the ffmpeg exception should be reflected
in the public FAQ.

