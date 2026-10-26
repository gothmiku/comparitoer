import { describe, expect, it } from 'vitest';

import {
  ASPECT_RATIO_WARNING_RATIO,
  aspectRatioDiffer,
  formatAspectRatio,
  formatFps,
  formatResolution,
  infoWarnings,
  UNKNOWN_FACT_TEXT,
} from '../src/logic/info';
import type { VideoFacts } from '../src/logic/info';

function facts(overrides: Partial<VideoFacts> = {}): VideoFacts {
  return { width: 1920, height: 1080, fps: 30, ...overrides };
}

describe('info constants', () => {
  it('uses a 1 % aspect-ratio tolerance', () => {
    expect(ASPECT_RATIO_WARNING_RATIO).toBe(0.01);
  });

  it('has a single placeholder for unknown facts', () => {
    expect(UNKNOWN_FACT_TEXT).toBe('—');
  });
});

describe('formatResolution', () => {
  it('renders a real resolution with a multiplication sign', () => {
    expect(formatResolution(1920, 1080)).toBe('1920 × 1080');
    expect(formatResolution(640, 480)).toBe('640 × 480');
  });

  it('rounds fractional pixels', () => {
    expect(formatResolution(1920.4, 1079.6)).toBe('1920 × 1080');
  });

  it('shows the placeholder while the size is unknown', () => {
    expect(formatResolution(0, 0)).toBe(UNKNOWN_FACT_TEXT);
    expect(formatResolution(Number.NaN, 1080)).toBe(UNKNOWN_FACT_TEXT);
    expect(formatResolution(1920, Number.NaN)).toBe(UNKNOWN_FACT_TEXT);
    expect(formatResolution(-1920, 1080)).toBe(UNKNOWN_FACT_TEXT);
    expect(formatResolution(1920, Number.POSITIVE_INFINITY)).toBe(UNKNOWN_FACT_TEXT);
  });
});

describe('formatAspectRatio', () => {
  it('reduces common shapes to small integer ratios', () => {
    expect(formatAspectRatio(1920, 1080)).toBe('16:9');
    expect(formatAspectRatio(1280, 720)).toBe('16:9');
    expect(formatAspectRatio(3840, 2160)).toBe('16:9');
    expect(formatAspectRatio(640, 480)).toBe('4:3');
    expect(formatAspectRatio(1440, 1080)).toBe('4:3');
    expect(formatAspectRatio(1000, 1000)).toBe('1:1');
    expect(formatAspectRatio(1080, 1920)).toBe('9:16');
  });

  it('falls back to a decimal ratio when the reduction is unwieldy', () => {
    expect(formatAspectRatio(1918, 1080)).toBe('1.78:1');
    expect(formatAspectRatio(1000, 999)).toBe('1.00:1');
  });

  it('shows the placeholder while the size is unknown', () => {
    expect(formatAspectRatio(0, 1080)).toBe(UNKNOWN_FACT_TEXT);
    expect(formatAspectRatio(1920, 0)).toBe(UNKNOWN_FACT_TEXT);
    expect(formatAspectRatio(Number.NaN, 1080)).toBe(UNKNOWN_FACT_TEXT);
  });
});

describe('formatFps', () => {
  it('drops the decimals of an integer estimate', () => {
    expect(formatFps(30)).toBe('30 fps');
    expect(formatFps(60)).toBe('60 fps');
    expect(formatFps(30.0001)).toBe('30 fps');
  });

  it('keeps two decimals for fractional rates', () => {
    expect(formatFps(23.976)).toBe('23.98 fps');
    expect(formatFps(29.97)).toBe('29.97 fps');
    expect(formatFps(59.94)).toBe('59.94 fps');
  });

  it('shows the placeholder while there is no usable estimate', () => {
    expect(formatFps(null)).toBe(UNKNOWN_FACT_TEXT);
    expect(formatFps(0)).toBe(UNKNOWN_FACT_TEXT);
    expect(formatFps(-30)).toBe(UNKNOWN_FACT_TEXT);
    expect(formatFps(Number.NaN)).toBe(UNKNOWN_FACT_TEXT);
    expect(formatFps(Number.POSITIVE_INFINITY)).toBe(UNKNOWN_FACT_TEXT);
  });
});

describe('aspectRatioDiffer', () => {
  it('treats different resolutions with the same shape as equal', () => {
    expect(aspectRatioDiffer(1920, 1080, 1280, 720)).toBe(false);
    expect(aspectRatioDiffer(3840, 2160, 854, 480)).toBe(false);
    expect(aspectRatioDiffer(640, 480, 1440, 1080)).toBe(false);
  });

  it('flags 16:9 against 4:3', () => {
    expect(aspectRatioDiffer(1920, 1080, 640, 480)).toBe(true);
    expect(aspectRatioDiffer(640, 480, 1920, 1080)).toBe(true);
  });

  it('applies the 1 % threshold', () => {
    // 1.500 vs 1.488 is 0.8 % apart: inside the tolerance.
    expect(aspectRatioDiffer(1500, 1000, 1488, 1000)).toBe(false);
    // 1.500 vs 1.484 is 1.07 % apart: outside it.
    expect(aspectRatioDiffer(1500, 1000, 1484, 1000)).toBe(true);
  });

  it('stays quiet while either size is unknown', () => {
    expect(aspectRatioDiffer(0, 0, 1920, 1080)).toBe(false);
    expect(aspectRatioDiffer(1920, 1080, Number.NaN, 1080)).toBe(false);
    expect(aspectRatioDiffer(1920, 0, 640, 480)).toBe(false);
  });
});

describe('infoWarnings', () => {
  it('reports nothing for a matched pair', () => {
    expect(infoWarnings(facts(), facts({ width: 1280, height: 720 }))).toEqual([]);
  });

  it('reports a differing aspect ratio with both shapes', () => {
    const warnings = infoWarnings(facts(), facts({ width: 640, height: 480 }));

    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toEqual({
      kind: 'aspect-ratio',
      message: 'Aspect ratios differ: A 16:9, B 4:3.',
    });
  });

  it('reports a differing frame rate with both rates', () => {
    const warnings = infoWarnings(facts(), facts({ fps: 24 }));

    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toEqual({
      kind: 'fps',
      message: 'Frame rates differ: A 30 fps, B 24 fps.',
    });
  });

  it('orders the chips: aspect ratio first, then frame rate', () => {
    const warnings = infoWarnings(facts(), facts({ width: 640, height: 480, fps: 24 }));

    expect(warnings.map((warning) => warning.kind)).toEqual(['aspect-ratio', 'fps']);
  });

  it('never warns about frame rates it does not know', () => {
    expect(infoWarnings(facts({ fps: null }), facts({ fps: 24 }))).toEqual([]);
    expect(infoWarnings(facts({ fps: 30 }), facts({ fps: null }))).toEqual([]);
  });

  it('never warns about sizes it does not know', () => {
    expect(infoWarnings(facts({ width: 0, height: 0 }), facts({ width: 640, height: 480 }))).toEqual(
      [],
    );
  });
});
