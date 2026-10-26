import { describe, expect, it } from 'vitest';

import {
  audibleSourceCount,
  audibleVoices,
  clampVolume,
  DEFAULT_AUDIO_MIX,
  formatVolume,
  isMixBlended,
  isMixSilent,
  MAX_VOLUME,
  nextAudioLevels,
  nextSoloMix,
  percentToVolume,
  volumeToPercent,
} from '../src/logic/mix';
import { createInitialState } from '../src/state';

describe('mix constants', () => {
  it('caps levels at 1 and starts with A audible and B silent', () => {
    expect(MAX_VOLUME).toBe(1);
    expect(DEFAULT_AUDIO_MIX).toEqual({ a: 1, b: 0 });
  });
});

describe('clampVolume', () => {
  it('leaves levels inside 0-1 alone', () => {
    expect(clampVolume(0)).toBe(0);
    expect(clampVolume(0.5)).toBe(0.5);
    expect(clampVolume(1)).toBe(1);
  });

  it('clamps out-of-range levels to the ends', () => {
    expect(clampVolume(-0.2)).toBe(0);
    expect(clampVolume(-5)).toBe(0);
    expect(clampVolume(1.4)).toBe(1);
    expect(clampVolume(Number.POSITIVE_INFINITY)).toBe(1);
    expect(clampVolume(Number.NEGATIVE_INFINITY)).toBe(0);
  });

  it('treats NaN as silence rather than as full volume', () => {
    expect(clampVolume(Number.NaN)).toBe(0);
  });
});

describe('volumeToPercent', () => {
  it('maps levels onto the integer 0-100 a range input holds', () => {
    expect(volumeToPercent(0)).toBe(0);
    expect(volumeToPercent(0.7)).toBe(70);
    expect(volumeToPercent(1)).toBe(100);
  });

  it('rounds sub-percent levels', () => {
    expect(volumeToPercent(0.333)).toBe(33);
    expect(volumeToPercent(0.705)).toBe(71);
    expect(volumeToPercent(0.999)).toBe(100);
  });

  it('falls back to silence for invalid input', () => {
    expect(volumeToPercent(Number.NaN)).toBe(0);
    expect(volumeToPercent(-1)).toBe(0);
  });
});

describe('percentToVolume', () => {
  it('maps a slider position onto a level', () => {
    expect(percentToVolume(0)).toBe(0);
    expect(percentToVolume(50)).toBe(0.5);
    expect(percentToVolume(100)).toBe(1);
  });

  it('clamps positions outside the slider and ignores non-finite ones', () => {
    expect(percentToVolume(150)).toBe(1);
    expect(percentToVolume(-20)).toBe(0);
    expect(percentToVolume(Number.NaN)).toBe(0);
  });

  it('round-trips every integer percent', () => {
    for (let percent = 0; percent <= 100; percent += 1) {
      expect(volumeToPercent(percentToVolume(percent))).toBe(percent);
    }
  });
});

describe('formatVolume', () => {
  it('renders whole percentages', () => {
    expect(formatVolume(1)).toBe('100%');
    expect(formatVolume(0)).toBe('0%');
    expect(formatVolume(0.466)).toBe('47%');
  });

  it('never renders a broken value as loud audio', () => {
    expect(formatVolume(Number.NaN)).toBe('0%');
    expect(formatVolume(-3)).toBe('0%');
    expect(formatVolume(3)).toBe('100%');
  });
});

describe('isMixSilent', () => {
  it('is true only when neither side can be heard', () => {
    expect(isMixSilent({ a: 0, b: 0 })).toBe(true);
    expect(isMixSilent({ a: 0, b: 0.2 })).toBe(false);
    expect(isMixSilent({ a: 1, b: 0 })).toBe(false);
    expect(isMixSilent({ a: 0.5, b: 0.5 })).toBe(false);
  });

  it('treats negative and NaN levels as silence', () => {
    expect(isMixSilent({ a: Number.NaN, b: -1 })).toBe(true);
  });
});

describe('nextSoloMix', () => {
  it('cycles A only -> B only -> silence -> A only', () => {
    const bOnly = nextSoloMix({ a: 1, b: 0 });
    expect(bOnly).toEqual({ a: 0, b: 1 });

    const silent = nextSoloMix(bOnly);
    expect(silent).toEqual({ a: 0, b: 0 });

    expect(nextSoloMix(silent)).toEqual({ a: 1, b: 0 });
  });

  it('returns to A only from a hand-made blend', () => {
    expect(nextSoloMix({ a: 0.5, b: 0.5 })).toEqual({ a: 1, b: 0 });
    expect(nextSoloMix({ a: 0.2, b: 1 })).toEqual({ a: 1, b: 0 });
  });

  it('clamps and repairs out-of-range levels before deciding', () => {
    expect(nextSoloMix({ a: 2, b: 0 })).toEqual({ a: 0, b: 1 });
    expect(nextSoloMix({ a: Number.NaN, b: 0.4 })).toEqual({ a: 0, b: 0 });
  });

  it('always returns a new object so the state is replaced, not mutated', () => {
    const mix = { a: 1, b: 0 };

    expect(nextSoloMix(mix)).not.toBe(mix);
    expect(mix).toEqual({ a: 1, b: 0 });
  });
});

describe('nextAudioLevels', () => {
  it('includes the loaded track in the cycle: A -> B -> silence -> track -> A', () => {
    const aOnly = { mix: { a: 1, b: 0 }, trackLevel: 0 };

    const bOnly = nextAudioLevels(aOnly, true);
    expect(bOnly).toEqual({ mix: { a: 0, b: 1 }, trackLevel: 0 });

    const silent = nextAudioLevels(bOnly, true);
    expect(silent).toEqual({ mix: { a: 0, b: 0 }, trackLevel: 0 });

    const trackOnly = nextAudioLevels(silent, true);
    expect(trackOnly).toEqual({ mix: { a: 0, b: 0 }, trackLevel: 1 });

    expect(nextAudioLevels(trackOnly, true)).toEqual({ mix: { a: 1, b: 0 }, trackLevel: 0 });
  });

  it('brings the footage back with one press from the state a fresh track starts in', () => {
    // `presetTrackLevels()` leaves exactly this: videos at 0 %, track full.
    const state = nextAudioLevels({ mix: { a: 0, b: 0 }, trackLevel: 1 }, true);

    expect(state).toEqual({ mix: { a: 1, b: 0 }, trackLevel: 0 });
  });

  it('skips the track when none is loaded, exactly like the video-only cycle', () => {
    const bOnly = nextAudioLevels({ mix: { a: 1, b: 0 }, trackLevel: 1 }, false);
    expect(bOnly).toEqual({ mix: { a: 0, b: 1 }, trackLevel: 1 });

    const silent = nextAudioLevels(bOnly, false);
    expect(silent).toEqual({ mix: { a: 0, b: 0 }, trackLevel: 1 });

    // Silence -> A only, never a track that is not there.
    expect(nextAudioLevels(silent, false)).toEqual({ mix: { a: 1, b: 0 }, trackLevel: 1 });
  });

  it('returns to A only when nothing is audible, loaded track included', () => {
    const state = nextAudioLevels({ mix: { a: 0, b: 0 }, trackLevel: 0 }, true);

    expect(state).toEqual({ mix: { a: 0, b: 0 }, trackLevel: 1 });
  });

  it('treats a blend as "not a solo" and goes back to A only', () => {
    expect(nextAudioLevels({ mix: { a: 0.5, b: 1 }, trackLevel: 0.3 }, true)).toEqual({
      mix: { a: 1, b: 0 },
      trackLevel: 0,
    });
  });

  it('returns new objects so the state is replaced, not mutated', () => {
    const levels = { mix: { a: 1, b: 0 }, trackLevel: 1 };
    const next = nextAudioLevels(levels, true);

    expect(next).not.toBe(levels);
    expect(next.mix).not.toBe(levels.mix);
    expect(levels).toEqual({ mix: { a: 1, b: 0 }, trackLevel: 1 });
  });
});

describe('audibleSourceCount', () => {
  it('counts the two videos like audibleVoices does', () => {
    expect(audibleSourceCount({ a: 1, b: 0 }, 0, false)).toBe(1);
    expect(audibleSourceCount({ a: 1, b: 1 }, 0, false)).toBe(2);
    expect(audibleSourceCount({ a: 0, b: 0 }, 0, false)).toBe(0);
  });

  it('counts the track only while one is loaded and above 0 %', () => {
    expect(audibleSourceCount({ a: 0, b: 0 }, 1, true)).toBe(1);
    expect(audibleSourceCount({ a: 1, b: 0 }, 1, true)).toBe(2);
    expect(audibleSourceCount({ a: 0, b: 0 }, 1, false)).toBe(0);
    expect(audibleSourceCount({ a: 0, b: 0 }, 0, true)).toBe(0);
  });

  it('treats NaN and negative track levels as silence', () => {
    expect(audibleSourceCount({ a: 0, b: 0 }, Number.NaN, true)).toBe(0);
    expect(audibleSourceCount({ a: 0, b: 0 }, -1, true)).toBe(0);
  });
});

describe('audibleVoices', () => {
  it('counts how many soundtracks can be heard', () => {
    expect(audibleVoices({ a: 0, b: 0 })).toBe(0);
    expect(audibleVoices({ a: 1, b: 0 })).toBe(1);
    expect(audibleVoices({ a: 0, b: 0.01 })).toBe(1);
    expect(audibleVoices({ a: 0.3, b: 0.7 })).toBe(2);
    expect(audibleVoices({ a: 1, b: 1 })).toBe(2);
  });

  it('treats invalid and negative levels as silence', () => {
    expect(audibleVoices({ a: Number.NaN, b: -2 })).toBe(0);
  });
});

describe('isMixBlended', () => {
  it('is true only while both soundtracks are audible', () => {
    expect(isMixBlended({ a: 0.5, b: 0.5 })).toBe(true);
    expect(isMixBlended({ a: 1, b: 0.01 })).toBe(true);
    expect(isMixBlended({ a: 1, b: 0 })).toBe(false);
    expect(isMixBlended({ a: 0, b: 0 })).toBe(false);
  });
});

describe('initial state', () => {
  it('starts with the default mix', () => {
    expect(createInitialState().mix).toEqual(DEFAULT_AUDIO_MIX);
  });

  it('gives every state its own copy of the default mix', () => {
    expect(createInitialState().mix).not.toBe(DEFAULT_AUDIO_MIX);
  });

  it('accepts an override', () => {
    expect(createInitialState({ mix: { a: 0, b: 0.5 } }).mix).toEqual({ a: 0, b: 0.5 });
  });
});
