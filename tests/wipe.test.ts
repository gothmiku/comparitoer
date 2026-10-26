import { describe, expect, it } from 'vitest';

import {
  applyWipeKey,
  clampWipePosition,
  positionFromRatio,
  WIPE_DEFAULT_PERCENT,
  WIPE_MAX_PERCENT,
  WIPE_MIN_PERCENT,
  WIPE_STEP_LARGE_PERCENT,
  WIPE_STEP_PERCENT,
} from '../src/logic/wipe';

describe('wipe constants', () => {
  it('matches the spec: 0-100 track, 50 % default, 1 % and 10 % steps', () => {
    expect(WIPE_MIN_PERCENT).toBe(0);
    expect(WIPE_MAX_PERCENT).toBe(100);
    expect(WIPE_DEFAULT_PERCENT).toBe(50);
    expect(WIPE_STEP_PERCENT).toBe(1);
    expect(WIPE_STEP_LARGE_PERCENT).toBe(10);
  });
});

describe('clampWipePosition', () => {
  it('leaves positions inside the track alone', () => {
    expect(clampWipePosition(0)).toBe(0);
    expect(clampWipePosition(50)).toBe(50);
    expect(clampWipePosition(100)).toBe(100);
    expect(clampWipePosition(12.5)).toBe(12.5);
  });

  it('clamps out-of-range positions to the ends', () => {
    expect(clampWipePosition(-0.5)).toBe(0);
    expect(clampWipePosition(-1000)).toBe(0);
    expect(clampWipePosition(100.5)).toBe(100);
    expect(clampWipePosition(1e6)).toBe(100);
  });

  it('falls back to the default position for non-finite input', () => {
    expect(clampWipePosition(Number.NaN)).toBe(50);
    expect(clampWipePosition(Number.POSITIVE_INFINITY)).toBe(50);
    expect(clampWipePosition(Number.NEGATIVE_INFINITY)).toBe(50);
  });

  it('rounds to two decimals so aria-valuenow stays stable', () => {
    expect(clampWipePosition(33.333333)).toBe(33.33);
    expect(clampWipePosition(66.666666)).toBe(66.67);
    expect(clampWipePosition(0.001)).toBe(0);
  });
});

describe('positionFromRatio', () => {
  it('maps the pointer ratio across the stage', () => {
    expect(positionFromRatio(0)).toBe(0);
    expect(positionFromRatio(0.25)).toBe(25);
    expect(positionFromRatio(0.5)).toBe(50);
    expect(positionFromRatio(1)).toBe(100);
  });

  it('clamps a pointer outside the stage to the ends', () => {
    expect(positionFromRatio(-0.5)).toBe(0);
    expect(positionFromRatio(1.5)).toBe(100);
  });

  it('rounds sub-percent ratios', () => {
    expect(positionFromRatio(0.333)).toBe(33.3);
    expect(positionFromRatio(0.00001)).toBe(0);
  });

  it('keeps the default for non-finite ratios', () => {
    expect(positionFromRatio(Number.NaN)).toBe(50);
    expect(positionFromRatio(Number.POSITIVE_INFINITY)).toBe(50);
  });
});

describe('applyWipeKey', () => {
  it('moves one percent per arrow press', () => {
    expect(applyWipeKey(50, 'ArrowLeft', false)).toBe(49);
    expect(applyWipeKey(50, 'ArrowRight', false)).toBe(51);
  });

  it('moves ten percent per arrow press with Shift', () => {
    expect(applyWipeKey(50, 'ArrowLeft', true)).toBe(40);
    expect(applyWipeKey(50, 'ArrowRight', true)).toBe(60);
  });

  it('jumps to the ends with Home and End', () => {
    expect(applyWipeKey(50, 'Home', false)).toBe(0);
    expect(applyWipeKey(50, 'End', false)).toBe(100);
    expect(applyWipeKey(50, 'Home', true)).toBe(0);
    expect(applyWipeKey(50, 'End', true)).toBe(100);
  });

  it('clamps at the ends instead of wrapping', () => {
    expect(applyWipeKey(0, 'ArrowLeft', false)).toBe(0);
    expect(applyWipeKey(100, 'ArrowRight', false)).toBe(100);
    expect(applyWipeKey(5, 'ArrowLeft', true)).toBe(0);
    expect(applyWipeKey(95, 'ArrowRight', true)).toBe(100);
  });

  it('ignores unrelated keys so the caller leaves the event alone', () => {
    expect(applyWipeKey(50, 'ArrowUp', false)).toBeNull();
    expect(applyWipeKey(50, 'a', false)).toBeNull();
    expect(applyWipeKey(50, 'PageUp', false)).toBeNull();
    expect(applyWipeKey(50, 'Escape', false)).toBeNull();
  });

  it('repairs an out-of-range starting position before stepping', () => {
    expect(applyWipeKey(150, 'ArrowLeft', false)).toBe(99);
    expect(applyWipeKey(Number.NaN, 'ArrowRight', false)).toBe(51);
  });
});
