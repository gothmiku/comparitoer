import { describe, expect, it } from 'vitest';

import { FALLBACK_FPS } from '../src/logic/fps';
import {
  formatStepUnitValue,
  parseStepUnit,
  STEP_UNITS,
  stepActionLabel,
  stepDeltaSeconds,
  stepTarget,
  stepUnitLabel,
} from '../src/logic/step';
import { createInitialState } from '../src/state';

describe('step units', () => {
  it('offers one frame plus 1, 5 and 10 seconds', () => {
    expect(STEP_UNITS).toEqual(['frame', 1, 5, 10]);
  });

  it('labels each unit', () => {
    expect(stepUnitLabel('frame')).toBe('Frame');
    expect(stepUnitLabel(1)).toBe('1 s');
    expect(stepUnitLabel(5)).toBe('5 s');
    expect(stepUnitLabel(10)).toBe('10 s');
  });

  it('round-trips through a select value', () => {
    for (const unit of STEP_UNITS) {
      expect(parseStepUnit(formatStepUnitValue(unit))).toBe(unit);
    }
  });

  it('rejects anything that is not a unit', () => {
    expect(parseStepUnit(undefined)).toBeNull();
    expect(parseStepUnit('')).toBeNull();
    expect(parseStepUnit('2')).toBeNull();
    expect(parseStepUnit('-1')).toBeNull();
    expect(parseStepUnit('frames')).toBeNull();
    expect(parseStepUnit('Infinity')).toBeNull();
  });
});

describe('stepDeltaSeconds', () => {
  it('turns a time unit into its own length', () => {
    expect(stepDeltaSeconds(1, 30)).toBe(1);
    expect(stepDeltaSeconds(5, null)).toBe(5);
    expect(stepDeltaSeconds(10, 24)).toBe(10);
  });

  it('uses one frame of the estimate, or the fallback when there is none', () => {
    expect(stepDeltaSeconds('frame', 30)).toBeCloseTo(1 / 30, 10);
    expect(stepDeltaSeconds('frame', 60)).toBeCloseTo(1 / 60, 10);
    expect(stepDeltaSeconds('frame', null)).toBeCloseTo(1 / FALLBACK_FPS, 10);
    expect(stepDeltaSeconds('frame', 0)).toBeCloseTo(1 / FALLBACK_FPS, 10);
    expect(stepDeltaSeconds('frame', Number.NaN)).toBeCloseTo(1 / FALLBACK_FPS, 10);
  });

  it('ignores an implausible estimate instead of dividing by it', () => {
    expect(stepDeltaSeconds('frame', -30)).toBeCloseTo(1 / FALLBACK_FPS, 10);
    expect(stepDeltaSeconds('frame', Number.POSITIVE_INFINITY)).toBeCloseTo(
      1 / FALLBACK_FPS,
      10,
    );
  });
});

describe('stepActionLabel', () => {
  it('names the frame and time steps per direction', () => {
    expect(stepActionLabel('frame', -1)).toBe('Previous frame');
    expect(stepActionLabel('frame', 1)).toBe('Next frame');
    expect(stepActionLabel(1, -1)).toBe('Back 1 s');
    expect(stepActionLabel(1, 1)).toBe('Forward 1 s');
    expect(stepActionLabel(10, -1)).toBe('Back 10 s');
    expect(stepActionLabel(10, 1)).toBe('Forward 10 s');
  });
});

describe('stepTarget', () => {
  it('moves by whole frames using the estimate', () => {
    expect(stepTarget(0, 'frame', 1, 30, 10)).toBeCloseTo(1 / 30, 10);
    expect(stepTarget(1, 'frame', 1, 30, 10)).toBeCloseTo(31 / 30, 10);
    expect(stepTarget(1, 'frame', -1, 30, 10)).toBeCloseTo(29 / 30, 10);
  });

  it('steps forward from the middle of a frame to the next boundary', () => {
    // 0.5 frame at 30 fps: forward must show frame 1, not frame 0 again.
    expect(stepTarget(0.5 / 30, 'frame', 1, 30, 10)).toBeCloseTo(1 / 30, 10);
    // Backwards from the same spot must show frame 0, never a negative time.
    expect(stepTarget(0.5 / 30, 'frame', -1, 30, 10)).toBe(0);
  });

  it('moves by the selected time unit in both directions', () => {
    expect(stepTarget(10, 1, 1, 30, 100)).toBe(11);
    expect(stepTarget(10, 1, -1, 30, 100)).toBe(9);
    expect(stepTarget(10, 5, 1, 30, 100)).toBe(15);
    expect(stepTarget(10, 10, -1, 30, 100)).toBe(0);
  });

  it('clamps at the start of the timeline', () => {
    expect(stepTarget(0, 5, -1, 30, 100)).toBe(0);
    expect(stepTarget(2, 5, -1, 30, 100)).toBe(0);
    expect(stepTarget(0, 'frame', -1, 30, 100)).toBe(0);
  });

  it('clamps at the end of the timeline', () => {
    expect(stepTarget(99, 5, 1, 30, 100)).toBe(100);
    expect(stepTarget(100, 1, 1, 30, 100)).toBe(100);
    expect(stepTarget(100, 'frame', 1, 30, 100)).toBe(100);
  });

  it('treats an unknown or unusable limit as unbounded', () => {
    expect(stepTarget(10, 1, 1, 30, Number.NaN)).toBe(11);
    expect(stepTarget(10, 1, 1, 30, 0)).toBe(11);
    expect(stepTarget(10, 1, 1, 30, Number.POSITIVE_INFINITY)).toBe(11);
  });

  it('falls back to 0 for a non-finite playhead', () => {
    expect(stepTarget(Number.NaN, 1, 1, 30, 100)).toBe(0);
  });

  it('uses the fallback rate when the estimate is missing', () => {
    expect(stepTarget(0, 'frame', 1, null, 10)).toBeCloseTo(1 / FALLBACK_FPS, 10);
  });
});

describe('initial state', () => {
  it('starts with the frame unit, matching the arrow keys', () => {
    expect(createInitialState().settings.stepUnit).toBe('frame');
  });

  it('accepts a unit override', () => {
    expect(createInitialState({ stepUnit: 5 }).settings.stepUnit).toBe(5);
  });
});
