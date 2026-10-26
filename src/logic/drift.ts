/** Absolute drift above which B is hard-seeked to the master clock, in seconds. */
export const DRIFT_HARD_SEEK_SECONDS = 0.04;

/**
 * Hard-seek threshold while more than one soundtrack is audible, in seconds.
 *
 * The nudge is unavailable there (it would be heard as detuning), so the hard seek is the only
 * correction left. It is taken earlier than {@link DRIFT_HARD_SEEK_SECONDS} because the audio
 * mixer ducks the seeked source around the correction, which makes the seek inaudible but does
 * nothing about the pictures: letting drift sit near 40 ms would be up to two frames of visible
 * offset at 50 fps.
 */
export const BLENDED_DRIFT_HARD_SEEK_SECONDS = 0.02;

/** Absolute drift below which playback rates are restored and the pair counts as in sync. */
export const DRIFT_NUDGE_SECONDS = 0.01;

/** Relative playback-rate correction applied to B while it drifts. */
export const DRIFT_NUDGE_RATE = 0.03;

/** Rate assumed when the caller reports an unusable base playback rate. */
export const DEFAULT_PLAYBACK_RATE = 1;

/**
 * `none`: in sync (or no usable measurement) — restore the base rate.
 * `nudge`: inside the nudge band — bias B's rate by ±{@link DRIFT_NUDGE_RATE}.
 * `hardSeek`: beyond {@link DRIFT_HARD_SEEK_SECONDS} — seek B to A's time.
 */
export type DriftAction = 'none' | 'nudge' | 'hardSeek';

/** One drift measurement taken while both videos are playing. */
export interface DriftSample {
  /** B.currentTime - A.currentTime, in seconds. Positive means B is ahead. */
  readonly driftSeconds: number;
  /** Speed selected in the UI; both videos return to it when in sync. */
  readonly basePlaybackRate: number;
  /**
   * Whether a nudge rate is currently applied to B. The engine uses this to know
   * whether it must restore the rate on pause/seek; the decision itself comes from
   * the drift band alone, so it is stable and idempotent.
   */
  readonly nudging: boolean;
  /**
   * How many soundtracks are audible at once (1 by default). Above 1 the nudge is skipped:
   * a ±3 % rate difference between two mixed sources is heard as detuning and beating, which
   * is worse than the few milliseconds of drift it repairs.
   */
  readonly audibleVoices?: number;
}

/** What the sync engine does next, plus the rate B should run at. */
export interface DriftDecision {
  readonly action: DriftAction;
  /** Playback rate to apply to B for this sample; equals the base rate when in sync. */
  readonly playbackRate: number;
  /** Signed fraction applied to the base rate: `-0.03`, `0`, or `+0.03`. */
  readonly rateAdjustment: number;
}

/** Pure mapping from a drift sample to an action; no DOM access, fully unit tested. */
export type DriftDecider = (sample: DriftSample) => DriftDecision;

function resolveBaseRate(basePlaybackRate: number): number {
  return Number.isFinite(basePlaybackRate) && basePlaybackRate > 0
    ? basePlaybackRate
    : DEFAULT_PLAYBACK_RATE;
}

function inSync(basePlaybackRate: number): DriftDecision {
  return {
    action: 'none',
    playbackRate: basePlaybackRate,
    rateAdjustment: 0,
  };
}

/** More than one audible soundtrack: any rate bias would be heard as detuning. */
function blended(sample: DriftSample): boolean {
  return (sample.audibleVoices ?? 1) > 1;
}

/**
 * Maps a drift sample to the correction for B. A is the master clock, so:
 *
 * - `|drift| < 0.01` s: in sync, base rate restored.
 * - `0.01 <= |drift| <= 0.04` s: nudge — B runs 3% slower when ahead (positive
 *   drift) and 3% faster when behind, so it converges without a visible jump.
 * - `|drift| > 0.04` s: hard seek to A's time, then the base rate.
 * - Non-finite drift (no usable measurement) counts as in sync rather than
 *   thrashing `currentTime`; a non-finite or non-positive base rate falls back to 1.
 *
 * When more than one soundtrack is audible (`audibleVoices > 1`) the nudge is skipped and
 * B keeps the base rate inside the band: a playback-rate difference of 3 % between two
 * sources the user hears at once is detuning and beating, which sounds far worse than the
 * milliseconds of drift it would remove. Because the nudge is gone, the hard seek is taken
 * earlier ({@link BLENDED_DRIFT_HARD_SEEK_SECONDS}) so the pictures do not drift apart; the
 * audio mixer ducks that source around the seek.
 *
 * The decision is computed from the base rate every time, so calling it repeatedly
 * with the same sample yields the same result.
 */
export const decideCorrection: DriftDecider = (sample) => {
  const basePlaybackRate = resolveBaseRate(sample.basePlaybackRate);
  const driftMagnitude = Math.abs(sample.driftSeconds);
  const isBlended = blended(sample);

  if (!Number.isFinite(driftMagnitude)) {
    return inSync(basePlaybackRate);
  }

  const hardSeekThreshold = isBlended
    ? BLENDED_DRIFT_HARD_SEEK_SECONDS
    : DRIFT_HARD_SEEK_SECONDS;

  if (driftMagnitude > hardSeekThreshold) {
    return {
      action: 'hardSeek',
      playbackRate: basePlaybackRate,
      rateAdjustment: 0,
    };
  }

  // Two audible sources: no rate bias, so neither of them changes pitch against the other.
  if (isBlended) {
    return inSync(basePlaybackRate);
  }

  if (driftMagnitude >= DRIFT_NUDGE_SECONDS) {
    const rateAdjustment =
      sample.driftSeconds > 0 ? -DRIFT_NUDGE_RATE : DRIFT_NUDGE_RATE;

    return {
      action: 'nudge',
      playbackRate: basePlaybackRate * (1 + rateAdjustment),
      rateAdjustment,
    };
  }

  return inSync(basePlaybackRate);
};
