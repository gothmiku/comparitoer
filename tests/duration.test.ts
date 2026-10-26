import { describe, expect, it } from 'vitest';

import {
  DEFAULT_DURATION_TOLERANCE_SECONDS,
  compareDurations,
  formatToleranceSeconds,
  isValidDuration,
  parseTolerance,
  timelineDuration,
} from '../src/logic/duration';

describe('isValidDuration', () => {
  it('accepts finite positive durations', () => {
    expect(isValidDuration(0.001)).toBe(true);
    expect(isValidDuration(10)).toBe(true);
    expect(isValidDuration(7200)).toBe(true);
  });

  it('rejects NaN, infinities, zero and negatives', () => {
    expect(isValidDuration(Number.NaN)).toBe(false);
    expect(isValidDuration(Number.POSITIVE_INFINITY)).toBe(false);
    expect(isValidDuration(Number.NEGATIVE_INFINITY)).toBe(false);
    expect(isValidDuration(0)).toBe(false);
    expect(isValidDuration(-1)).toBe(false);
  });
});

describe('compareDurations', () => {
  it('matches identical durations', () => {
    const result = compareDurations(10, 10);

    expect(result.status).toBe('match');
    expect(result.match).toBe(true);
    expect(result.deltaMs).toBe(0);
    expect(result.deltaSeconds).toBe(0);
    expect(result.longer).toBeNull();
    expect(result.clampTo).toBe(10);
    expect(result.toleranceSeconds).toBe(DEFAULT_DURATION_TOLERANCE_SECONDS);
  });

  describe('tolerance boundary', () => {
    it('matches a delta exactly at the tolerance', () => {
      const result = compareDurations(10, 10.05);

      expect(result.status).toBe('match');
      expect(result.match).toBe(true);
      expect(result.deltaMs).toBeCloseTo(50, 6);
      expect(result.longer).toBeNull();
      expect(result.clampTo).toBe(10);
    });

    it('matches a delta at the tolerance with binary-float noise', () => {
      // 1.3 - 1.2 === 0.10000000000000009, which must still count as "exactly 0.1".
      const result = compareDurations(1.2, 1.3, 0.1);

      expect(result.deltaSeconds).toBeGreaterThan(0.1);
      expect(result.match).toBe(true);
      expect(result.status).toBe('match');
    });

    it('reports a mismatch just past the tolerance', () => {
      const result = compareDurations(10, 10.051);

      expect(result.status).toBe('mismatch');
      expect(result.match).toBe(false);
      expect(result.longer).toBe('b');
      expect(result.deltaMs).toBeCloseTo(51, 6);
      expect(result.clampTo).toBe(10);
    });

    it('respects a custom tolerance', () => {
      expect(compareDurations(10, 11, 1).match).toBe(true);
      expect(compareDurations(10, 11.001, 1).match).toBe(false);
      expect(compareDurations(10, 10.001, 0).match).toBe(false);
      expect(compareDurations(10, 10, 0).match).toBe(true);
    });

    it('falls back to the default tolerance when the tolerance is unusable', () => {
      const nanTolerance = compareDurations(10, 10.05, Number.NaN);
      const negativeTolerance = compareDurations(10, 10.05, -1);
      const infiniteTolerance = compareDurations(10, 10.05, Number.POSITIVE_INFINITY);

      expect(nanTolerance.toleranceSeconds).toBe(DEFAULT_DURATION_TOLERANCE_SECONDS);
      expect(nanTolerance.match).toBe(true);
      expect(negativeTolerance.toleranceSeconds).toBe(DEFAULT_DURATION_TOLERANCE_SECONDS);
      expect(negativeTolerance.match).toBe(true);
      expect(infiniteTolerance.toleranceSeconds).toBe(DEFAULT_DURATION_TOLERANCE_SECONDS);
    });
  });

  describe('longer / clampTo', () => {
    it('names B as longer and clamps to A', () => {
      const result = compareDurations(10, 12);

      expect(result.longer).toBe('b');
      expect(result.clampTo).toBe(10);
      expect(result.deltaSeconds).toBe(2);
      expect(result.deltaMs).toBe(2000);
    });

    it('names A as longer and clamps to B', () => {
      const result = compareDurations(12.5, 10);

      expect(result.longer).toBe('a');
      expect(result.clampTo).toBe(10);
      expect(result.deltaMs).toBeCloseTo(2500, 6);
    });
  });

  describe('invalid input', () => {
    it('reports a NaN duration in A as invalid', () => {
      const result = compareDurations(Number.NaN, 10);

      expect(result.status).toBe('invalid');
      expect(result.match).toBe(false);
      expect(result.deltaSeconds).toBeNaN();
      expect(result.deltaMs).toBeNaN();
      expect(result.longer).toBeNull();
      expect(result.clampTo).toBeNaN();
      expect(result.durationA).toBeNaN();
      expect(result.durationB).toBe(10);
    });

    it('reports a NaN duration in B as invalid', () => {
      expect(compareDurations(10, Number.NaN).status).toBe('invalid');
    });

    it('reports infinite durations as invalid', () => {
      expect(compareDurations(Number.POSITIVE_INFINITY, 10).status).toBe('invalid');
      expect(compareDurations(10, Number.POSITIVE_INFINITY).status).toBe('invalid');
      expect(compareDurations(Number.NEGATIVE_INFINITY, Number.NEGATIVE_INFINITY).status).toBe(
        'invalid',
      );
    });

    it('reports non-positive durations as invalid', () => {
      expect(compareDurations(0, 0).status).toBe('invalid');
      expect(compareDurations(10, 0).status).toBe('invalid');
      expect(compareDurations(-5, 10).status).toBe('invalid');
    });

    it('keeps the tolerance it was given while reporting an invalid pair', () => {
      expect(compareDurations(Number.NaN, 10, 0.2).toleranceSeconds).toBe(0.2);
    });
  });

  describe('over one hour', () => {
    it('matches a sub-100 ms delta on an hour-long video', () => {
      const result = compareDurations(3600.5, 3600.54);

      expect(result.match).toBe(true);
      expect(result.deltaMs).toBeCloseTo(40, 6);
      expect(result.clampTo).toBe(3600.5);
      expect(result.longer).toBeNull();
    });

    it('reports a mismatch and the longer video past one hour', () => {
      const result = compareDurations(3661.25, 3661.4);

      expect(result.status).toBe('mismatch');
      expect(result.longer).toBe('b');
      expect(result.clampTo).toBe(3661.25);
      expect(result.deltaMs).toBeCloseTo(150, 6);
    });
  });

  it('returns a delta equal to the absolute difference of the durations', () => {
    const result = compareDurations(3661.25, 3661.4);

    expect(result.deltaSeconds).toBeCloseTo(Math.abs(3661.25 - 3661.4), 12);
  });
});

describe('timelineDuration', () => {
  it('returns the shorter duration', () => {
    expect(timelineDuration(10, 12)).toBe(10);
    expect(timelineDuration(12, 10)).toBe(10);
  });

  it('returns NaN when either duration is invalid', () => {
    expect(timelineDuration(Number.NaN, 10)).toBeNaN();
    expect(timelineDuration(10, Number.POSITIVE_INFINITY)).toBeNaN();
    expect(timelineDuration(0, 10)).toBeNaN();
  });
});

describe('parseTolerance', () => {
  it('parses plain and exponential notation', () => {
    expect(parseTolerance('0.05')).toBe(0.05);
    expect(parseTolerance('0')).toBe(0);
    expect(parseTolerance(' 0.1 ')).toBe(0.1);
    expect(parseTolerance('1e-3')).toBe(0.001);
    expect(parseTolerance('2.5')).toBe(2.5);
  });

  it('rejects blanks and non-numeric text', () => {
    expect(parseTolerance('')).toBeNull();
    expect(parseTolerance('   ')).toBeNull();
    expect(parseTolerance('abc')).toBeNull();
    expect(parseTolerance('0,05')).toBeNull();
  });

  it('rejects negative and non-finite values', () => {
    expect(parseTolerance('-0.05')).toBeNull();
    expect(parseTolerance('-1')).toBeNull();
    expect(parseTolerance('Infinity')).toBeNull();
    expect(parseTolerance('-Infinity')).toBeNull();
    expect(parseTolerance('NaN')).toBeNull();
  });
});

describe('formatToleranceSeconds', () => {
  it('renders the default without trailing zeros', () => {
    expect(formatToleranceSeconds(DEFAULT_DURATION_TOLERANCE_SECONDS)).toBe('0.05');
  });

  it('trims binary noise and trailing zeros', () => {
    expect(formatToleranceSeconds(0.5)).toBe('0.5');
    expect(formatToleranceSeconds(1)).toBe('1');
    expect(formatToleranceSeconds(0)).toBe('0');
    expect(formatToleranceSeconds(0.1 + 0.2)).toBe('0.3');
    expect(formatToleranceSeconds(0.05)).toBe('0.05');
  });
});
