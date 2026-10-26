/**
 * Divider math. Pure and DOM-free so every rule from the spec (1 % arrows, 10 %
 * with Shift, Home/End, clamping) is unit-testable without a browser.
 */

/** Left end of the divider track, in percent. */
export const WIPE_MIN_PERCENT = 0;

/** Right end of the divider track, in percent. */
export const WIPE_MAX_PERCENT = 100;

/** Divider position before the user moves it, in percent. */
export const WIPE_DEFAULT_PERCENT = 50;

/** Arrow-key step, in percent. */
export const WIPE_STEP_PERCENT = 1;

/** Shift + Arrow step, in percent. */
export const WIPE_STEP_LARGE_PERCENT = 10;

/** Two decimals keep `aria-valuenow` and the clip-path stable under float noise. */
const POSITION_PRECISION = 2;

/** Clamps any input into 0-100; non-finite input falls back to the default position. */
export type WipeClamper = (position: number) => number;

/** Maps a 0-1 pointer ratio across the stage onto a divider percent. */
export type WipePositionFromRatio = (ratio: number) => number;

/** Returns the next position for a key press, or null when the key is not handled. */
export type WipeKeyHandler = (position: number, key: string, shiftKey: boolean) => number | null;

function roundPosition(value: number): number {
  const factor = 10 ** POSITION_PRECISION;

  return Math.round(value * factor) / factor;
}

function clampToTrack(value: number): number {
  if (!Number.isFinite(value)) {
    return WIPE_DEFAULT_PERCENT;
  }

  return roundPosition(Math.min(WIPE_MAX_PERCENT, Math.max(WIPE_MIN_PERCENT, value)));
}

/** Clamps a divider position to the track, so callers never have to pre-check it. */
export const clampWipePosition: WipeClamper = (position) => clampToTrack(position);

/**
 * Converts `(clientX - left) / width` into a divider position. A pointer left of the
 * stage sits at 0 %, right of it at 100 %; a zero-width stage (not laid out yet) keeps
 * the default instead of producing NaN.
 */
export const positionFromRatio: WipePositionFromRatio = (ratio) =>
  Number.isFinite(ratio) ? clampToTrack(ratio * WIPE_MAX_PERCENT) : WIPE_DEFAULT_PERCENT;

/**
 * ArrowLeft/ArrowRight move by {@link WIPE_STEP_PERCENT}, or
 * {@link WIPE_STEP_LARGE_PERCENT} with Shift; Home/End jump to the ends.
 * Any other key returns null so the caller can leave the event alone.
 */
export const applyWipeKey: WipeKeyHandler = (position, key, shiftKey) => {
  const step = shiftKey ? WIPE_STEP_LARGE_PERCENT : WIPE_STEP_PERCENT;
  const current = clampWipePosition(position);

  switch (key) {
    case 'ArrowLeft':
      return clampWipePosition(current - step);
    case 'ArrowRight':
      return clampWipePosition(current + step);
    case 'Home':
      return WIPE_MIN_PERCENT;
    case 'End':
      return WIPE_MAX_PERCENT;
    default:
      return null;
  }
};
