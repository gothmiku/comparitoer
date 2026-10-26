import { describe, expect, it } from 'vitest';

import {
  estimateFps,
  FALLBACK_FPS,
  formatFrameCounter,
  FPS_WARNING_RATIO,
  fpsDiffer,
  frameIndexAt,
  frameStepTarget,
  MIN_FPS_SAMPLE_COUNT,
  snapToFrame,
} from '../src/logic/fps';

/** Builds `count` mediaTime samples at a steady rate. */
function samplesAt(fps: number, count: number, start = 0): number[] {
  return Array.from({ length: count }, (_, index) => start + index / fps);
}

describe('fps constants', () => {
  it('matches the spec', () => {
    expect(FALLBACK_FPS).toBe(30);
    expect(FPS_WARNING_RATIO).toBe(0.01);
  });
});

describe('fpsDiffer', () => {
  it('reports clearly different frame rates', () => {
    expect(fpsDiffer(30, 24)).toBe(true);
    expect(fpsDiffer(24, 60)).toBe(true);
    expect(fpsDiffer(23.976, 30)).toBe(true);
    expect(fpsDiffer(30, 60)).toBe(true);
  });

  it('stays quiet for equal estimates', () => {
    expect(fpsDiffer(30, 30)).toBe(false);
    expect(fpsDiffer(23.976, 23.976)).toBe(false);
    expect(fpsDiffer(59.94, 59.94)).toBe(false);
  });

  it('uses a 1 % relative threshold', () => {
    // 30 vs 30.2 is 0.66 % of the faster rate: inside the tolerance.
    expect(fpsDiffer(30, 30.2)).toBe(false);
    // 30 vs 30.4 is 1.32 %: outside it.
    expect(fpsDiffer(30, 30.4)).toBe(true);
    // The threshold is relative, not absolute: 2 fps apart at 120 fps is 1.67 %.
    expect(fpsDiffer(120, 118)).toBe(true);
    expect(fpsDiffer(120, 119)).toBe(false);
  });

  it('never warns while an estimate is missing', () => {
    expect(fpsDiffer(null, 30)).toBe(false);
    expect(fpsDiffer(30, null)).toBe(false);
    expect(fpsDiffer(null, null)).toBe(false);
  });

  it('ignores unusable estimates instead of dividing by zero', () => {
    expect(fpsDiffer(0, 30)).toBe(false);
    expect(fpsDiffer(30, 0)).toBe(false);
    expect(fpsDiffer(-30, 30)).toBe(false);
    expect(fpsDiffer(Number.NaN, 30)).toBe(false);
    expect(fpsDiffer(30, Number.POSITIVE_INFINITY)).toBe(false);
  });
});

describe('estimateFps', () => {
  it('recovers the frame rate from steady mediaTime deltas', () => {
    expect(estimateFps(samplesAt(30, 20))?.fps).toBeCloseTo(30, 3);
    expect(estimateFps(samplesAt(24, 20))?.fps).toBeCloseTo(24, 3);
    expect(estimateFps(samplesAt(60, 20))?.fps).toBeCloseTo(60, 3);
    expect(estimateFps(samplesAt(23.976, 40))?.fps).toBeCloseTo(23.976, 2);
  });

  it('reports how many deltas the estimate is based on', () => {
    const estimate = estimateFps(samplesAt(30, 20));

    expect(estimate?.sampleCount).toBe(19);
  });

  it('stays null until enough samples exist', () => {
    // Two mediaTimes make one delta; the minimum is MIN_FPS_SAMPLE_COUNT deltas.
    expect(estimateFps([])).toBeNull();
    expect(estimateFps([0])).toBeNull();
    expect(estimateFps(samplesAt(30, MIN_FPS_SAMPLE_COUNT))).toBeNull();
    expect(estimateFps(samplesAt(30, MIN_FPS_SAMPLE_COUNT + 1))).not.toBeNull();
  });

  it('tolerates jitter around the real rate', () => {
    // Every frame arrives 0.5 ms late or early, as a real decoder with a rounded timer does.
    const jittered = [0];

    for (let index = 1; index <= 9; index += 1) {
      jittered.push(index / 30 + (index % 2 === 0 ? 0.0005 : -0.0005));
    }

    expect(Math.abs((estimateFps(jittered)?.fps ?? 0) - 30)).toBeLessThan(0.5);
  });

  it('drops the jump a seek or a loop produces', () => {
    const withSeek = [...samplesAt(30, 10), 5 + 1 / 30, 5 + 2 / 30, 5 + 3 / 30, 5 + 4 / 30];

    expect(estimateFps(withSeek)?.fps).toBeCloseTo(30, 3);
  });

  it('ignores duplicate and non-finite samples', () => {
    const noisy = [
      Number.NaN,
      0,
      0,
      1 / 30,
      1 / 30,
      2 / 30,
      Number.POSITIVE_INFINITY,
      3 / 30,
      4 / 30,
      5 / 30,
      6 / 30,
      7 / 30,
      8 / 30,
      9 / 30,
    ];
    const estimate = estimateFps(noisy);

    expect(estimate?.fps).toBeCloseTo(30, 3);
    // The list above leaves exactly eight usable deltas: the duplicates, the NaN and the
    // Infinity sample each break one delta.
    expect(estimate?.sampleCount).toBe(8);
  });

  it('never claims a rate below 5 fps or above 240 fps', () => {
    // A 2 fps "rate" is a stall, not a frame rate: too few usable deltas remain.
    expect(estimateFps(samplesAt(2, 20))).toBeNull();
    // 1000 fps deltas are duplicates of the frame timer, not frames.
    expect(estimateFps(samplesAt(1000, 20))).toBeNull();
  });
});

describe('frameIndexAt', () => {
  it('counts frames from zero at the boundaries', () => {
    expect(frameIndexAt(0, 30)).toBe(0);
    expect(frameIndexAt(1 / 30, 30)).toBe(1);
    expect(frameIndexAt(10, 30)).toBe(300);
    expect(frameIndexAt(10, 24)).toBe(240);
  });

  it('keeps the current frame until the next boundary is reached', () => {
    expect(frameIndexAt(0.99 / 30, 30)).toBe(0);
    expect(frameIndexAt(1.01 / 30, 30)).toBe(1);
  });

  it('never goes negative or returns NaN', () => {
    expect(frameIndexAt(-1, 30)).toBe(0);
    expect(frameIndexAt(Number.NaN, 30)).toBe(0);
    expect(frameIndexAt(1, 0)).toBe(0);
  });

  it('treats a boundary that arrived a rounding step low as that boundary', () => {
    // A real seek to 44/30 s can report 43.99998 frames; it must still count as frame 44.
    const reported = 44 / 30 - 2e-5;

    expect(frameIndexAt(reported, 30)).toBe(44);
    expect(frameStepTarget(reported, -1, 30)).toBeCloseTo(43 / 30, 9);
  });
});

describe('frameStepTarget', () => {
  it('moves exactly one frame at 30 fps', () => {
    expect(frameStepTarget(0, 1, 30)).toBeCloseTo(1 / 30, 9);
    expect(frameStepTarget(1, 1, 30)).toBeCloseTo(31 / 30, 9);
    expect(frameStepTarget(1, -1, 30)).toBeCloseTo(29 / 30, 9);
  });

  it('uses the estimated rate instead of the 30 fps fallback', () => {
    expect(frameStepTarget(0, 1, 24)).toBeCloseTo(1 / 24, 9);
    expect(frameStepTarget(0, -1, 24)).toBeCloseTo(0, 9);
    expect(frameStepTarget(1, 1, 24)).toBeCloseTo(25 / 24, 9);
  });

  it('shows the next/previous frame when the playhead sits mid-frame', () => {
    const midFrame = 10.5 / 30;

    expect(frameStepTarget(midFrame, 1, 30)).toBeCloseTo(11 / 30, 9);
    expect(frameStepTarget(midFrame, -1, 30)).toBeCloseTo(9 / 30, 9);
  });

  it('steps several frames at once', () => {
    expect(frameStepTarget(1, 5, 30)).toBeCloseTo(35 / 30, 9);
    expect(frameStepTarget(1, -5, 30)).toBeCloseTo(25 / 30, 9);
  });

  it('clamps at the start and passes through invalid input', () => {
    expect(frameStepTarget(0, -3, 30)).toBe(0);
    expect(frameStepTarget(2, 0, 30)).toBe(2);
    expect(frameStepTarget(2, 1, 0)).toBe(2);
    expect(frameStepTarget(Number.NaN, 1, 30)).toBe(Number.NaN);
  });
});

describe('snapToFrame', () => {
  it('rounds to the nearest boundary', () => {
    expect(snapToFrame(0.02, 30)).toBeCloseTo(1 / 30, 9);
    expect(snapToFrame(0.01, 30)).toBeCloseTo(0, 9);
    expect(snapToFrame(1, 24)).toBeCloseTo(1, 9);
  });

  it('passes unusable input through untouched', () => {
    expect(snapToFrame(1.234, 0)).toBe(1.234);
    expect(snapToFrame(Number.NaN, 30)).toBe(Number.NaN);
  });
});

describe('formatFrameCounter', () => {
  it('shows a number only when there is an estimate', () => {
    expect(formatFrameCounter(123)).toBe('Frame 123');
    expect(formatFrameCounter(0)).toBe('Frame 0');
    expect(formatFrameCounter(12.9)).toBe('Frame 12');
  });

  it('never fakes a frame number without an estimate', () => {
    expect(formatFrameCounter(null)).toBe('Frame —');
    expect(formatFrameCounter(Number.NaN)).toBe('Frame —');
    expect(formatFrameCounter(-1)).toBe('Frame —');
  });
});
