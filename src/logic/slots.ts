/**
 * Per-slot transport math for independent mode. Pure and DOM-free.
 *
 * In linked mode there is one playhead and one timeline (`min(durationA, durationB)`). In
 * independent mode each video owns a playhead and is clamped to *its own* duration — clamping B
 * to the shorter file's length would make the longer video unreachable, which is exactly what
 * independent mode exists to inspect.
 *
 * The frame stepping itself is the same function the linked path uses (`frameStepTarget`), so a
 * step shows the same picture in both modes.
 */

import { FALLBACK_FPS, frameStepTarget } from './fps';

/** Distance from a slot's own end, in seconds, that counts as finished. */
export const SLOT_END_EPSILON_SECONDS = 0.005;

/** A slot's usable length: its own duration, or +Infinity while it is unknown. */
export function slotLimit(durationSeconds: number): number {
  return Number.isFinite(durationSeconds) && durationSeconds > 0
    ? durationSeconds
    : Number.POSITIVE_INFINITY;
}

/** Clamps a time to `[0, duration]`; NaN becomes 0 and an unknown duration does not clamp. */
export function clampSlotTime(seconds: number, durationSeconds: number): number {
  // `+Infinity` is a legitimate "past the end" request from a scrubber, so it clamps to the
  // limit; NaN (a value that never existed) and `-Infinity` collapse to the start.
  const safe = Number.isFinite(seconds)
    ? Math.max(seconds, 0)
    : seconds > 0
      ? Number.POSITIVE_INFINITY
      : 0;

  return Math.min(safe, slotLimit(durationSeconds));
}

/** True when the playhead sits at (or within a few milliseconds of) the slot's end. */
export function slotAtEnd(currentSeconds: number, durationSeconds: number): boolean {
  if (!Number.isFinite(durationSeconds) || durationSeconds <= 0) {
    return false;
  }

  return currentSeconds >= durationSeconds - SLOT_END_EPSILON_SECONDS;
}

/**
 * Where a slot starts when Play is pressed. A slot parked on its last frame starts over
 * instead of sitting there doing nothing — the same rule the linked transport uses.
 */
export function slotPlayStart(currentSeconds: number, durationSeconds: number): number {
  if (!Number.isFinite(currentSeconds) || currentSeconds < 0) {
    return 0;
  }

  return slotAtEnd(currentSeconds, durationSeconds) ? 0 : currentSeconds;
}

/**
 * Target time for one frame step on one slot, clamped to that slot's own length.
 *
 * `fps` is the slot's own estimate; the 30 fps fallback is used until a sample exists, matching
 * the linked Step control.
 */
export function slotStepTarget(
  currentSeconds: number,
  frames: number,
  fps: number | null,
  durationSeconds: number,
): number {
  const rate = fps !== null && Number.isFinite(fps) && fps > 0 ? fps : FALLBACK_FPS;
  const target = frameStepTarget(currentSeconds, frames, rate);

  return clampSlotTime(target, durationSeconds);
}
