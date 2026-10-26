import { describe, expect, it } from 'vitest';

import {
  BLENDED_DRIFT_HARD_SEEK_SECONDS,
  DEFAULT_PLAYBACK_RATE,
  DRIFT_HARD_SEEK_SECONDS,
  DRIFT_NUDGE_RATE,
  DRIFT_NUDGE_SECONDS,
  decideCorrection,
} from '../src/logic/drift';
import type { DriftSample } from '../src/logic/drift';

function sample(driftSeconds: number, overrides: Partial<DriftSample> = {}): DriftSample {
  return {
    driftSeconds,
    basePlaybackRate: 1,
    nudging: false,
    ...overrides,
  };
}

describe('drift constants', () => {
  it('matches the spec', () => {
    expect(DRIFT_HARD_SEEK_SECONDS).toBe(0.04);
    expect(DRIFT_NUDGE_SECONDS).toBe(0.01);
    expect(DRIFT_NUDGE_RATE).toBe(0.03);
    expect(DEFAULT_PLAYBACK_RATE).toBe(1);
  });
});

describe('blended audio (two audible soundtracks)', () => {
  it('skips the rate nudge so two mixed sources never detune against each other', () => {
    const ahead = decideCorrection(sample(0.02, { audibleVoices: 2 }));
    const behind = decideCorrection(sample(-0.02, { audibleVoices: 2 }));

    expect(ahead).toEqual({ action: 'none', playbackRate: 1, rateAdjustment: 0 });
    expect(behind).toEqual({ action: 'none', playbackRate: 1, rateAdjustment: 0 });
  });

  it('keeps the base rate in the blended state, including non-1x speeds', () => {
    expect(decideCorrection(sample(0.02, { audibleVoices: 2, basePlaybackRate: 2 }))).toEqual({
      action: 'none',
      playbackRate: 2,
      rateAdjustment: 0,
    });
  });

  it('still hard-seeks beyond the blended threshold (which is tighter than 40 ms)', () => {
    // 25 ms is inside the single-voice nudge band but past the blended seek threshold.
    expect(decideCorrection(sample(0.025)).action).toBe('nudge');
    expect(decideCorrection(sample(0.025, { audibleVoices: 2 })).action).toBe('hardSeek');
    expect(decideCorrection(sample(0.019, { audibleVoices: 2 })).action).toBe('none');
    expect(decideCorrection(sample(0.041, { audibleVoices: 2 })).action).toBe('hardSeek');
  });

  it('uses the documented blended threshold', () => {
    expect(BLENDED_DRIFT_HARD_SEEK_SECONDS).toBe(0.02);
    expect(BLENDED_DRIFT_HARD_SEEK_SECONDS).toBeLessThan(DRIFT_HARD_SEEK_SECONDS);
  });

  it('nudges again as soon as only one voice is left', () => {
    expect(decideCorrection(sample(0.02, { audibleVoices: 1 })).action).toBe('nudge');
    expect(decideCorrection(sample(0.02, { audibleVoices: 0 })).action).toBe('nudge');
    expect(decideCorrection(sample(0.02, { audibleVoices: 2 })).action).toBe('none');
  });

  it('treats a missing count as a single audible voice', () => {
    expect(decideCorrection(sample(0.02)).action).toBe('nudge');
  });

  it('is still idempotent in the blended band', () => {
    const s = sample(-0.03, { audibleVoices: 2 });

    expect(decideCorrection(s)).toEqual(decideCorrection(s));
  });
});

describe('decideCorrection', () => {
  describe('in sync', () => {
    it('leaves the base rate alone at zero drift', () => {
      expect(decideCorrection(sample(0))).toEqual({
        action: 'none',
        playbackRate: 1,
        rateAdjustment: 0,
      });
    });

    it('restores the base rate just inside the nudge band', () => {
      const ahead = decideCorrection(sample(0.0099));
      const behind = decideCorrection(sample(-0.0099));

      expect(ahead.action).toBe('none');
      expect(ahead.playbackRate).toBe(1);
      expect(ahead.rateAdjustment).toBe(0);
      expect(behind.action).toBe('none');
      expect(behind.playbackRate).toBe(1);
    });

    it('restores a non-1x base rate when in sync', () => {
      const decision = decideCorrection(sample(0.002, { basePlaybackRate: 1.5 }));

      expect(decision.action).toBe('none');
      expect(decision.playbackRate).toBe(1.5);
    });
  });

  describe('nudge boundaries', () => {
    it('nudges B slower when it is exactly 0.01 s ahead', () => {
      const decision = decideCorrection(sample(DRIFT_NUDGE_SECONDS));

      expect(decision.action).toBe('nudge');
      expect(decision.rateAdjustment).toBe(-DRIFT_NUDGE_RATE);
      expect(decision.playbackRate).toBeCloseTo(0.97, 12);
    });

    it('nudges B faster when it is exactly 0.01 s behind', () => {
      const decision = decideCorrection(sample(-DRIFT_NUDGE_SECONDS));

      expect(decision.action).toBe('nudge');
      expect(decision.rateAdjustment).toBe(DRIFT_NUDGE_RATE);
      expect(decision.playbackRate).toBeCloseTo(1.03, 12);
    });

    it('nudges at exactly the hard-seek threshold instead of seeking', () => {
      const decision = decideCorrection(sample(DRIFT_HARD_SEEK_SECONDS));

      expect(decision.action).toBe('nudge');
      expect(decision.playbackRate).toBeCloseTo(0.97, 12);
    });

    it('nudges faster at exactly -0.04 s', () => {
      const decision = decideCorrection(sample(-DRIFT_HARD_SEEK_SECONDS));

      expect(decision.action).toBe('nudge');
      expect(decision.rateAdjustment).toBe(DRIFT_NUDGE_RATE);
    });

    it('keeps a negative drift measurement as "B behind", not "B ahead"', () => {
      expect(decideCorrection(sample(-0.02)).rateAdjustment).toBeGreaterThan(0);
      expect(decideCorrection(sample(0.02)).rateAdjustment).toBeLessThan(0);
    });
  });

  describe('hard seek', () => {
    it('hard-seeks just past the threshold', () => {
      const decision = decideCorrection(sample(0.0401));

      expect(decision.action).toBe('hardSeek');
      expect(decision.playbackRate).toBe(1);
      expect(decision.rateAdjustment).toBe(0);
    });

    it('hard-seeks a large negative drift', () => {
      const decision = decideCorrection(sample(-0.5));

      expect(decision.action).toBe('hardSeek');
      expect(decision.playbackRate).toBe(1);
    });

    it('returns the base rate, not the nudge rate, after a hard seek', () => {
      const decision = decideCorrection(sample(2, { basePlaybackRate: 2 }));

      expect(decision.action).toBe('hardSeek');
      expect(decision.playbackRate).toBe(2);
    });
  });

  describe('base rates other than 1x', () => {
    it('scales the nudge relative to the selected speed', () => {
      expect(decideCorrection(sample(0.02, { basePlaybackRate: 2 })).playbackRate).toBeCloseTo(
        1.94,
        12,
      );
      expect(decideCorrection(sample(-0.02, { basePlaybackRate: 2 })).playbackRate).toBeCloseTo(
        2.06,
        12,
      );
      expect(decideCorrection(sample(0.02, { basePlaybackRate: 0.5 })).playbackRate).toBeCloseTo(
        0.485,
        12,
      );
      expect(decideCorrection(sample(0.02, { basePlaybackRate: 1.5 })).playbackRate).toBeCloseTo(
        1.455,
        12,
      );
    });

    it('falls back to 1x when the base rate is unusable', () => {
      expect(decideCorrection(sample(0, { basePlaybackRate: Number.NaN })).playbackRate).toBe(1);
      expect(decideCorrection(sample(0, { basePlaybackRate: 0 })).playbackRate).toBe(1);
      expect(decideCorrection(sample(0, { basePlaybackRate: -2 })).playbackRate).toBe(1);
      expect(
        decideCorrection(sample(0, { basePlaybackRate: Number.POSITIVE_INFINITY })).playbackRate,
      ).toBe(1);
    });
  });

  describe('non-finite drift', () => {
    it('treats NaN drift as in sync rather than seeking', () => {
      const decision = decideCorrection(sample(Number.NaN));

      expect(decision.action).toBe('none');
      expect(decision.playbackRate).toBe(1);
      expect(decision.rateAdjustment).toBe(0);
    });

    it('treats infinite drift as in sync rather than seeking', () => {
      expect(decideCorrection(sample(Number.POSITIVE_INFINITY)).action).toBe('none');
      expect(decideCorrection(sample(Number.NEGATIVE_INFINITY)).action).toBe('none');
    });
  });

  describe('idempotence', () => {
    it('ignores the nudging flag so repeated samples agree', () => {
      const steady = sample(0.02, { nudging: false });
      const alreadyNudging = sample(0.02, { nudging: true });

      expect(decideCorrection(alreadyNudging)).toEqual(decideCorrection(steady));
      expect(decideCorrection(alreadyNudging)).toEqual(decideCorrection(alreadyNudging));
    });

    it('stays in sync once drift falls back inside the dead band', () => {
      expect(decideCorrection(sample(0.02, { nudging: true })).action).toBe('nudge');
      expect(decideCorrection(sample(0.004, { nudging: true })).action).toBe('none');
    });
  });
});
