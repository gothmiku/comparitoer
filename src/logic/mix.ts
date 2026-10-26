/**
 * Audio mix math. Pure and DOM-free so the level rules (clamping, the `M` solo cycle and the
 * percent read-out) are unit-tested instead of living inside change handlers.
 *
 * Both videos are always playing through their own media element, so "the audio source" is no
 * longer a choice between them: each one has a level, and a level of 0 silences it.
 */

/** Per-source levels for the two stacked videos, each 0-1. */
export interface AudioMix {
  /** Level of video A, 0-1. */
  a: number;
  /** Level of video B, 0-1. */
  b: number;
}

/** Loudest level a source can reach; the Web Audio gain and `HTMLMediaElement.volume` agree. */
export const MAX_VOLUME = 1;

/** `M` cycles A only -> B only -> silence -> A only, the order of the old audio selector. */
export const DEFAULT_AUDIO_MIX: AudioMix = { a: MAX_VOLUME, b: 0 };

/** Level difference that still counts as silence; below this the element is muted outright. */
const SILENCE_EPSILON = 1e-4;

/** Keeps a level inside 0-1. */
export type VolumeClamper = (volume: number) => number;

/** Rounds a level for display, e.g. `70%`. */
export type VolumeFormatter = (volume: number) => string;

/** Converts a slider position (0-100) into a level (0-1). */
export type PercentToVolume = (percent: number) => number;

/** Converts a level (0-1) into the integer 0-100 a range input stores. */
export type VolumeToPercent = (volume: number) => number;

/** Next mix in the `M` cycle. */
export type SoloCycler = (mix: AudioMix) => AudioMix;

/** Levels of every source the app can play: the two videos plus the third track. */
export interface AudioLevels {
  /** Levels of the two stacked videos. */
  mix: AudioMix;
  /** Level of the external track, 0-1. */
  trackLevel: number;
}

/** Next levels in the `M` cycle, which includes the track once one is loaded. */
export type AudioLevelsCycler = (levels: AudioLevels, trackLoaded: boolean) => AudioLevels;

/** Counts the audible sources including the third one, 0-3. */
export type SourceVoiceCounter = (
  mix: AudioMix,
  trackLevel: number,
  trackLoaded: boolean,
) => number;

/** True when neither source can be heard. */
export type MixSilenceCheck = (mix: AudioMix) => boolean;

/** Counts how many soundtracks are audible at once, 0-2. */
export type MixVoiceCounter = (mix: AudioMix) => number;

/** True once more than one soundtrack is being mixed. */
export type MixBlendCheck = (mix: AudioMix) => boolean;

/**
 * Clamps a level to 0-1. NaN has no meaningful level and falls back to silence rather than
 * to the maximum, so a broken value can never become unexpected loud audio; the infinities
 * simply clamp to the ends.
 */
export const clampVolume: VolumeClamper = (volume) => {
  if (Number.isNaN(volume)) {
    return 0;
  }

  return Math.min(Math.max(volume, 0), MAX_VOLUME);
};

/** A level as the whole percentage a range input holds. */
export const volumeToPercent: VolumeToPercent = (volume) => Math.round(clampVolume(volume) * 100);

/** A range input position as a level. */
export const percentToVolume: PercentToVolume = (percent) =>
  Number.isFinite(percent) ? clampVolume(percent / 100) : 0;

/** Read-out next to a slider, and the `aria-valuetext` of the slider itself. */
export const formatVolume: VolumeFormatter = (volume) => `${volumeToPercent(volume)}%`;

/** True when both levels are silent, i.e. nothing can be heard. */
export const isMixSilent: MixSilenceCheck = (mix) =>
  clampVolume(mix.a) < SILENCE_EPSILON && clampVolume(mix.b) < SILENCE_EPSILON;

/**
 * How many soundtracks the user can hear: 0, 1 or 2.
 *
 * The sync engine needs this because a playback-rate nudge is a *pitch* change: fine when a
 * single source is audible, audible as detuning the moment two are mixed.
 */
export const audibleVoices: MixVoiceCounter = (mix) =>
  (clampVolume(mix.a) > 0 ? 1 : 0) + (clampVolume(mix.b) > 0 ? 1 : 0);

/**
 * How many sources can actually be heard, counting the third one only while it is loaded.
 *
 * The track matters here for the same reason the second video does: a ±3 % rate nudge is a
 * pitch change, and it is audible the moment anything else plays against it.
 */
export const audibleSourceCount: SourceVoiceCounter = (mix, trackLevel, trackLoaded) =>
  audibleVoices(mix) +
  (trackLoaded && clampVolume(trackLevel) >= SILENCE_EPSILON ? 1 : 0);

/**
 * True while both soundtracks are audible. Two separate media elements are mixed by the
 * browser with independent buffering, so they can be a few milliseconds apart even when the
 * engine has their `currentTime` aligned; that is a property of the platform, not a bug.
 */
export const isMixBlended: MixBlendCheck = (mix) => audibleVoices(mix) > 1;

/**
 * Cycles the audible source: A only -> B only -> silence -> the third track -> A only.
 *
 * The track joins the cycle only while one is loaded, so the key always means "next source I
 * can actually hear" instead of stepping through levels that are not connected to anything.
 * The order is chosen for the state a loaded track starts in: a fresh track is the only audible
 * source, and one press has to bring the footage back, so the track is the step *before* A.
 * A hand-made blend counts as "not a solo" and returns to A only. New objects every call.
 */
export const nextAudioLevels: AudioLevelsCycler = (levels, trackLoaded) => {
  const a = clampVolume(levels.mix.a);
  const b = clampVolume(levels.mix.b);
  const track = trackLoaded ? clampVolume(levels.trackLevel) : 0;

  const audibleA = a >= SILENCE_EPSILON;
  const audibleB = b >= SILENCE_EPSILON;
  const audibleTrack = track >= SILENCE_EPSILON;

  /**
   * What the track fader should read after this press. Without a loaded track the slider is not
   * even shown, so its stored value is left alone instead of being quietly reset to 0.
   */
  const trackOff = trackLoaded ? 0 : clampVolume(levels.trackLevel);

  // A only -> B only.
  if (audibleA && !audibleB && !audibleTrack) {
    return { mix: { a: 0, b: MAX_VOLUME }, trackLevel: trackOff };
  }

  // B only -> silence (the track is silenced too, or "silent" would be a lie).
  if (!audibleA && audibleB && !audibleTrack) {
    return { mix: { a: 0, b: 0 }, trackLevel: trackOff };
  }

  // Silence -> the next source in line: the loaded track, or A when there is none.
  if (!audibleA && !audibleB && !audibleTrack) {
    return trackLoaded
      ? { mix: { a: 0, b: 0 }, trackLevel: MAX_VOLUME }
      : { mix: { a: MAX_VOLUME, b: 0 }, trackLevel: clampVolume(levels.trackLevel) };
  }

  // The track alone (the state a freshly loaded track starts in) and every blend go to A only.
  return { mix: { a: MAX_VOLUME, b: 0 }, trackLevel: 0 };
};

/**
 * Cycles the mix through the three solo states the audio selector used to offer.
 *
 * A hand-made blend (both sliders partly open) counts as "neither soloed", so the first press
 * returns to A only — the default listening state — instead of guessing which side should win.
 * Always returns a new object: the caller replaces the app state rather than mutating it.
 */
export const nextSoloMix: SoloCycler = (mix) =>
  nextAudioLevels({ mix, trackLevel: 0 }, false).mix;

