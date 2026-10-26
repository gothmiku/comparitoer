import { timelineDuration } from './logic/duration';
import { decideCorrection, DRIFT_HARD_SEEK_SECONDS } from './logic/drift';
import { classifyMediaError, mediaErrorMessage } from './logic/file';
import type { MediaErrorKind } from './logic/file';
import { estimateFps, FALLBACK_FPS, frameStepTarget } from './logic/fps';
import { clampSlotTime, slotPlayStart, slotStepTarget } from './logic/slots';
import type { PlaybackSpeed, SlotId } from './state';

/** Everything the sync engine reports back to the composition root. */
export interface SyncEventHandlers {
  /** Playhead moved (playback frame, seek completed, or scrub tick). */
  timeUpdate?: (currentTime: number, timelineDuration: number) => void;
  /** Play/pause state changed as a side effect (ended, buffering pause, loop). */
  playStateChange?: (playing: boolean) => void;
  /** A frame rate estimate is available for a slot. */
  fpsEstimate?: (slot: SlotId, fps: number) => void;
  /** Playback reached min(durationA, durationB) and loop is off. */
  ended?: () => void;
  /**
   * A corrective seek is about to be applied to one source while playback is running. The
   * seek flushes that element's decoder, so its audio drops out; the audio mixer ducks the
   * source for a few milliseconds to turn that into a smooth dip instead of a click.
   * `'track'` is the external audio track.
   */
  audioCorrection?: (slot: SlotId | 'track') => void;
  /**
   * Media error, with the kind so the composition root can name the file it belongs to.
   * Loading failures are described by the media loader; this covers playback failures,
   * which happen long after the file was accepted.
   */
  mediaError?: (slot: SlotId, kind: MediaErrorKind, fallbackMessage: string) => void;
  /**
   * Independent mode only: one slot's playhead moved (every animation frame while it plays,
   * and after every seek). `duration` is that slot's own length.
   */
  slotTimeUpdate?: (slot: SlotId, currentTime: number, duration: number) => void;
  /** Independent mode only: one slot started or stopped running. */
  slotPlayStateChange?: (slot: SlotId, playing: boolean) => void;
}

/** Elements owned by the stage and driven exclusively by the sync engine. */
export interface SyncEngineOptions {
  readonly videoA: HTMLVideoElement;
  readonly videoB: HTMLVideoElement;
  readonly handlers?: SyncEventHandlers;
  /** Initial speed and loop flag mirrored from AppState. */
  readonly speed: PlaybackSpeed;
  readonly loop: boolean;
  /**
   * The optional external audio track. It is a second follower: A stays the clock, the track is
   * seeked with it and corrected like B, so an external soundtrack cannot drift away from the
   * picture. `null` (or no source loaded) makes every track call a no-op.
   */
  readonly audioTrack?: HTMLAudioElement | null;
  /**
   * How many soundtracks are audible right now (0-2), read on every drift sample. Audio
   * itself belongs to `audio.ts`; the engine only needs the count to know whether a
   * playback-rate nudge would be heard as detuning between two mixed sources.
   */
  readonly audibleVoices?: () => number;
}

/**
 * The only module allowed to touch `currentTime`, `play()`, `pause()` and
 * `playbackRate` on either element. A is the master clock, B follows.
 */
export interface SyncEngine {
  /** Waits for readyState >= 3 on both, aligns them, then plays; rejects on media error. */
  play(): Promise<void>;
  /** Pauses both and cancels drift sampling. */
  pause(): void;
  /** Pauses when playing, resumes when paused. */
  togglePlay(): Promise<void>;
  /** Seeks the playhead of both videos to an absolute time, clamped to the timeline. */
  seek(seconds: number): void;
  /** Absolute seek by a delta; used by the +/-1 s shortcuts. */
  seekBy(deltaSeconds: number): void;
  /** Frame step in whole frames using A's estimated fps (FALLBACK_FPS before sampling). */
  stepFrames(frames: number): void;
  /** Pointer went down on the scrubber: pauses both and starts rAF-throttled seeking. */
  beginScrub(): void;
  /** Latest scrub position; the actual seek is throttled to one per animation frame. */
  scrubTo(seconds: number): void;
  /** Pointer released: applies the final position and resumes if it was playing. */
  endScrub(): void;
  /** Applied to both elements; playback is re-anchored so a rate change stays in sync. */
  setSpeed(speed: PlaybackSpeed): void;
  setLoop(loop: boolean): void;
  /** Exchanges which element is the master clock; keeps the playhead. */
  swap(): void;
  /**
   * Switches between linked playback (A is the clock, B follows) and independent playback
   * (each video on its own transport). Enabling pauses both; disabling pauses both and
   * hard-seeks B onto A's playhead.
   */
  setIndependent(independent: boolean): void;
  isIndependent(): boolean;
  /** Independent mode: starts or stops one video, leaving the other alone. */
  toggleSlot(slot: SlotId): Promise<void>;
  /** Independent mode: pauses one video (no-op when it is already paused). */
  pauseSlot(slot: SlotId): void;
  /** Independent mode: true while that video's element is running. */
  isSlotPlaying(slot: SlotId): boolean;
  /** Independent mode: absolute seek of one video, clamped to its own duration. */
  seekSlot(slot: SlotId, seconds: number): void;
  /** Independent mode: pause one video and step it by whole frames of its own rate. */
  stepSlotFrames(slot: SlotId, frames: number): void;
  /** Independent mode: pointer down on one row's scrubber. */
  beginSlotScrub(slot: SlotId): void;
  /** Independent mode: newest position for one row, applied once per animation frame. */
  scrubSlotTo(slot: SlotId, seconds: number): void;
  /** Independent mode: pointer released on one row's scrubber. */
  endSlotScrub(slot: SlotId): void;
  /** Playhead of one video in seconds (linked mode: the shared playhead). */
  getSlotTime(slot: SlotId): number;
  /** Duration of one video in seconds; NaN until its metadata is known. */
  getSlotDuration(slot: SlotId): number;
  /** Playhead in seconds, read from the element that currently owns the clock. */
  getCurrentTime(): number;
  /** min(durationA, durationB), or NaN while unknown. */
  getTimelineDuration(): number;
  /** True while the engine considers playback running. */
  isPlaying(): boolean;
  /**
   * Aligns the external track with the picture after its source was loaded, replaced or
   * removed.
   *
   * The track is a separate media element, so nothing else starts it: without this the mixer
   * has already silenced both videos (the track is the audible source) while the track itself
   * sits paused, which is heard as "all the audio is gone". Paused transport only re-aligns.
   */
  attachTrack(): void;
  /** Stops playback, cancels rVFC/rAF callbacks and detaches every listener. */
  destroy(): void;
}

export type SyncEngineFactory = (options: SyncEngineOptions) => SyncEngine;

/** `readyState` at which the element has data for the current position. */
const READY_STATE_PLAYABLE = 3;

/** Every slot id in render order. */
const SLOT_IDS: readonly SlotId[] = ['a', 'b'];

/** One row's scrub gesture in independent mode. */
interface SlotScrubState {
  /** True from pointer down to release. */
  active: boolean;
  /** Whether that slot was running when the gesture started, so release can resume it. */
  resume: boolean;
  /** Newest target that has not been applied yet; newest value wins. */
  pending: number | null;
  frame: number | null;
}

/** Distance from the end of the timeline, in seconds, that counts as finished. */
const END_EPSILON_SECONDS = 0.005;

/** Seeks smaller than this are skipped; they would only cause `seeked` churn. */
const SEEK_EPSILON_SECONDS = 0.001;

/**
 * Shortest gap between two corrective seeks of the external track, in milliseconds.
 *
 * A track whose decoder lags would otherwise be re-seeked (and ducked by the mixer) on every
 * frame, which is heard as a stuttering, half-silent source.
 */
const TRACK_CORRECTION_INTERVAL_MS = 250;

/**
 * Ceiling for the measured seek latency that is added to a hard-seek target, in seconds.
 * A seek takes a while to complete, and the master clock keeps running meanwhile, so
 * seeking B to a *stale* master time always lands it behind by the seek duration.
 */
const MAX_SEEK_LEAD_SECONDS = 0.08;

/** Minimal structural view of rVFC so the engine does not depend on newer DOM typings. */
interface VideoFrameMetadataLike {
  readonly mediaTime: number;
  readonly presentedFrames: number;
}

type VideoFrameCallback = (now: number, metadata: VideoFrameMetadataLike) => void;

interface FrameCallbackHost {
  requestVideoFrameCallback?: (callback: VideoFrameCallback) => number;
  cancelVideoFrameCallback?: (handle: number) => void;
}

/**
 * Everything one slot's frame-rate probe needs.
 *
 * The probe is deliberately independent of the master/follower roles: it samples each
 * element separately, so `swap()` and drift corrections cannot disturb an estimate, and a
 * replaced source can be re-estimated on its own.
 */
interface FpsProbe {
  readonly video: HTMLVideoElement;
  readonly slot: SlotId;
  readonly mediaTimes: number[];
  /** True once an estimate was reported; the probe then stays idle until the source changes. */
  reported: boolean;
  handle: number | null;
}

/**
 * Frame-time samples kept per probe. Only reached by a source the estimator keeps rejecting
 * (e.g. 2 fps), so the buffer cannot grow without bound while a file plays for hours.
 */
const MAX_FPS_SAMPLES = 64;

/**
 * Builds the engine that owns both media elements.
 *
 * A is the master clock and B follows it: A always runs at the speed chosen in the UI, while
 * B may be nudged ±3 % or hard-seeked to catch up. Every decision is delegated to
 * `decideCorrection` in `logic/drift.ts`, so the thresholds live in one pure, tested place.
 */
export function createSyncEngine(options: SyncEngineOptions): SyncEngine {
  const videoA = options.videoA;
  const videoB = options.videoB;
  const handlers: SyncEventHandlers = options.handlers ?? {};

  // Swappable roles: `swap()` exchanges the clock without touching the DOM or the sources.
  let masterVideo: HTMLVideoElement = videoA;
  let followerVideo: HTMLVideoElement = videoB;

  let speed: PlaybackSpeed = options.speed;
  let loop: boolean = options.loop;

  /** Third source: follows A exactly like B does, but never with a rate nudge. */
  const audioTrack = options.audioTrack ?? null;

  /** Intent: true while the pair is meant to be running (including during a stall). */
  let playing = false;
  /** True while both elements are paused because one of them is buffering. */
  let suspended = false;
  let scrubbing = false;
  /** Whether playback must resume when the current scrub ends. */
  let scrubResume = false;
  /** Latest scrub target that has not been applied yet; newest value wins. */
  let scrubPending: number | null = null;
  let scrubFrame: number | null = null;
  let endHandled = false;
  let nudging = false;
  let frameHandle: number | null = null;
  let frameViaVideoCallback = false;
  /** Incremented by every pause/replacement so stale async work can recognise itself. */
  let playToken = 0;
  let destroyed = false;
  /** Lead applied to a hard-seek target so B lands level instead of one seek behind. */
  let seekLeadSeconds = 0;
  /** True while the first drift sample after a hard seek is still outstanding. */
  let awaitingSeekResidual = false;
  /** `performance.now()` of the last corrective seek of the external track. */
  let lastTrackSeekAt = 0;

  /**
   * Independent mode: no master, no follower, no correction. Each element is driven by its own
   * transport row and clamped to its own duration, which is the only way to inspect two files
   * of different lengths that were never meant to line up.
   */
  let independent = false;
  const slotPlaying: Record<SlotId, boolean> = { a: false, b: false };
  const slotScrubs: Record<SlotId, SlotScrubState> = {
    a: { active: false, resume: false, pending: null, frame: null },
    b: { active: false, resume: false, pending: null, frame: null },
  };
  /** Animation frame that keeps the per-slot readouts moving. */
  let slotFrameHandle: number | null = null;

  const removers: Array<() => void> = [];
  const readyWaiters = new Set<() => void>();

  /**
   * Last reported estimate per slot. The A slot's value drives frame stepping, so the
   * control always steps the picture that is actually on the left of the divider.
   */
  const slotFps: Record<SlotId, number | null> = { a: null, b: null };

  const fpsProbes: Record<SlotId, FpsProbe> = {
    a: { video: videoA, slot: 'a', mediaTimes: [], reported: false, handle: null },
    b: { video: videoB, slot: 'b', mediaTimes: [], reported: false, handle: null },
  };


  function listenOn(target: EventTarget, type: string, listener: EventListener): void {
    target.addEventListener(type, listener);
    removers.push(() => target.removeEventListener(type, listener));
  }

  function timeline(): number {
    return timelineDuration(videoA.duration, videoB.duration);
  }

  /** The element behind a slot id. Roles swap, the elements never do. */
  function slotElement(slot: SlotId): HTMLVideoElement {
    return slot === 'a' ? videoA : videoB;
  }

  /** A slot's own length, or NaN while it is unknown. Never the shared timeline. */
  function slotOwnDuration(slot: SlotId): number {
    const { duration } = slotElement(slot);

    return Number.isFinite(duration) && duration > 0 ? duration : Number.NaN;
  }

  function emitSlotTime(slot: SlotId): void {
    handlers.slotTimeUpdate?.(slot, slotElement(slot).currentTime, slotOwnDuration(slot));
  }

  function announceSlot(slot: SlotId, playing: boolean): void {
    handlers.slotPlayStateChange?.(slot, playing);
  }

  function anySlotPlaying(): boolean {
    return slotPlaying.a || slotPlaying.b;
  }

  function anySlotScrubbing(): boolean {
    return slotScrubs.a.active || slotScrubs.b.active;
  }

  /**
   * True when this slot shows *A* — that is, when it holds the master element.
   *
   * In linked mode the master may be either element after `swap()`, and the external track
   * always follows A. In independent mode roles are fixed, so this is simply the A element.
   */
  function slotIsReference(slot: SlotId): boolean {
    return slotElement(slot) === masterVideo;
  }

  /** Clamps a time to [0, min(durationA, durationB)]; unclamped when a duration is unknown. */
  function clampTime(seconds: number): number {
    const limit = timeline();
    const safe = Number.isFinite(seconds) ? Math.max(seconds, 0) : 0;

    return Number.isFinite(limit) && limit > 0 ? Math.min(safe, limit) : safe;
  }

  function emitTime(seconds: number): void {
    handlers.timeUpdate?.(seconds, timeline());
  }

  function readyForPlayback(): boolean {
    return (
      videoA.readyState >= READY_STATE_PLAYABLE && videoB.readyState >= READY_STATE_PLAYABLE
    );
  }

  function setRate(video: HTMLVideoElement, rate: number): void {
    if (!Number.isFinite(rate) || rate <= 0) {
      return;
    }

    if (Math.abs(video.playbackRate - rate) < 1e-4) {
      return;
    }

    video.playbackRate = rate;
  }

  /** Both elements return to the selected speed and the nudge bookkeeping is cleared. */
  function restoreRates(): void {
    setRate(masterVideo, speed);
    setRate(followerVideo, speed);

    if (audioTrack !== null) {
      audioTrack.playbackRate = speed;
    }

    nudging = false;
  }

  /** True once the track element actually has a file attached. */
  function trackHasSource(): boolean {
    return audioTrack !== null && audioTrack.src.length > 0;
  }

  function pauseTrack(): void {
    if (audioTrack !== null && !audioTrack.paused) {
      audioTrack.pause();
    }
  }

  function seekTrack(seconds: number, force: boolean): void {
    if (audioTrack === null || !trackHasSource()) {
      return;
    }

    if (force || Math.abs(audioTrack.currentTime - seconds) > SEEK_EPSILON_SECONDS) {
      audioTrack.currentTime = seconds;
    }
  }

  /**
   * Starts the track at one time, in step with the videos.
   *
   * A failure here is swallowed on purpose: a track that cannot play must never take the
   * pictures down with it. The mixer keeps the channel silent when no track is loaded, so an
   * absent or broken track is simply inaudible.
   */
  function playTrack(at: number): void {
    if (audioTrack === null || !trackHasSource()) {
      return;
    }

    audioTrack.playbackRate = speed;
    seekTrack(at, true);

    void audioTrack.play().catch(() => undefined);
  }

  /**
   * True while the picture the track belongs to is actually running.
   *
   * Linked mode: the pair is playing and not parked on a stall. Independent mode: the A row,
   * because the track is A's soundtrack and B may run on its own.
   */
  function trackShouldRun(): boolean {
    return independent ? slotPlaying.a : playing && !suspended;
  }

  /**
   * Keeps the external track on the picture's time.
   *
   * Deliberately hard-seek only: a ±3 % rate nudge is a pitch change, and this element is the
   * one the user is actually listening to when it is loaded. The seek is ducked by the mixer,
   * so the correction is heard as a short dip rather than a click.
   */
  function correctTrack(): void {
    if (audioTrack === null || !trackHasSource() || audioTrack.seeking) {
      return;
    }

    // Only a running track can drift. A paused element's clock is frozen, so every sample
    // would look like a huge drift; correcting it would seek and duck a silent source on every
    // frame and leave its gain stuck at zero.
    if (audioTrack.paused || !trackShouldRun()) {
      return;
    }

    // A decoder that is consistently behind would be re-seeked on every frame; one correction
    // per interval is enough to keep the track on the picture.
    const now = performance.now();

    if (now - lastTrackSeekAt < TRACK_CORRECTION_INTERVAL_MS) {
      return;
    }

    const { currentTime } = masterVideo;

    // A track shorter than the videos simply runs out; correcting it forever would seek it to
    // the same clamped value on every frame.
    if (
      audioTrack.ended ||
      (Number.isFinite(audioTrack.duration) && currentTime >= audioTrack.duration - END_EPSILON_SECONDS)
    ) {
      return;
    }

    const drift = audioTrack.currentTime - currentTime;

    if (!Number.isFinite(drift) || Math.abs(drift) <= DRIFT_HARD_SEEK_SECONDS) {
      return;
    }

    lastTrackSeekAt = now;
    handlers.audioCorrection?.('track');
    audioTrack.currentTime = clampTime(currentTime);
  }

  /**
   * Brings the external track in line after its source was loaded, replaced or removed.
   *
   * Nothing else starts the track: it is a separate media element, while the mixer has already
   * silenced both videos because the track is the audible source. Loading a file during
   * playback without this leaves the whole comparison silent. When the picture is paused only
   * the position is set, so the track is ready to run with the next Play.
   */
  function attachTrack(): void {
    if (destroyed) {
      return;
    }

    if (!trackHasSource()) {
      pauseTrack();
      return;
    }

    // The track is A's soundtrack, so it follows the A picture: the A row in independent mode,
    // the clock element otherwise.
    const anchor = independent ? videoA : masterVideo;

    if (trackShouldRun()) {
      playTrack(anchor.currentTime);
      lastTrackSeekAt = performance.now();
      return;
    }

    pauseTrack();
    seekTrack(anchor.currentTime, true);
  }

  /* -------------------------------------------------------------------------
     Independent mode: per-slot transport
     ------------------------------------------------------------------------- */

  function stopSlotFrames(): void {
    if (slotFrameHandle === null) {
      return;
    }

    window.cancelAnimationFrame(slotFrameHandle);
    slotFrameHandle = null;
  }

  function scheduleSlotFrames(): void {
    if (destroyed || !independent || slotFrameHandle !== null) {
      return;
    }

    slotFrameHandle = window.requestAnimationFrame(tickSlots);
  }

  /**
   * Keeps both readouts alive while anything runs. No correction, no alignment: the whole
   * point is that the two positions are allowed to differ.
   */
  function tickSlots(): void {
    slotFrameHandle = null;

    if (destroyed || !independent) {
      return;
    }

    for (const slot of SLOT_IDS) {
      if (slotPlaying[slot]) {
        emitSlotTime(slot);
      }
    }

    if (anySlotPlaying() || anySlotScrubbing()) {
      scheduleSlotFrames();
    }
  }

  /** Cancels every pending row seek and drops the play intent of both slots. */
  function pauseAllSlots(): void {
    for (const slot of SLOT_IDS) {
      const scrub = slotScrubs[slot];

      if (scrub.frame !== null) {
        window.cancelAnimationFrame(scrub.frame);
        scrub.frame = null;
      }

      scrub.active = false;
      scrub.resume = false;
      scrub.pending = null;

      const wasPlaying = slotPlaying[slot];
      slotPlaying[slot] = false;

      if (wasPlaying) {
        announceSlot(slot, false);
        emitSlotTime(slot);
      }
    }

    stopSlotFrames();
  }

  /**
   * Stops one element and clears its play intent.
   *
   * The element is paused even when the flag says it is not: the flag tracks intent, and a
   * browser that refused `play()` leaves the flag false while a previous attempt may still be
   * in flight.
   */
  function pauseSlotInternal(slot: SlotId): void {
    const element = slotElement(slot);

    if (!element.paused) {
      element.pause();
    }

    if (independent && slotIsReference(slot)) {
      pauseTrack();
    }

    const wasPlaying = slotPlaying[slot];
    slotPlaying[slot] = false;

    if (wasPlaying) {
      announceSlot(slot, false);
      emitSlotTime(slot);
    }

    if (!anySlotPlaying() && !anySlotScrubbing()) {
      stopSlotFrames();
    }
  }

  async function playSlotInternal(slot: SlotId): Promise<void> {
    if (destroyed || !independent || slotScrubs[slot].active) {
      return;
    }

    const element = slotElement(slot);
    const start = slotPlayStart(element.currentTime, element.duration);

    // A slot parked on its last frame starts over instead of doing nothing.
    if (Math.abs(start - element.currentTime) > SEEK_EPSILON_SECONDS) {
      element.currentTime = start;
    }

    setRate(element, speed);

    // The external track is A's soundtrack; it runs whenever A runs.
    if (slotIsReference(slot)) {
      playTrack(element.currentTime);
    }

    try {
      await element.play();
    } catch {
      // A refused slot stays paused; the other picture keeps playing, which is the point of
      // independent mode. Nothing is reported as an alignment failure.
      return;
    }

    if (destroyed || !independent || element.paused) {
      return;
    }

    slotPlaying[slot] = true;
    announceSlot(slot, true);
    emitSlotTime(slot);
    scheduleSlotFrames();
  }

  /** One slot reached its own end; the other is untouched. */
  function handleSlotEnd(slot: SlotId): void {
    if (destroyed || !independent || !slotPlaying[slot]) {
      return;
    }

    const element = slotElement(slot);

    if (loop) {
      element.currentTime = 0;
      setRate(element, speed);

      if (slotIsReference(slot)) {
        playTrack(0);
      }

      emitSlotTime(slot);

      void element.play().catch(() => {
        pauseSlotInternal(slot);
      });

      return;
    }

    slotPlaying[slot] = false;
    announceSlot(slot, false);
    emitSlotTime(slot);

    if (!anySlotPlaying()) {
      if (slotIsReference(slot)) {
        pauseTrack();
      }

      stopSlotFrames();
    }
  }

  function pauseBoth(): void {
    if (!videoA.paused) {
      videoA.pause();
    }

    if (!videoB.paused) {
      videoB.pause();
    }

    pauseTrack();
  }

  /**
   * Moves both elements to one time. `force` is used after seeks and alignment, where the
   * elements must land on the exact same value even if they are already close.
   */
  function applyTime(seconds: number, force: boolean): void {
    const target = clampTime(seconds);

    // Any seek of our own invalidates a pending post-hard-seek residual measurement.
    awaitingSeekResidual = false;

    for (const video of [videoA, videoB]) {
      if (force || Math.abs(video.currentTime - target) > SEEK_EPSILON_SECONDS) {
        video.currentTime = target;
      }
    }

    seekTrack(target, force);
    emitTime(target);
  }

  function samplingAllowed(): boolean {
    return !destroyed && playing && !suspended && !scrubbing;
  }

  function stopSampling(): void {
    if (frameHandle === null) {
      return;
    }

    if (frameViaVideoCallback) {
      const host = masterVideo as unknown as FrameCallbackHost;
      host.cancelVideoFrameCallback?.(frameHandle);
    } else {
      window.cancelAnimationFrame(frameHandle);
    }

    frameHandle = null;
    frameViaVideoCallback = false;
  }

  function stopProbe(probe: FpsProbe): void {
    if (probe.handle === null) {
      return;
    }

    (probe.video as unknown as FrameCallbackHost).cancelVideoFrameCallback?.(probe.handle);
    probe.handle = null;
  }

  function stopFpsProbes(): void {
    stopProbe(fpsProbes.a);
    stopProbe(fpsProbes.b);
  }

  /** A probe only runs while the pair is actually decoding pictures for the user. */
  function probeAllowed(probe: FpsProbe): boolean {
    return (
      !destroyed &&
      playing &&
      !suspended &&
      !scrubbing &&
      !probe.reported &&
      document.visibilityState === 'visible'
    );
  }

  function startProbe(probe: FpsProbe): void {
    if (probe.handle !== null || !probeAllowed(probe)) {
      return;
    }

    const host = probe.video as unknown as FrameCallbackHost;

    // Without rVFC there is no `mediaTime`, and a timer-derived guess would be a fake
    // number on screen. The info bar keeps `—` and stepping stays on the 30 fps fallback.
    if (typeof host.requestVideoFrameCallback !== 'function') {
      return;
    }

    probe.handle = host.requestVideoFrameCallback((_now, metadata) => {
      onProbeFrame(probe, metadata);
    });
  }

  /**
   * One sample per presented frame. The estimator needs a handful of frames, so a probe
   * stops itself as soon as it has a result and never reports twice for the same source.
   */
  function onProbeFrame(probe: FpsProbe, metadata: VideoFrameMetadataLike): void {
    probe.handle = null;

    if (!probeAllowed(probe)) {
      return;
    }

    probe.mediaTimes.push(metadata.mediaTime);

    if (probe.mediaTimes.length > MAX_FPS_SAMPLES) {
      probe.mediaTimes.shift();
    }

    const estimate = estimateFps(probe.mediaTimes);

    if (estimate !== null) {
      probe.reported = true;
      slotFps[probe.slot] = estimate.fps;
      handlers.fpsEstimate?.(probe.slot, estimate.fps);
      return;
    }

    startProbe(probe);
  }

  function startFpsProbes(): void {
    startProbe(fpsProbes.a);
    startProbe(fpsProbes.b);
  }

  /** A new source invalidates its estimate: different file, different frame rate. */
  function resetFpsProbe(slot: SlotId): void {
    const probe = fpsProbes[slot];

    stopProbe(probe);
    probe.mediaTimes.length = 0;
    probe.reported = false;
    slotFps[slot] = null;
  }

  function scheduleFrame(): void {
    if (!samplingAllowed() || frameHandle !== null) {
      return;
    }

    const host = masterVideo as unknown as FrameCallbackHost;

    if (typeof host.requestVideoFrameCallback === 'function') {
      frameViaVideoCallback = true;
      frameHandle = host.requestVideoFrameCallback(onFrame);
      return;
    }

    // Anything without rVFC (older Safari): identical logic on requestAnimationFrame.
    frameViaVideoCallback = false;
    frameHandle = window.requestAnimationFrame(onFrame);
  }

  function onFrame(): void {
    frameHandle = null;
    frameViaVideoCallback = false;

    if (!samplingAllowed()) {
      return;
    }

    sampleDrift();
    emitTime(masterVideo.currentTime);

    if (!samplingAllowed()) {
      return;
    }

    if (reachedTimelineEnd()) {
      handleEnd();
      return;
    }

    scheduleFrame();
  }

  /** Keeps the seek lead inside the sane range, and rejects NaN/infinity from a bad sample. */
  function clampLead(seconds: number): number {
    if (!Number.isFinite(seconds)) {
      return 0;
    }

    return Math.min(Math.max(seconds, 0), MAX_SEEK_LEAD_SECONDS);
  }

  /**
   * Drift strategy
   * --------------
   * A is the master clock; only B is ever corrected. Every master frame we measure
   *
   *     drift = B.currentTime - A.currentTime        (positive = B is ahead)
   *
   * and hand it to `decideCorrection` in `logic/drift.ts`, which owns all thresholds:
   *
   *   |drift| < 10 ms   → 'none'      B returns to the selected speed, nothing visible
   *   10 ms … 40 ms     → 'nudge'     B runs 3 % slower while ahead and 3 % faster while
   *                                   behind, so it converges without a jump in the picture
   *   |drift| > 40 ms   → 'hardSeek'  catching up would take too long; B jumps to A's time
   *
   * The decision is recomputed from the base rate on every sample, so identical measurements
   * can never disagree and no hidden state can make the correction oscillate. `nudging` is
   * only reported; it is cleared on every pause, seek, swap and speed change so a nudged
   * rate can never outlive the state that justified it.
   *
   * A hard seek is the one place the engine adds anything to the pure decision: it aims the
   * seek slightly ahead by the measured seek latency (see `awaitingSeekResidual`), otherwise
   * every seek lands B behind again and the pair can never leave the hard-seek band.
   */
  function sampleDrift(): void {
    // A seek in progress makes `currentTime` a mid-flight value, so the measurement would be
    // meaningless; wait for the next frame instead of stacking repeat corrections.
    if (masterVideo.seeking || followerVideo.seeking) {
      return;
    }

    const driftSeconds = followerVideo.currentTime - masterVideo.currentTime;

    if (awaitingSeekResidual) {
      awaitingSeekResidual = false;
      // The lead L is applied to the master time T and the seek costs τ, so B arrives at
      // T + L while A has reached T + τ — the first sample is therefore L - τ. Subtracting
      // it from the lead recovers τ, and the next hard seek lands B level with A.
      seekLeadSeconds = clampLead(seekLeadSeconds - driftSeconds);
    }

    // The external track is corrected on its own rule (hard seek only), independently of B:
    // it must happen even when B is already in sync.
    correctTrack();

    const decision = decideCorrection({
      driftSeconds,
      basePlaybackRate: speed,
      nudging,
      // With two soundtracks open, a ±3 % rate bias on B is heard as detuning; the pure
      // decider drops the nudge in that case and keeps the hard seek.
      audibleVoices: options.audibleVoices?.() ?? 1,
    });

    if (decision.action === 'hardSeek') {
      nudging = false;
      setRate(followerVideo, decision.playbackRate);

      const target = clampTime(masterVideo.currentTime + seekLeadSeconds);

      if (Math.abs(followerVideo.currentTime - target) > SEEK_EPSILON_SECONDS) {
        // A seek flushes the decoder, so the follower's audio would drop out for the length
        // of the rebuild. Letting the composition root duck that source around the seek turns
        // an audible click/dropout into a short, smooth dip.
        handlers.audioCorrection?.('b');
        awaitingSeekResidual = true;
        followerVideo.currentTime = target;
      }

      return;
    }

    nudging = decision.action === 'nudge';
    setRate(followerVideo, decision.playbackRate);
  }

  function reachedTimelineEnd(): boolean {
    const limit = timeline();

    if (!Number.isFinite(limit) || limit <= 0) {
      return false;
    }

    return masterVideo.currentTime >= limit - END_EPSILON_SECONDS;
  }

  function handleEnd(): void {
    if (destroyed || endHandled || !playing) {
      return;
    }

    endHandled = true;

    if (loop) {
      restartFromStart();
      return;
    }

    pause();
    // Pin both elements on the exact end so the readout and the last frame agree.
    applyTime(timeline(), true);
    handlers.ended?.();
  }

  /** Loop: both elements jump back to 0 and keep running; the play state never flickers. */
  function restartFromStart(): void {
    restoreRates();

    for (const video of [videoA, videoB]) {
      video.currentTime = 0;
    }

    endHandled = false;
    emitTime(0);

    playTrack(0);

    void Promise.all([masterVideo.play(), followerVideo.play()]).catch(() => {
      // A failed restart leaves the pair paused instead of silently desynced.
      pause();
    });

    startFpsProbes();
    scheduleFrame();
  }

  /**
   * `waiting`/`stalled` on either element pauses *both* so one never runs ahead of the
   * other. The play intent survives, so `handleRecoverable` can resume the pair once both
   * elements are playable again.
   */
  function handleStall(): void {
    if (destroyed || !playing || suspended || scrubbing) {
      return;
    }

    // A media element also emits `waiting` while it seeks — including for our own drift
    // corrections. Only a stall outside a seek means the decoder has actually run dry.
    if (masterVideo.seeking || followerVideo.seeking) {
      return;
    }

    suspended = true;
    stopSampling();
    stopFpsProbes();
    restoreRates();
    pauseBoth();
  }

  function handleRecoverable(): void {
    if (destroyed || !playing || !suspended || scrubbing) {
      return;
    }

    if (!readyForPlayback()) {
      return;
    }

    suspended = false;

    // While suspended the master clock did not advance, so re-aligning is cheap and keeps
    // B from resuming with whatever drift accumulated before the stall.
    applyTime(masterVideo.currentTime, true);
    playTrack(masterVideo.currentTime);

    void Promise.all([masterVideo.play(), followerVideo.play()]).catch(() => {
      pause();
    });

    startFpsProbes();
    scheduleFrame();
  }

  /** Resolves every pending readiness waiter; used by pause, replacement and destroy. */
  function cancelReadyWaiters(): void {
    for (const cancel of [...readyWaiters]) {
      cancel();
    }

    readyWaiters.clear();
  }

  function reportMediaError(slot: SlotId): string {
    const video = slot === 'a' ? videoA : videoB;
    const kind = classifyMediaError(video.error?.code ?? null);
    const fallback = `Video ${slot.toUpperCase()}`;
    const message = mediaErrorMessage(kind, fallback);

    handlers.mediaError?.(slot, kind, message);

    return message;
  }

  /**
   * Waits until both elements report `readyState >= 3`. Resolves early when the source is
   * emptied (replaced while we waited) so the caller can check its token and bail out.
   */
  function waitUntilPlayable(): Promise<void> {
    if (readyForPlayback()) {
      return Promise.resolve();
    }

    return new Promise<void>((resolve, reject) => {
      const entries: Array<{ readonly target: EventTarget; readonly type: string; readonly listener: EventListener }> = [];

      const detach = (): void => {
        for (const entry of entries) {
          entry.target.removeEventListener(entry.type, entry.listener);
        }

        readyWaiters.delete(cancel);
      };

      const finish = (): void => {
        detach();
        resolve();
      };

      const cancel = (): void => {
        finish();
      };

      const readyTypes = ['canplay', 'canplaythrough', 'loadeddata', 'loadedmetadata', 'progress'];

      for (const video of [videoA, videoB]) {
        for (const type of readyTypes) {
          const listener: EventListener = () => {
            if (readyForPlayback()) {
              finish();
            }
          };

          video.addEventListener(type, listener);
          entries.push({ target: video, type, listener });
        }

        const onError: EventListener = () => {
          detach();
          reject(new Error(reportMediaError(video === videoA ? 'a' : 'b')));
        };

        const onEmptied: EventListener = () => {
          cancel();
        };

        video.addEventListener('error', onError);
        video.addEventListener('emptied', onEmptied);
        entries.push({ target: video, type: 'error', listener: onError });
        entries.push({ target: video, type: 'emptied', listener: onEmptied });
      }

      readyWaiters.add(cancel);
    });
  }

  async function play(): Promise<void> {
    if (destroyed || playing) {
      return;
    }

    // In independent mode the shared Play button means "run both", each from its own position.
    if (independent) {
      await Promise.all([playSlotInternal('a'), playSlotInternal('b')]);
      return;
    }

    const limit = timeline();

    if (!Number.isFinite(limit) || limit <= 0) {
      return;
    }

    const token = ++playToken;
    await waitUntilPlayable();

    if (destroyed || token !== playToken) {
      return;
    }

    // Replaying after the end starts over instead of sitting on the last frame.
    const resumeAt = masterVideo.currentTime >= limit - END_EPSILON_SECONDS
      ? 0
      : masterVideo.currentTime;

    restoreRates();
    applyTime(resumeAt, true);
    playTrack(resumeAt);
    endHandled = false;
    suspended = false;
    playing = true;

    try {
      await Promise.all([masterVideo.play(), followerVideo.play()]);
    } catch (error) {
      if (!destroyed && token === playToken) {
        playing = false;
        suspended = false;
        stopSampling();
        stopFpsProbes();
        restoreRates();
        pauseBoth();
        handlers.playStateChange?.(false);
        emitTime(masterVideo.currentTime);
      }

      throw error;
    }

    if (destroyed || token !== playToken || !playing) {
      return;
    }

    handlers.playStateChange?.(true);
    emitTime(masterVideo.currentTime);
    startFpsProbes();
    scheduleFrame();
  }

  function pause(): void {
    if (destroyed) {
      return;
    }

    // Cancels any in-flight play()/readiness wait and sampling loop.
    playToken += 1;
    cancelReadyWaiters();
    stopSampling();
    stopFpsProbes();
    cancelScrubFrame();

    const wasPlaying = playing;

    playing = false;
    suspended = false;
    scrubbing = false;
    scrubResume = false;
    scrubPending = null;
    awaitingSeekResidual = false;

    restoreRates();
    pauseBoth();

    // `pauseBoth` already stopped the elements; this clears the per-slot intent and readouts.
    if (independent) {
      pauseAllSlots();
    }

    if (wasPlaying) {
      handlers.playStateChange?.(false);
    }

    emitTime(masterVideo.currentTime);
  }

  function togglePlay(): Promise<void> {
    if (independent) {
      if (anySlotPlaying()) {
        pause();
        return Promise.resolve();
      }

      return play();
    }

    if (playing) {
      pause();
      return Promise.resolve();
    }

    return play();
  }

  function cancelScrubFrame(): void {
    if (scrubFrame === null) {
      return;
    }

    window.cancelAnimationFrame(scrubFrame);
    scrubFrame = null;
  }

  function seek(seconds: number): void {
    if (destroyed) {
      return;
    }

    // In independent mode a shared seek still means "both, each clamped to its own length":
    // that is what the composition root uses after a file replacement or a swap.
    if (independent) {
      for (const slot of SLOT_IDS) {
        seekSlot(slot, seconds);
      }

      return;
    }

    cancelScrubFrame();
    scrubPending = null;
    endHandled = false;
    restoreRates();
    applyTime(seconds, true);
  }

  function seekBy(deltaSeconds: number): void {
    if (!Number.isFinite(deltaSeconds)) {
      return;
    }

    seek(masterVideo.currentTime + deltaSeconds);
  }

  /**
   * Steps whole frames using A's estimated frame rate, or `FALLBACK_FPS` until the first
   * estimate exists. Stepping pauses first: a moving playhead would make a one-frame
   * difference invisible. The target is applied through `seek()`, so both elements land on
   * exactly the same time instead of each rounding the step on its own.
   */
  function stepFrames(frames: number): void {
    if (destroyed || !Number.isFinite(frames) || frames === 0) {
      return;
    }

    // In independent mode the keyboard steps the reference picture (A). Each row has its own
    // buttons for the other one, so no hidden "which slot is focused" state is involved.
    if (independent) {
      stepSlotFrames('a', frames);
      return;
    }

    if (playing) {
      pause();
    }

    const fps = slotFps.a ?? FALLBACK_FPS;

    seek(frameStepTarget(masterVideo.currentTime, frames, fps));
  }

  /**
   * Pointer down on the scrubber: both elements pause for the duration of the drag, and the
   * previous play intent is remembered so releasing can resume exactly once.
   */
  function beginScrub(): void {
    if (destroyed || scrubbing) {
      return;
    }

    scrubbing = true;
    scrubResume = playing;

    if (!playing) {
      return;
    }

    playToken += 1;
    cancelReadyWaiters();
    stopSampling();
    stopFpsProbes();
    restoreRates();
    playing = false;
    suspended = false;
    awaitingSeekResidual = false;
    pauseBoth();
    handlers.playStateChange?.(false);
  }

  /**
   * Records the newest scrub position and applies it at most once per animation frame;
   * intermediate positions are dropped so a fast drag cannot queue dozens of seeks.
   */
  function scrubTo(seconds: number): void {
    if (destroyed) {
      return;
    }

    const target = clampTime(seconds);
    scrubPending = target;
    emitTime(target);

    if (!scrubbing) {
      // Keyboard or assistive technology on the scrubber: seek immediately.
      cancelScrubFrame();
      applyTime(target, true);
      scrubPending = null;
      return;
    }

    if (scrubFrame !== null) {
      return;
    }

    scrubFrame = window.requestAnimationFrame(() => {
      scrubFrame = null;

      if (destroyed || !scrubbing || scrubPending === null) {
        return;
      }

      const pending = scrubPending;
      scrubPending = null;
      applyTime(pending, true);
    });
  }

  function endScrub(): void {
    if (destroyed) {
      return;
    }

    cancelScrubFrame();

    const wasScrubbing = scrubbing;
    const pending = scrubPending;
    const resume = scrubResume;

    scrubbing = false;
    scrubResume = false;
    scrubPending = null;

    if (!wasScrubbing && pending === null) {
      return;
    }

    // The final position is applied synchronously: no seek is left in flight.
    applyTime(pending ?? masterVideo.currentTime, true);

    if (resume) {
      void play().catch(() => undefined);
    }
  }

  /**
   * Changes the base rate for both elements. While playing, the pair is re-anchored: rates
   * apply, both pause, and playback restarts from the master clock. A rate change makes each
   * decoder re-buffer independently, and a drift hard-seek that lands in that window can
   * leave the follower stuck in `seeking` at readyState 1 for seconds — a controlled restart
   * is one hitch instead of a visible desync.
   */
  function setSpeed(next: PlaybackSpeed): void {
    if (destroyed) {
      return;
    }

    const wasPlaying = playing;

    speed = next;
    restoreRates();

    // Independent mode has nothing to re-anchor: both elements simply continue at the new
    // rate from wherever they are, which is what makes the two pictures drift differently.
    if (independent) {
      return;
    }

    if (!wasPlaying) {
      return;
    }

    pause();
    void play().catch(() => {
      // play() has already paused both and reported the failure.
    });
  }

  function setLoop(next: boolean): void {
    loop = next;
  }

  /** Exchanges the clock: A becomes the follower and vice versa, playhead preserved. */
  function swap(): void {
    if (destroyed) {
      return;
    }

    // Swapping exchanges two sources between elements, which in independent mode would also
    // have to exchange their playheads — a state the mode exists to keep apart. Refused, and
    // the control is disabled while the mode is on.
    if (independent) {
      return;
    }

    const wasSampling = samplingAllowed();
    const time = masterVideo.currentTime;

    stopSampling();
    restoreRates();

    const previousMaster = masterVideo;
    masterVideo = followerVideo;
    followerVideo = previousMaster;

    applyTime(time, true);
    endHandled = false;
    // The new follower may have a different seek latency.
    seekLeadSeconds = 0;

    if (wasSampling) {
      scheduleFrame();
    }
  }

  /**
   * A replaced source empties its element: reset the timeline but keep the settings.
   *
   * Only the emptied slot's frame-rate estimate is discarded — the other file did not change
   * and its estimate is still valid. The playhead is reset only when the master clock is the
   * element that went away; replacing the follower keeps the master's position so the
   * composition root can seek the new file onto it.
   */
  function handleEmptied(emptied: HTMLVideoElement): void {
    if (destroyed) {
      return;
    }

    const emptiedSlot: SlotId = emptied === videoA ? 'a' : 'b';
    const wasPlaying = playing;

    playToken += 1;
    cancelReadyWaiters();
    stopSampling();
    resetFpsProbe(emptiedSlot);
    cancelScrubFrame();

    // A replaced source takes its own transport with it; the other slot keeps running.
    const scrub = slotScrubs[emptiedSlot];

    if (scrub.frame !== null) {
      window.cancelAnimationFrame(scrub.frame);
      scrub.frame = null;
    }

    scrub.active = false;
    scrub.resume = false;
    scrub.pending = null;

    const slotWasPlaying = slotPlaying[emptiedSlot];
    slotPlaying[emptiedSlot] = false;

    playing = false;
    suspended = false;
    scrubbing = false;
    scrubResume = false;
    scrubPending = null;
    endHandled = false;
    awaitingSeekResidual = false;
    seekLeadSeconds = 0;

    restoreRates();

    if (independent) {
      announceSlot(emptiedSlot, false);
      emitSlotTime(emptiedSlot);

      if (!anySlotPlaying()) {
        stopSlotFrames();
      }
    }

    emitTime(emptied === masterVideo ? 0 : masterVideo.currentTime);

    if (wasPlaying || slotWasPlaying) {
      handlers.playStateChange?.(false);
    }
  }

  /** rVFC and rAF stop in background tabs; drift is corrected again once visible. */
  function handleVisibilityChange(): void {
    if (destroyed) {
      return;
    }

    if (document.visibilityState !== 'visible') {
      stopSampling();
      stopFpsProbes();
      stopSlotFrames();
      return;
    }

    if (independent) {
      // rAF does not run in a background tab; the rows resume where the elements are.
      for (const slot of SLOT_IDS) {
        emitSlotTime(slot);
      }

      if (anySlotPlaying() || anySlotScrubbing()) {
        scheduleSlotFrames();
      }

      return;
    }

    if (samplingAllowed()) {
      startFpsProbes();
      scheduleFrame();
    }
  }

  /* -------------------------------------------------------------------------
     Independent mode: public transport API
     ------------------------------------------------------------------------- */

  function setIndependent(enabled: boolean): void {
    if (destroyed || enabled === independent) {
      return;
    }

    if (enabled) {
      // Linked playback owns both elements; stop it before handing each one its own control.
      pause();
      independent = true;

      for (const slot of SLOT_IDS) {
        slotPlaying[slot] = false;
        emitSlotTime(slot);
      }

      return;
    }

    // Back to linked playback: nothing may keep running while B is being moved onto A.
    for (const slot of SLOT_IDS) {
      pauseSlotInternal(slot);
    }

    pauseAllSlots();
    independent = false;

    // The one rule that makes the switch feel reversible: B lands exactly on A's picture.
    applyTime(masterVideo.currentTime, true);
    endHandled = false;
    seekLeadSeconds = 0;
  }

  function seekSlot(slot: SlotId, seconds: number): void {
    if (destroyed) {
      return;
    }

    const element = slotElement(slot);
    const target = clampSlotTime(seconds, element.duration);

    if (Math.abs(element.currentTime - target) > SEEK_EPSILON_SECONDS) {
      element.currentTime = target;
    }

    if (independent && slotIsReference(slot)) {
      seekTrack(target, true);
    }

    emitSlotTime(slot);
  }

  function stepSlotFrames(slot: SlotId, frames: number): void {
    if (destroyed || !independent || !Number.isFinite(frames) || frames === 0) {
      return;
    }

    // Stepping is a paused operation: a one-frame difference is invisible in motion.
    pauseSlotInternal(slot);

    const element = slotElement(slot);

    seekSlot(slot, slotStepTarget(element.currentTime, frames, slotFps[slot], element.duration));
  }

  function beginSlotScrub(slot: SlotId): void {
    if (destroyed || !independent) {
      return;
    }

    const scrub = slotScrubs[slot];

    if (scrub.active) {
      return;
    }

    scrub.active = true;
    scrub.resume = slotPlaying[slot];
    pauseSlotInternal(slot);
    scheduleSlotFrames();
  }

  function scrubSlotTo(slot: SlotId, seconds: number): void {
    if (destroyed || !independent) {
      return;
    }

    const element = slotElement(slot);
    const scrub = slotScrubs[slot];
    const target = clampSlotTime(seconds, element.duration);

    scrub.pending = target;

    // Echo the target immediately so the readout follows the thumb, not the decoder.
    handlers.slotTimeUpdate?.(slot, target, slotOwnDuration(slot));

    if (!scrub.active) {
      // Keyboard or assistive technology on the row's scrubber: seek immediately.
      seekSlot(slot, target);
      scrub.pending = null;
      return;
    }

    if (scrub.frame !== null) {
      return;
    }

    scrub.frame = window.requestAnimationFrame(() => {
      scrub.frame = null;

      if (destroyed || !independent || !scrub.active || scrub.pending === null) {
        return;
      }

      const pending = scrub.pending;
      scrub.pending = null;
      seekSlot(slot, pending);
    });
  }

  function endSlotScrub(slot: SlotId): void {
    if (destroyed) {
      return;
    }

    const scrub = slotScrubs[slot];

    if (scrub.frame !== null) {
      window.cancelAnimationFrame(scrub.frame);
      scrub.frame = null;
    }

    const wasScrubbing = scrub.active;
    const pending = scrub.pending;
    const resume = scrub.resume;

    scrub.active = false;
    scrub.resume = false;
    scrub.pending = null;

    if (!wasScrubbing && pending === null) {
      return;
    }

    // The final position is applied synchronously: no seek is left in flight.
    seekSlot(slot, pending ?? slotElement(slot).currentTime);

    if (resume) {
      void playSlotInternal(slot).catch(() => undefined);
    } else if (!anySlotPlaying()) {
      stopSlotFrames();
    }
  }

  function pauseSlot(slot: SlotId): void {
    if (destroyed || !independent) {
      return;
    }

    pauseSlotInternal(slot);
  }

  function destroy(): void {
    if (destroyed) {
      return;
    }

    destroyed = true;
    playToken += 1;
    cancelReadyWaiters();
    stopSampling();
    stopFpsProbes();
    cancelScrubFrame();

    playing = false;
    suspended = false;
    scrubbing = false;
    scrubPending = null;

    stopSlotFrames();
    pauseAllSlots();
    independent = false;

    restoreRates();
    pauseBoth();

    for (const remove of removers) {
      remove();
    }

    removers.length = 0;
  }

  for (const video of [videoA, videoB]) {
    listenOn(video, 'waiting', handleStall);
    listenOn(video, 'stalled', handleStall);
    listenOn(video, 'canplay', handleRecoverable);
    listenOn(video, 'canplaythrough', handleRecoverable);
    listenOn(video, 'loadeddata', handleRecoverable);
    listenOn(video, 'seeked', handleRecoverable);
    listenOn(video, 'emptied', () => {
      handleEmptied(video);
    });
    listenOn(video, 'ended', () => {
      if (independent) {
        handleSlotEnd(video === videoA ? 'a' : 'b');
        return;
      }

      if (playing) {
        handleEnd();
      }
    });
    listenOn(video, 'error', () => {
      reportMediaError(video === videoA ? 'a' : 'b');

      if (playing) {
        pause();
      }
    });
  }

  listenOn(document, 'visibilitychange', handleVisibilityChange);

  return {
    play,
    pause,
    togglePlay,
    seek,
    seekBy,
    stepFrames,
    beginScrub,
    scrubTo,
    endScrub,
    setSpeed,
    setLoop,
    swap,
    setIndependent,
    isIndependent: () => independent,
    toggleSlot: (slot) =>
      slotPlaying[slot]
        ? Promise.resolve(pauseSlotInternal(slot))
        : playSlotInternal(slot),
    pauseSlot,
    isSlotPlaying: (slot) => slotPlaying[slot],
    seekSlot,
    stepSlotFrames,
    beginSlotScrub,
    scrubSlotTo,
    endSlotScrub,
    getSlotTime: (slot) => slotElement(slot).currentTime,
    getSlotDuration: slotOwnDuration,
    getCurrentTime: () => masterVideo.currentTime,
    getTimelineDuration: timeline,
    isPlaying: () => (independent ? anySlotPlaying() : playing),
    attachTrack,
    destroy,
  };
}



