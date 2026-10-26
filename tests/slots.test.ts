import { describe, expect, it } from 'vitest';

import {
  clampSlotTime,
  SLOT_END_EPSILON_SECONDS,
  slotAtEnd,
  slotLimit,
  slotPlayStart,
  slotStepTarget,
} from '../src/logic/slots';

describe('slots', () => {
  it('falls back to an unbounded limit for an unknown duration', () => {
    expect(slotLimit(Number.NaN)).toBe(Number.POSITIVE_INFINITY);
    expect(slotLimit(0)).toBe(Number.POSITIVE_INFINITY);
    expect(slotLimit(-4)).toBe(Number.POSITIVE_INFINITY);
  });

  it('uses the slot duration when it is usable', () => {
    expect(slotLimit(12.5)).toBe(12.5);
  });
});

describe('clampSlotTime', () => {
  it('clamps both ends to the slot own duration', () => {
    expect(clampSlotTime(-3, 10)).toBe(0);
    expect(clampSlotTime(4.5, 10)).toBe(4.5);
    expect(clampSlotTime(99, 10)).toBe(10);
  });

  it('does not clamp when the duration is unknown', () => {
    expect(clampSlotTime(99, Number.NaN)).toBe(99);
    expect(clampSlotTime(99, 0)).toBe(99);
  });

  it('treats NaN and infinity as 0', () => {
    expect(clampSlotTime(Number.NaN, 10)).toBe(0);
    expect(clampSlotTime(Number.POSITIVE_INFINITY, 10)).toBe(10);
  });

  it('keeps a value exactly on the end', () => {
    expect(clampSlotTime(10, 10)).toBe(10);
  });
});

describe('slotAtEnd', () => {
  it('is true on the last frame and within the epsilon', () => {
    expect(slotAtEnd(10, 10)).toBe(true);
    expect(slotAtEnd(10 - SLOT_END_EPSILON_SECONDS / 2, 10)).toBe(true);
  });

  it('is false earlier, and without a duration', () => {
    expect(slotAtEnd(9.9, 10)).toBe(false);
    expect(slotAtEnd(10, Number.NaN)).toBe(false);
    expect(slotAtEnd(10, 0)).toBe(false);
  });
});

describe('slotPlayStart', () => {
  it('restarts from 0 when the slot is parked at its end', () => {
    expect(slotPlayStart(10, 10)).toBe(0);
  });

  it('resumes from the current position otherwise', () => {
    expect(slotPlayStart(3.25, 10)).toBe(3.25);
  });

  it('treats a negative or NaN playhead as the start', () => {
    expect(slotPlayStart(-1, 10)).toBe(0);
    expect(slotPlayStart(Number.NaN, 10)).toBe(0);
  });
});

describe('slotStepTarget', () => {
  it('steps one frame of the slot own rate', () => {
    expect(slotStepTarget(0, 1, 25, 10)).toBeCloseTo(0.04, 6);
    expect(slotStepTarget(0.2, 1, 25, 10)).toBeCloseTo(0.24, 6);
  });

  it('falls back to 30 fps without an estimate', () => {
    expect(slotStepTarget(0, 1, null, 10)).toBeCloseTo(1 / 30, 6);
  });

  it('clamps to the slot own duration instead of the shorter timeline', () => {
    // B is 20 s long; stepping forward near 19.99 s stays inside B.
    expect(slotStepTarget(19.99, 1, 25, 20)).toBe(20);
    expect(slotStepTarget(0, -1, 25, 20)).toBe(0);
  });

  it('is a no-op for a zero step', () => {
    expect(slotStepTarget(4, 0, 25, 10)).toBe(4);
  });
});
