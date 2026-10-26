import { describe, expect, it } from 'vitest';

import { INVALID_TIME_TEXT, formatTime, splitTime } from '../src/logic/format';

describe('formatTime', () => {
  it('formats zero as mm:ss.mmm', () => {
    expect(formatTime(0)).toBe('00:00.000');
  });

  it('pads every component', () => {
    expect(formatTime(1.5)).toBe('00:01.500');
    expect(formatTime(61.5)).toBe('01:01.500');
    expect(formatTime(5025.04)).toBe('01:23:45.040');
  });

  it('formats sub-second durations and rounds to whole milliseconds', () => {
    expect(formatTime(0.001)).toBe('00:00.001');
    expect(formatTime(0.0004)).toBe('00:00.000');
    expect(formatTime(0.0005)).toBe('00:00.001');
    expect(formatTime(59.999)).toBe('00:59.999');
    expect(formatTime(7265.04)).toBe('02:01:05.040');
  });

  it('carries rounded milliseconds into the next second and minute', () => {
    expect(formatTime(59.9996)).toBe('01:00.000');
    expect(formatTime(3599.9996)).toBe('01:00:00.000');
  });

  it('clamps negative input to zero', () => {
    expect(formatTime(-0.5)).toBe('00:00.000');
    expect(formatTime(-3600)).toBe('00:00.000');
  });

  it('renders non-finite input as the invalid placeholder', () => {
    expect(formatTime(Number.NaN)).toBe(INVALID_TIME_TEXT);
    expect(formatTime(Number.POSITIVE_INFINITY)).toBe(INVALID_TIME_TEXT);
    expect(formatTime(Number.NEGATIVE_INFINITY)).toBe(INVALID_TIME_TEXT);
    expect(INVALID_TIME_TEXT).toBe('--:--.---');
  });

  describe('over one hour', () => {
    it('switches to hh:mm:ss.mmm exactly at one hour', () => {
      expect(formatTime(3600)).toBe('01:00:00.000');
    });

    it('formats durations well past one hour', () => {
      expect(formatTime(3600.25)).toBe('01:00:00.250');
      expect(formatTime(3725.5)).toBe('01:02:05.500');
      expect(formatTime(36000)).toBe('10:00:00.000');
      expect(formatTime(360000)).toBe('100:00:00.000');
    });

    it('keeps minutes under sixty when the remainder is large', () => {
      expect(formatTime(86399.999)).toBe('23:59:59.999');
    });
  });

  describe('splitTime', () => {
    it('splits whole-millisecond components', () => {
      expect(splitTime(3725.5)).toEqual({
        hours: 1,
        minutes: 2,
        seconds: 5,
        milliseconds: 500,
      });
      expect(splitTime(0)).toEqual({
        hours: 0,
        minutes: 0,
        seconds: 0,
        milliseconds: 0,
      });
    });

    it('applies rounding carries before splitting', () => {
      expect(splitTime(59.9996)).toEqual({
        hours: 0,
        minutes: 1,
        seconds: 0,
        milliseconds: 0,
      });
    });

    it('returns zeroed parts for invalid and negative input', () => {
      const zeroParts = { hours: 0, minutes: 0, seconds: 0, milliseconds: 0 };

      expect(splitTime(Number.NaN)).toEqual(zeroParts);
      expect(splitTime(Number.POSITIVE_INFINITY)).toEqual(zeroParts);
      expect(splitTime(-42)).toEqual(zeroParts);
    });

    it('never produces negative or fractional parts', () => {
      const parts = splitTime(-0.0001);

      expect(parts.milliseconds).toBe(0);
      expect(Object.is(parts.milliseconds, -0)).toBe(false);
    });
  });
});
