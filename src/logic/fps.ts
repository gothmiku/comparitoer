/** Frame rate assumed for frame stepping before any rVFC sample exists. */
export const FALLBACK_FPS = 30;

/** Relative FPS difference above which the info bar shows its informational chip. */
export const FPS_WARNING_RATIO = 0.01;

/** Result of sampling `mediaTime` deltas from requestVideoFrameCallback. */
export interface FpsEstimate {
  readonly fps: number;
  readonly sampleCount: number;
}

/** Estimates fps from consecutive mediaTime values; null while there is no usable sample. */
export type FpsEstimator = (mediaTimes: readonly number[]) => FpsEstimate | null;

/** Frame index displayed in the counter: floor(seconds * fps). */
export type FrameIndexAt = (seconds: number, fps: number) => number;

/** Frame-step target: snaps a time to the nearest frame boundary of the given fps. */
export type SnapToFrame = (seconds: number, fps: number) => number;

/** True when the two estimates differ by more than FPS_WARNING_RATIO; both must be known. */
export type FpsDiffer = (fpsA: number | null, fpsB: number | null) => boolean;

/** What the frame counter shows until a rate has been estimated. */
export const UNKNOWN_FRAME_TEXT = '—';

/** Sample count below which an estimate is too noisy to show. */
export const MIN_FPS_SAMPLE_COUNT = 8;

/** Frame rates outside this range are not plausible; their deltas are treated as outliers. */
export const MIN_PLAUSIBLE_FPS = 5;

export const MAX_PLAUSIBLE_FPS = 240;

/** Largest delta still counted as one frame: below 1/240 s a duplicate sample was delivered. */
const MIN_FRAME_SECONDS = 1 / MAX_PLAUSIBLE_FPS;

/** Smallest delta still counted as one frame: above 1/5 s a seek or a stall produced it. */
const MAX_FRAME_SECONDS = 1 / MIN_PLAUSIBLE_FPS;

/**
 * Slack in *frame* units so a playhead that seeked to 44/30 s and came back as
 * 43.99998 frames still counts as frame 44. A thousandth of a frame is 33 µs at 30 fps:
 * far below anything visible, far above double-rounding noise.
 */
const FRAME_EPSILON = 1e-3;

/**
 * Compares two frame rates relative to the faster one, so a 1 % chip threshold means the
 * same thing at 24 fps and at 120 fps. A missing or unusable estimate is never a warning:
 * the app does not know, so it stays quiet.
 */
export const fpsDiffer: FpsDiffer = (fpsA, fpsB) => {
  if (fpsA === null || fpsB === null) {
    return false;
  }

  if (!Number.isFinite(fpsA) || !Number.isFinite(fpsB) || fpsA <= 0 || fpsB <= 0) {
    return false;
  }

  const fastest = Math.max(fpsA, fpsB);

  return Math.abs(fpsA - fpsB) > fastest * FPS_WARNING_RATIO;
};

/**
 * Estimates the frame rate from consecutive `mediaTime` values.
 *
 * Only plausible single-frame deltas are kept (1/240 s … 1/5 s), then the **median** delta
 * is inverted. The median matters: a dropped frame, a seek or a loop produces one huge
 * delta, and a mean would drag the estimate far away from the real rate, while the median
 * simply ignores it. `null` until there are enough samples to be honest about it.
 */
export const estimateFps: FpsEstimator = (mediaTimes) => {
  const deltas: number[] = [];

  for (let index = 1; index < mediaTimes.length; index += 1) {
    const previous = mediaTimes[index - 1];
    const current = mediaTimes[index];

    if (previous === undefined || current === undefined) {
      continue;
    }

    if (!Number.isFinite(previous) || !Number.isFinite(current)) {
      continue;
    }

    const delta = current - previous;

    if (delta < MIN_FRAME_SECONDS || delta > MAX_FRAME_SECONDS) {
      continue;
    }

    deltas.push(delta);
  }

  if (deltas.length < MIN_FPS_SAMPLE_COUNT) {
    return null;
  }

  deltas.sort((left, right) => left - right);

  const middle = Math.floor(deltas.length / 2);
  const lower = deltas[middle] ?? Number.NaN;
  const upper = deltas[middle - 1] ?? lower;
  const median = deltas.length % 2 === 0 ? (upper + lower) / 2 : lower;
  const fps = 1 / median;

  if (!Number.isFinite(fps) || fps <= 0) {
    return null;
  }

  return { fps: Number(fps.toFixed(3)), sampleCount: deltas.length };
};

/** Index of the frame *shown* at `seconds`: the last boundary at or before the playhead. */
export const frameIndexAt: FrameIndexAt = (seconds, fps) => {
  if (!Number.isFinite(seconds) || !Number.isFinite(fps) || fps <= 0) {
    return 0;
  }

  return Math.max(0, Math.floor(seconds * fps + FRAME_EPSILON));
};

/** Nearest frame boundary, used when snapping without stepping. */
export const snapToFrame: SnapToFrame = (seconds, fps) => {
  if (!Number.isFinite(seconds) || !Number.isFinite(fps) || fps <= 0) {
    return seconds;
  }

  return Math.round(seconds * fps) / fps;
};

/**
 * Target time for a frame step. Stepping is expressed in *frames of the displayed picture*,
 * so it starts from `frameIndexAt` and moves `frames` whole steps from there:
 * forward always shows the next frame, backward always shows the previous one, no matter
 * whether the playhead sits on a boundary or in the middle of a frame.
 */
export function frameStepTarget(seconds: number, frames: number, fps: number): number {
  if (!Number.isFinite(seconds) || !Number.isFinite(frames) || frames === 0) {
    return seconds;
  }

  if (!Number.isFinite(fps) || fps <= 0) {
    return seconds;
  }

  const target = (frameIndexAt(seconds, fps) + frames) / fps;

  return Math.max(0, target);
}

/**
 * `Frame 123`, or `Frame —` until a rate has been estimated. Showing a number derived from
 * the 30 fps fallback would be a guess presented as a fact.
 */
export function formatFrameCounter(frame: number | null): string {
  if (frame === null || !Number.isFinite(frame) || frame < 0) {
    return `Frame ${UNKNOWN_FRAME_TEXT}`;
  }

  return `Frame ${Math.floor(frame)}`;
}
