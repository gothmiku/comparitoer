/**
 * Step-control math. Pure and DOM-free so the unit list, the labels and the clamping are
 * unit-tested rather than buried in click handlers.
 *
 * A step is always expressed as "one press of the arrow button": either one frame of the
 * displayed picture (using the estimated frame rate) or a fixed slice of time. The keyboard
 * keeps its documented behaviour — Left/Right is always one frame, Shift+Left/Right one second
 * — and the visible buttons follow whatever unit the user selected.
 */

import { FALLBACK_FPS, frameStepTarget } from './fps';

/** Units offered by the step control; `'frame'` means one frame of the estimated rate. */
export const STEP_UNITS = ['frame', 1, 5, 10] as const;

export type StepUnit = (typeof STEP_UNITS)[number];

/** Direction of a step: backwards or forwards. */
export type StepDirection = -1 | 1;

/** Label shown in the unit select. */
export type StepUnitLabeler = (unit: StepUnit) => string;

/** Seconds moved by one press, for a tooltip; NaN when the unit depends on an unknown rate. */
export type StepDeltaSeconds = (unit: StepUnit, fps: number | null) => number;

/** Where a step lands, clamped to the timeline. */
export type StepTarget = (
  currentSeconds: number,
  unit: StepUnit,
  direction: StepDirection,
  fps: number | null,
  limitSeconds: number,
) => number;

/** Action text for a button's `aria-label`, e.g. `Next frame` / `Back 5 s`. */
export type StepActionLabeler = (unit: StepUnit, direction: StepDirection) => string;

/** The frame rate actually used for a frame step: the estimate, or the fallback. */
function effectiveFps(fps: number | null): number {
  return fps !== null && Number.isFinite(fps) && fps > 0 ? fps : FALLBACK_FPS;
}

/** Human label for a unit: `Frame`, `1 s`, `5 s`, `10 s`. */
export const stepUnitLabel: StepUnitLabeler = (unit) => (unit === 'frame' ? 'Frame' : `${unit} s`);

/**
 * Seconds moved by one press. A frame unit uses the estimate (or the fallback), so the value
 * is always a usable number rather than a "depends" the caller has to handle.
 */
export const stepDeltaSeconds: StepDeltaSeconds = (unit, fps) =>
  unit === 'frame' ? 1 / effectiveFps(fps) : unit;

/**
 * Where one press lands.
 *
 * Frame steps reuse `frameStepTarget`, so stepping forward always shows the next frame and
 * stepping back always shows the previous one — even from the middle of a frame. Time steps
 * are a plain offset from the current playhead. Both ends of the timeline clamp: a step at
 * 00:00.000 stays at 0, a step at the end stays at the end.
 */
export const stepTarget: StepTarget = (currentSeconds, unit, direction, fps, limitSeconds) => {
  if (!Number.isFinite(currentSeconds)) {
    return 0;
  }

  const raw =
    unit === 'frame'
      ? frameStepTarget(currentSeconds, direction, effectiveFps(fps))
      : currentSeconds + direction * unit;

  const upper =
    Number.isFinite(limitSeconds) && limitSeconds > 0 ? limitSeconds : Number.POSITIVE_INFINITY;

  return Math.min(Math.max(raw, 0), upper);
};

/** `Previous frame` / `Next frame` / `Back 5 s` / `Forward 1 s`, for `aria-label`s. */
export const stepActionLabel: StepActionLabeler = (unit, direction) => {
  const backward = direction === -1;

  if (unit === 'frame') {
    return backward ? 'Previous frame' : 'Next frame';
  }

  return backward ? `Back ${unit} s` : `Forward ${unit} s`;
};

/** Unit value as it travels through a `<select>` value. */
export function formatStepUnitValue(unit: StepUnit): string {
  return String(unit);
}

/** Parses a `<select>` value back into a unit; `null` when it is not one of STEP_UNITS. */
export function parseStepUnit(value: string | undefined): StepUnit | null {
  if (value === 'frame') {
    return 'frame';
  }

  const parsed = Number(value);

  return STEP_UNITS.find((unit) => unit === parsed) ?? null;
}
