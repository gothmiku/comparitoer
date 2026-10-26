# Manual test checklist

The automated gate (`npm run typecheck && npm test && npm run build`) covers the pure logic and
the build, but not playback feel, pointer input or the network. Those are checked here, by hand,
in a real browser.

Work through the sections in order; each one maps to an acceptance criterion. Tick a browser only
after *every* box in that section passes in it.

| Run                     | Date | Result |
| ----------------------- | ---- | ------ |
| Chrome 1xx, Windows 11  |      |        |
| Edge 1xx, Windows 11    |      |        |
| Firefox 1xx, Windows 11 |      |        |
| Safari 1xx, macOS       |      |        |
| Chrome, Android (touch) |      |        |

## Setup

```bash
npm ci
npm run dev        # or: npm run build && npm run preview
```

Fixtures live in `test-media/` (gitignored, not shipped):

| File                                  | Duration | Frame rate | Size     | Use for                            |
| ------------------------------------- | -------- | ---------- | -------- | ---------------------------------- |
| `a-10s-30fps.mp4`                     | 10 s     | 30 fps     | 16:9     | A side of the equal pair           |
| `b-10s-30fps-gray.mp4`                | 10 s     | 30 fps     | 16:9     | B side of the equal pair           |
| `b-12s-gray.mp4`                      | 12 s     | 30 fps     | 16:9     | duration mismatch (A is shorter)   |
| `c-10s-24fps-4x3.mp4`                 | 10 s     | 24 fps     | 4:3      | aspect-ratio + frame-rate chips    |
| `long-a.mp4`                          | 180 s    | 30 fps     | 1280×720 | 5-minute lockstep run              |
| `long-b.mp4`                          | 180 s    | 30 fps     | 1280×720 | 5-minute lockstep run              |
| `prores.mov`, `ffv1.avi`, `h264.mkv`  | varies   | varies     | varies   | converter / error paths            |

Durations are the nominal values in the fixture names; the app reports the exact values it reads
from each file, so a "10 s" clip may read `10.010`.

Prepare two browser tabs: one for sections 1–4, one for section 5 with DevTools → Network open
and **Preserve log** ticked.

> Reset between sections: reload the page. Renamed tags, speed, loop and audio choices live in
> memory and are intentionally not persisted.

---

## 1. Equal-duration files — green status, 5+ min in lockstep

Files: `a-10s-30fps.mp4` (A) + `b-10s-30fps-gray.mp4` (B), then `long-a.mp4` + `long-b.mp4`.

**Status**

- [ ] Drop the 10 s pair. The status region turns **green** and reads
      `Durations match (A 00:10.000 / B 00:10.0xx)` — both real durations are shown, not a
      rounded or hard-coded pair.
- [ ] A screen reader (or the accessibility inspector) announces the status **once** per change:
      it is a `role="status"` / `aria-live="polite"` region and the action button sits outside
      the live area.
- [ ] The info bar shows resolution, estimated frame rate and duration for A and B.
- [ ] No warning chips for this pair (same aspect ratio, same frame rate).
- [ ] The scrubber spans `10.000` and reads `00:00.000 / 00:10.000`.

**Lockstep for 5+ minutes**

- [ ] Replace both files with `long-a.mp4` / `long-b.mp4`; the scrubber spans `03:00.000`.
- [ ] Press Play (or Space). Both pictures start together and the button reads Pause.
- [ ] Align the divider on a recognisable feature (both fixtures are `testsrc` patterns with a
      running timer). At 50 % the two halves join seamlessly.
- [ ] Watch for **at least 5 minutes** without touching anything: no visible B lag, no periodic
      jump/reset, no brief freeze, the frame counter keeps climbing.
- [ ] The timer in the picture and the readout stay within a frame or two of each other.
- [ ] Pause: both freeze on the *same* frame and the readout stops.
- [ ] Resume: both continue from the same spot, still aligned.
- [ ] DevTools console is free of errors and of repeated `seeked` churn.
- [ ] Optional, stronger check: with a clip that has a tone, a corrective seek ducks the
      follower's audio for ~80 ms — it must not click or drop out audibly.

---

## 2. Different durations — correct delta and "Compare anyway"

Files: `a-10s-30fps.mp4` (10 s) + `b-12s-gray.mp4` (12 s).

- [ ] Status is **amber** and names both durations: `A 00:10.000 / B 00:12.000`.
- [ ] The delta is stated in milliseconds (`2000 ms`) **and** it says which video is longer
      (video B).
- [ ] A "Compare anyway" button is offered; nothing is blocked behind it — both videos still
      load and play without it.
- [ ] Open **Settings** (the `Settings` button in the header) and change *Duration tolerance* to
      e.g. `2.5`. The verdict flips to a match without reloading the files. Change it back to
      `0.05`.
- [ ] Set the tolerance to an invalid value (`-1`, `abc`): the inline error appears and the
      previous tolerance stays in effect.
- [ ] Click **Compare anyway**. The status changes to "Comparing the shorter video
      (00:10.000)", the scrubber max and the total time become `00:10.000`, and the frame
      counter stays consistent.
- [ ] Play to the end: both stop at `00:10.000`; B is *not* allowed to run 2 s past A.
- [ ] Scrub to the far right, then press Play: playback restarts from the clamped end, not from
      12 s.
- [ ] Create the mismatch the other way round (A 12 s, B 10 s): the message names A as longer
      and the clamp still follows the shorter file.
- [ ] Loading a new file resets the acknowledgement, and so does changing the tolerance.

---

## 3. Wipe divider — mouse, touch, keyboard; tags stay pinned

Files: any pair; putting `c-10s-24fps-4x3.mp4` on one side makes the corner tags easier to
judge against a differently shaped picture.

**Mouse**

- [ ] Drag the round handle: the divider follows the pointer smoothly, A is visible to the left,
      B to the right, and the clip-path (`inset(0 0 0 X%)`) moves with it.
- [ ] Drag beyond the stage edges: the divider clamps at 0 % and 100 %, with no NaN and no jump.
- [ ] Release the pointer outside the stage: the divider still tracks (pointer capture) and stops
      on release.
- [ ] Click the stage away from the divider: the divider does **not** move — the scrubber is a
      separate control.
- [ ] Right-click drag does nothing and the context menu is not hijacked.

**Touch**

- [ ] In DevTools device emulation (or on a phone), drag the divider with one finger: it follows.
- [ ] The 44 px hit strip means it can be grabbed without hitting the exact hairline.
- [ ] A two-finger gesture or a page scroll during a drag does not leave the divider stuck
      (`pointercancel` / `lostpointercapture` are handled).

**Keyboard**

- [ ] Tab to the divider: a visible focus ring, `role="slider"`, and `aria-valuenow` /
      `aria-valuetext` present in the accessibility tree.
- [ ] ArrowLeft / ArrowRight move it by **1 %** per press.
- [ ] Shift + ArrowLeft / ArrowRight move it by **10 %**.
- [ ] Home → 0 %, End → 100 %; repeated presses at either end stay clamped.
- [ ] `aria-valuenow` tracks every move (rounded to whole percent) and is announced.
- [ ] While the divider has focus, Arrow keys do **not** also step video frames: the global
      shortcut yields to the slider.
- [ ] Tab away and press the arrows: frame stepping works again.

**Tags**

- [ ] A's tag is pinned top-**left**, B's top-**right**, in the stage corners — not on the
      divider.
- [ ] Move the divider to 0 %, 50 % and 100 %: both tags stay exactly in their corners.
- [ ] Default text is the filename without extension; a long filename ellipsis-truncates instead
      of pushing into the corner.
- [ ] Click a tag, type a new name, press Enter (or blur): the name sticks and stays in the
      corner. Escape cancels the edit.
- [ ] While renaming, Space / arrows / L / M / F type into the field instead of triggering
      shortcuts.
- [ ] At ~360 px viewport width the two tags do not overlap and remain readable.
- [ ] After a swap, the tags follow their videos (A label now sits over the former B picture).

---

## 4. Scrub, frame step, speed and loop keep both videos in sync

Files: `a-10s-30fps.mp4` + `b-10s-30fps-gray.mp4`, then `long-a.mp4` + `long-b.mp4`.

**Scrub**

- [ ] Press on the scrubber and drag for ~10 s: both videos stay paused, the readout tracks the
      thumb, and there is no black flash or stutter storm (seeks are rAF-throttled).
- [ ] Release: both land on the same frame at the new time. If it had been playing, it resumes
      **once** from there.
- [ ] Click once in the middle of the track, then use Tab + arrows / PageUp / PageDown / Home /
      End on the focused scrubber: every position lands on both videos, `aria-valuetext` is
      announced, and the two pictures stay aligned.

**Frame step**

- [ ] With the step unit on **Frame**, press ArrowRight ten times: the frame counter advances by
      exactly 10, both videos move together, and no drift builds up.
- [ ] ArrowLeft ten times returns to the starting frame and the same picture.
- [ ] Holding the key repeats the step and the pair stays aligned.
- [ ] Switch the step unit to `1 s`, `5 s`, `10 s`: the step buttons move by that much and the
      readout matches.
- [ ] Shift + ArrowLeft/Right jumps exactly one second.
- [ ] On `long-a.mp4`/`long-b.mp4`, step near the timeline end: it clamps at `03:00.000` instead
      of overshooting.

**Speed**

- [ ] Try every speed (0.25×, 0.5×, 1×, 1.5×, 2×) while playing: both videos change rate
      together and stay aligned at the divider.
- [ ] Stay at 2× for ~30 s: no accumulating lag between the two halves.
- [ ] Change speed mid-play, then pause and resume: no jump, no rate left behind on one element.
- [ ] Back at 1×, the pair is still aligned and the audio is back to normal pitch and tempo.

**Loop**

- [ ] Enable loop by click and with `L`; the control shows it is on.
- [ ] Play to the end: both restart at `00:00.000` **together** and keep looping watchably for
      more than three passes, with no creep between the halves.
- [ ] Turn loop off while playing past the end: playback stops at the end and the button returns
      to Play.
- [ ] With loop on, scrub near the end and let it run: the wrap happens once, not twice, and the
      readout resets with the picture.

**Combinations**

- [ ] Scrub while loop is on: no double restart.
- [ ] Frame step backwards from the very end with loop off: it works and stays on the last frame.
- [ ] Swap A/B: the corner tags swap with the pictures, the divider stays put, playback stays in
      sync.
- [ ] Fullscreen (`F`) during playback: both videos keep running and stay aligned; Escape exits.

---

## 5. No network requests after the initial load

Files: `a-10s-30fps.mp4` + `b-10s-30fps-gray.mp4` for the main run, then the converter files.

- [ ] Open DevTools → **Network**, tick **Preserve log**, and reload the page.
- [ ] The load itself contains only **same-origin** app assets: `index.html`,
      `assets/index-*.js`, `assets/index-*.css`, `favicon.svg`.
- [ ] No third-party domain appears at all — no fonts, no analytics, no CDN, no cross-host
      source maps.
- [ ] Drop both videos and exercise the whole app for ~2 minutes: play, pause, scrub, frame
      step, every speed, loop on/off, rename both tags, move the divider, change the tolerance,
      swap, fullscreen, cycle audio with `M`, switch to independent mode and back.
- [ ] During all of that the **only** new entries are `blob:` media requests for the two files
      (plus the audio element if you load a track). No `fetch`/`XHR` to any path, no `POST`,
      nothing leaving the page.
- [ ] Switch DevTools to **Offline** and keep comparing: everything above still works for
      natively playable files.

**Documented exception — the local converter**

- [ ] Drop `prores.mov` (or `ffv1.avi`) on A. The status explains that the decoder is being
      loaded (~32 MB, downloaded once, nothing uploaded).
- [ ] In Network, exactly two same-origin requests appear: `ffmpeg/ffmpeg-core.js` and
      `ffmpeg/ffmpeg-core.wasm`. They are **not** third-party and there is no upload.
- [ ] Convert a second unsupported file in the same session: the core is **not** downloaded
      again (one-time per session).
- [ ] Cancel a conversion mid-way: the status recovers, both slots still behave, and no further
      network traffic appears.
- [ ] Reload and compare two natively supported files: `ffmpeg/*` is **not** requested at all
      (the module and the core load lazily).
- [ ] `h264.mkv` (or another file the browser cannot decode but ffmpeg handles): either it plays
      natively or it converts locally; either way no request leaves this origin.

**Static check (already run in this repo — rerun after touching `src/`)**

```bash
grep -rnE 'fetch|XMLHttpRequest|WebSocket|sendBeacon' src/
```

Expected: no call sites. The only matches are comments in `src/transcode.ts` containing the word
"fetched"; `XMLHttpRequest`, `WebSocket` and `sendBeacon` do not occur anywhere in the repository.
`URL.createObjectURL` / `revokeObjectURL` live only in `src/media.ts`, and the ffmpeg core is
resolved against `document.baseURI`, i.e. this origin.

---

## Sign-off

- [ ] All five sections pass in Chrome and in at least one other engine.
- [ ] `npm run typecheck && npm test && npm run build` is green on the same commit.
- [ ] `dist/` contains `index.html`, `assets/`, `favicon.svg`, `robots.txt`, `ffmpeg/`.
- [ ] The deployed URLs (Vercel and `https://gothmiku.github.io/comparitoer/`) behave like
      `npm run preview`, including the relative asset paths.
