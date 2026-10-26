/** Components of a timestamp, before zero-padding. */
export interface TimeParts {
  readonly hours: number;
  readonly minutes: number;
  readonly seconds: number;
  readonly milliseconds: number;
}

/** `mm:ss.mmm`, switching to `hh:mm:ss.mmm` from one hour upward. */
export type TimeFormatter = (totalSeconds: number) => string;

/** Splits a timestamp in seconds into display components, rounded to whole milliseconds. */
export type TimeSplitter = (totalSeconds: number) => TimeParts;

/** Shown instead of a timestamp while a duration is NaN or infinite. */
export const INVALID_TIME_TEXT = '--:--.---';

const MILLISECONDS_PER_SECOND = 1000;
const SECONDS_PER_MINUTE = 60;
const SECONDS_PER_HOUR = 3600;

function pad(value: number, width: number): string {
  return String(value).padStart(width, '0');
}

/**
 * Splits a timestamp into whole-millisecond components.
 *
 * The value is rounded to milliseconds *before* splitting, so carries happen in the
 * arithmetic rather than the formatting (`59.9996` becomes `01:00.000`, never
 * `00:60.000`). Negative input clamps to zero; NaN and infinities yield all zeros.
 */
export function splitTime(totalSeconds: number): TimeParts {
  const safeSeconds = Number.isFinite(totalSeconds) ? Math.max(totalSeconds, 0) : 0;
  const totalMilliseconds = Math.round(safeSeconds * MILLISECONDS_PER_SECOND);
  const wholeSeconds = Math.floor(totalMilliseconds / MILLISECONDS_PER_SECOND);
  const milliseconds = totalMilliseconds - wholeSeconds * MILLISECONDS_PER_SECOND;

  return {
    hours: Math.floor(wholeSeconds / SECONDS_PER_HOUR),
    minutes: Math.floor((wholeSeconds % SECONDS_PER_HOUR) / SECONDS_PER_MINUTE),
    seconds: wholeSeconds % SECONDS_PER_MINUTE,
    milliseconds,
  };
}

/**
 * Formats a timestamp as `mm:ss.mmm`, or `hh:mm:ss.mmm` once it reaches an hour.
 * Non-finite input (NaN, Infinity, -Infinity) renders as {@link INVALID_TIME_TEXT}.
 */
export const formatTime: TimeFormatter = (totalSeconds) => {
  if (!Number.isFinite(totalSeconds)) {
    return INVALID_TIME_TEXT;
  }

  const { hours, minutes, seconds, milliseconds } = splitTime(totalSeconds);
  const timeOfDay = `${pad(minutes, 2)}:${pad(seconds, 2)}.${pad(milliseconds, 3)}`;

  return hours > 0 ? `${pad(hours, 2)}:${timeOfDay}` : timeOfDay;
};
