import type { SlotId } from '../state';

/** Default allowed difference between the two durations, in seconds. */
export const DEFAULT_DURATION_TOLERANCE_SECONDS = 0.05;

/**
 * Guard against binary floating-point noise at the tolerance boundary: `1.3 - 1.2`
 * evaluates to `0.10000000000000009`, which must still count as exactly 0.1 over.
 */
const TOLERANCE_EPSILON = 1e-9;

/**
 * `pending` until both metadata events fired, then a verdict or an error state.
 * `pending` is UI state, so {@link compareDurations} never returns it.
 */
export type DurationStatus = 'pending' | 'match' | 'mismatch' | 'invalid';

/** Status returned by {@link compareDurations}: everything except `pending`. */
export type DurationVerdict = Exclude<DurationStatus, 'pending'>;

/** Result of comparing the two durations; the UI renders it verbatim. */
export interface DurationCheck {
  readonly status: DurationVerdict;
  /** True only when both durations are valid and inside the tolerance. */
  readonly match: boolean;
  readonly durationA: number;
  readonly durationB: number;
  /** Absolute difference in seconds; NaN when a duration is invalid. */
  readonly deltaSeconds: number;
  /** Absolute difference in milliseconds; NaN when a duration is invalid. */
  readonly deltaMs: number;
  /** Which video is longer; null on a match or when a duration is invalid. */
  readonly longer: SlotId | null;
  /** Timeline length used by "Compare anyway": the shorter duration, or NaN when invalid. */
  readonly clampTo: number;
  readonly toleranceSeconds: number;
}

/** True only for finite, positive durations; NaN and Infinity are the error state. */
export type DurationGuard = (duration: number) => boolean;

/** Compares two durations against the tolerance. Never blocks playback. */
export type DurationChecker = (
  durationA: number,
  durationB: number,
  toleranceSeconds?: number,
) => DurationCheck;

/** Timeline length: the shorter duration, or NaN when either duration is invalid. */
export type TimelineDuration = (durationA: number, durationB: number) => number;

/** True only for finite, positive durations; NaN, infinities, 0 and negatives are invalid. */
export const isValidDuration: DurationGuard = (duration) =>
  Number.isFinite(duration) && duration > 0;

/**
 * Compares the two durations and reports whether they match within the tolerance.
 *
 * - The comparison is `<=`, so a delta exactly at the tolerance is a match.
 * - An invalid tolerance (NaN, negative, infinite) falls back to
 *   {@link DEFAULT_DURATION_TOLERANCE_SECONDS}.
 * - Invalid durations (NaN, ±Infinity, 0, negative) yield `status: 'invalid'`,
 *   `deltaMs: NaN` and `clampTo: NaN`, which the UI shows as an error instead of
 *   a mismatch.
 * - A mismatch never blocks playback; it carries `longer` and `clampTo` so the UI
 *   can offer "Compare anyway" using the shorter video.
 */
export const compareDurations: DurationChecker = (
  durationA,
  durationB,
  toleranceSeconds = DEFAULT_DURATION_TOLERANCE_SECONDS,
) => {
  const tolerance =
    Number.isFinite(toleranceSeconds) && toleranceSeconds >= 0
      ? toleranceSeconds
      : DEFAULT_DURATION_TOLERANCE_SECONDS;

  if (!isValidDuration(durationA) || !isValidDuration(durationB)) {
    return {
      status: 'invalid',
      match: false,
      durationA,
      durationB,
      deltaSeconds: Number.NaN,
      deltaMs: Number.NaN,
      longer: null,
      clampTo: Number.NaN,
      toleranceSeconds: tolerance,
    };
  }

  const deltaSeconds = Math.abs(durationA - durationB);
  const match = deltaSeconds <= tolerance + TOLERANCE_EPSILON;
  const longer: SlotId | null = match ? null : durationA > durationB ? 'a' : 'b';

  return {
    status: match ? 'match' : 'mismatch',
    match,
    durationA,
    durationB,
    deltaSeconds,
    deltaMs: deltaSeconds * 1000,
    longer,
    clampTo: Math.min(durationA, durationB),
    toleranceSeconds: tolerance,
  };
};

/** Timeline length used by the scrubber: min(A, B), or NaN when either is invalid. */
export const timelineDuration: TimelineDuration = (durationA, durationB) =>
  isValidDuration(durationA) && isValidDuration(durationB)
    ? Math.min(durationA, durationB)
    : Number.NaN;

/** Parses the tolerance field; null when the text is not a usable number of seconds. */
export type ToleranceParser = (raw: string) => number | null;

/** Message shown when the tolerance field holds something unusable. */
export const TOLERANCE_ERROR_TEXT = 'Enter a number of seconds, 0 or greater.';

/**
 * Accepts plain and exponential notation (`0.05`, `1e-3`), rejects blanks, negatives,
 * infinities and non-numeric text. Zero is valid: it demands an exact match.
 */
export const parseTolerance: ToleranceParser = (raw) => {
  const text = raw.trim();

  if (text.length === 0) {
    return null;
  }

  const value = Number(text);

  if (!Number.isFinite(value) || value < 0) {
    return null;
  }

  return value;
};

/** Trims binary noise and trailing zeros: `0.05` → "0.05", `0.5` → "0.5", `0` → "0". */
export function formatToleranceSeconds(seconds: number): string {
  return String(Number(seconds.toFixed(4)));
}
