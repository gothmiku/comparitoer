import './styles.css';

import { createAudioMixer } from './audio';
import type { AudioMixer } from './audio';
import {
  MAX_CONVERSION_BYTES,
  conversionCancelledMessage,
  conversionLimitMessage,
  proxyWarning,
} from './logic/codec';
import type { ProbeSummary } from './logic/codec';
import {
  audioTrackErrorMessage,
  isProbablyAudioTrack,
  nonAudioTrackMessage,
  trackLabelFromFilename,
} from './logic/audio';
import {
  compareDurations,
  formatToleranceSeconds,
  isValidDuration,
  timelineDuration,
} from './logic/duration';
import {
  isProbablyVideoFile,
  labelFromFilename,
  mediaErrorMessage,
  nonVideoMessage,
} from './logic/file';
import type { MediaErrorKind } from './logic/file';
import { formatTime } from './logic/format';
import { frameIndexAt } from './logic/fps';
import { infoWarnings } from './logic/info';
import type { InfoBarWarning, VideoFacts } from './logic/info';
import {
  audibleSourceCount,
  DEFAULT_AUDIO_MIX,
  isMixSilent,
  nextAudioLevels,
} from './logic/mix';
import { stepTarget } from './logic/step';
import type { StepDirection, StepUnit } from './logic/step';
import { WELCOME_MESSAGE } from './logic/welcome';
import { createMediaLoader } from './media';
import type { MediaLoader } from './media';
import { createInitialState } from './state';
import type { AppState, AudioMix, PlaybackSpeed, SlotId, SlotStatus, VideoSlot } from './state';
import { createSyncEngine } from './sync';
import type { SyncEngine } from './sync';
import type { Transcoder } from './transcode';
import { createControls } from './ui/controls';
import type { Controls } from './ui/controls';
import { createDropzone } from './ui/dropzone';
import type { Dropzone, DropzoneView } from './ui/dropzone';
import { createDurationStatus } from './ui/duration-status';
import type { DurationStatus, DurationStatusView, StatusAction } from './ui/duration-status';
import { createInfoBar } from './ui/infobar';
import type { InfoBar } from './ui/infobar';
import { createMix } from './ui/mix';
import type { MixPanel } from './ui/mix';
import { createSettings } from './ui/settings';
import type { TrackView } from './ui/settings';
import { createShortcutHelp, createShortcuts } from './ui/shortcuts';
import type { ShortcutHelp } from './ui/shortcuts';
import { createStage } from './ui/stage';
import type { Stage } from './ui/stage';
import { createSlotTransport } from './ui/transport';
import type { SlotTransport } from './ui/transport';
import { createWelcome } from './ui/welcome';

const state: AppState = createInitialState();

/**
 * How long the follower's audio is held down around a corrective seek, in milliseconds.
 *
 * A `currentTime` write flushes the decoder, so the soundtrack of the element that was seeked
 * is silent for roughly that long. Covering it with a duck makes the correction a smooth dip
 * instead of a click or a gap.
 */
const CORRECTION_DUCK_MS = 80;

function slotOf(id: SlotId): VideoSlot {
  return id === 'a' ? state.slotA : state.slotB;
}

/** Clears everything `loadedmetadata` produced, keeping the slot's identity. */
function resetMetadata(slot: VideoSlot): void {
  slot.durationSeconds = Number.NaN;
  slot.width = 0;
  slot.height = 0;
  slot.fps = null;
  slot.source = 'native';
  slot.sourceCodec = null;
  slot.sourceDurationSeconds = Number.NaN;
  slot.sourceWidth = 0;
  slot.sourceHeight = 0;
  slot.conversion = null;
}

/** Returns the slot to `empty`: no file, no URL, no metadata. */
function resetSlot(slot: VideoSlot): void {
  slot.file = null;
  slot.objectUrl = null;
  slot.status = 'empty';
  slot.error = null;
  slot.label = '';
  resetMetadata(slot);
}

function zoneView(slot: VideoSlot): DropzoneView {
  return {
    state: slot.status,
    filename: slot.file?.name ?? null,
    error: slot.error,
    conversion: slot.conversion,
  };
}

/** One decimal below 10 ms so a sub-millisecond mismatch never reads as "0 ms". */
function formatDeltaMs(milliseconds: number): string {
  return milliseconds < 10 ? milliseconds.toFixed(1) : String(Math.round(milliseconds));
}

function formatTolerance(seconds: number): string {
  return `${formatToleranceSeconds(seconds)} s`;
}

/** The two slot ids in render order. */
const SLOT_IDS: readonly SlotId[] = ['a', 'b'];

/**
 * The length the duration check compares.
 *
 * A proxy is a temporary stand-in, so when one is playing the check still describes the
 * file the user chose: a conversion must not make two identical clips look different.
 */
function sourceDurationOf(slot: VideoSlot): number {
  return slot.source === 'proxy' && isValidDuration(slot.sourceDurationSeconds)
    ? slot.sourceDurationSeconds
    : slot.durationSeconds;
}

/** The source facts of a proxied slot, shaped like a probe, for the proxy chip. */
function probeOfSlot(slot: VideoSlot): ProbeSummary {
  return {
    videoCodec: slot.sourceCodec,
    audioCodec: null,
    width: slot.sourceWidth,
    height: slot.sourceHeight,
    durationSeconds: slot.sourceDurationSeconds,
  };
}

/** Settings view of the external track; kept next to the other slot-shaped helpers. */
function trackView(): TrackView {
  return {
    status: state.track.status,
    label: state.track.label,
    durationSeconds: state.track.durationSeconds,
    error: state.track.error,
  };
}

/** Returns the track to `empty`: no file, no URL, no duration. */
function resetTrack(): void {
  state.track.file = null;
  state.track.objectUrl = null;
  state.track.status = 'empty';
  state.track.error = null;
  state.track.label = '';
  state.track.durationSeconds = Number.NaN;
}

/** Everything about a slot's source that travels with the file when A and B are swapped. */
interface SlotContent {
  file: File | null;
  objectUrl: string | null;
  status: SlotStatus;
  error: string | null;
  label: string;
  durationSeconds: number;
  width: number;
  height: number;
  source: VideoSlot['source'];
  sourceCodec: string | null;
  sourceDurationSeconds: number;
  sourceWidth: number;
  sourceHeight: number;
}

function contentOf(slot: VideoSlot): SlotContent {
  return {
    file: slot.file,
    objectUrl: slot.objectUrl,
    status: slot.status,
    error: slot.error,
    label: slot.label,
    durationSeconds: slot.durationSeconds,
    width: slot.width,
    height: slot.height,
    source: slot.source,
    sourceCodec: slot.sourceCodec,
    sourceDurationSeconds: slot.sourceDurationSeconds,
    sourceWidth: slot.sourceWidth,
    sourceHeight: slot.sourceHeight,
  };
}

function applyContent(slot: VideoSlot, content: SlotContent): void {
  slot.file = content.file;
  slot.objectUrl = content.objectUrl;
  slot.status = content.status;
  slot.error = content.error;
  slot.label = content.label;
  slot.durationSeconds = content.durationSeconds;
  slot.width = content.width;
  slot.height = content.height;
  slot.source = content.source;
  slot.sourceCodec = content.sourceCodec;
  slot.sourceDurationSeconds = content.sourceDurationSeconds;
  slot.sourceWidth = content.sourceWidth;
  slot.sourceHeight = content.sourceHeight;
  // The estimate belongs to the source, so the exchanged slot has to sample it again.
  slot.fps = null;
}

function mountAppShell(root: HTMLElement): void {
  root.classList.add('app');

  const header = document.createElement('header');
  header.className = 'app__header';

  const titles = document.createElement('div');
  titles.className = 'app__titles';

  const title = document.createElement('h1');
  title.className = 'app__title';
  title.textContent = 'Comparitoer';

  const tagline = document.createElement('p');
  tagline.className = 'app__tagline';
  tagline.textContent = 'Compare two videos in sync. Nothing leaves this device.';

  titles.append(title, tagline);

  const main = document.createElement('main');
  main.className = 'app__main';

  const loader = document.createElement('section');
  loader.className = 'loader';
  loader.setAttribute('aria-label', 'Choose two videos');

  const slots = document.createElement('div');
  slots.className = 'loader__slots';

  const statusHost = document.createElement('div');
  statusHost.className = 'loader__status';

  const compare = document.createElement('section');
  compare.className = 'compare';
  compare.hidden = true;

  const stageHost = document.createElement('div');
  stageHost.className = 'compare__stage';

  const controlsHost = document.createElement('div');
  controlsHost.className = 'compare__controls';

  const infoHost = document.createElement('div');
  infoHost.className = 'compare__info';

  // One row per video, shown only in independent mode. It sits between the shared bar and the
  // mixer so the per-video controls stay next to the audio levels they affect.
  const transportsHost = document.createElement('div');
  transportsHost.className = 'transports';
  transportsHost.hidden = true;

  compare.append(stageHost, controlsHost, transportsHost, infoHost);

  loader.append(slots, statusHost);
  main.append(compare, loader);

  const actions = document.createElement('div');
  actions.className = 'app__actions';

  header.append(titles, actions);
  root.append(header, main);

  // No host: the stage adopts both elements, so `src` keeps a single owner.
  const media: MediaLoader = createMediaLoader({});

  const stage: Stage = createStage({
    host: stageHost,
    videoA: media.videoA,
    videoB: media.videoB,
    wipePosition: state.wipe.position,
    onWipePositionChange: handleWipePositionChange,
    onLabelChange: handleLabelChange,
  });

  const infobar: InfoBar = createInfoBar(infoHost);

  function createZoneHost(): HTMLElement {
    const host = document.createElement('div');
    host.className = 'loader__slot';
    slots.append(host);
    return host;
  }

  const zones: Record<SlotId, Dropzone> = {
    a: createDropzone({
      host: createZoneHost(),
      slot: 'a',
      prompt: 'Drop video A here',
      slotLabel: 'Video A',
      onFileSelected: selectFile,
    }),
    b: createDropzone({
      host: createZoneHost(),
      slot: 'b',
      prompt: 'Drop video B here',
      slotLabel: 'Video B',
      onFileSelected: selectFile,
    }),
  };

  const status: DurationStatus = createDurationStatus({ host: statusHost });

  /**
   * Audio levels live here, not in the sync engine: one Web Audio graph mixes both videos, so
   * a level change never touches the media elements' own audio pipelines.
   */
  const audioMixer: AudioMixer = createAudioMixer({
    videoA: media.videoA,
    videoB: media.videoB,
    track: media.audioTrack,
  });

  audioMixer.setMix(state.mix);
  audioMixer.setTrackLevel(state.trackLevel);

  const engine: SyncEngine = createSyncEngine({
    videoA: media.videoA,
    videoB: media.videoB,
    speed: state.speed,
    loop: state.loop,
    audibleVoices: () =>
      audibleSourceCount(state.mix, state.trackLevel, state.track.status === 'ready'),
    audioTrack: media.audioTrack,
    handlers: {
      timeUpdate: handleTimeUpdate,
      playStateChange: handlePlayStateChange,
      fpsEstimate: handleFpsEstimate,
      ended: handleEnded,
      mediaError: handleMediaError,
      audioCorrection: (slot) => audioMixer.duck(slot, CORRECTION_DUCK_MS),
      slotTimeUpdate: handleSlotTimeUpdate,
      slotPlayStateChange: handleSlotPlayStateChange,
    },
  });

  /* -------------------------------------------------------------------------
     Local codec conversion
     ------------------------------------------------------------------------- */

  /**
   * The converter is created on demand. `import('./transcode')` is dynamic on purpose: the
   * ffmpeg wrapper and its 32 MB wasm core must not load until a file needs them.
   */
  let transcoder: Transcoder | null = null;
  let transcoderLoading: Promise<Transcoder> | null = null;
  /** The slot whose conversion is running, so two jobs can never overlap. */
  let convertingSlot: SlotId | null = null;
  /** Set when the user cancels before the converter module has finished loading. */
  let conversionCancelRequested = false;

  function loadTranscoder(): Promise<Transcoder> {
    transcoderLoading ??= import('./transcode').then((module) => {
      transcoder = module.createTranscoder();
      return transcoder;
    });

    return transcoderLoading;
  }

  /** True when the slot holds a file the browser rejected and nothing is converting it. */
  function needsConversion(slot: VideoSlot): boolean {
    return slot.file !== null && slot.status === 'error' && slot.conversion === null;
  }

  /** Status action for the failed slot(s), or null when there is nothing to convert. */
  function conversionAction(): StatusAction | null {
    const targets = SLOT_IDS.filter((id) => needsConversion(slotOf(id)));
    const first = targets[0];

    if (first === undefined) {
      return null;
    }

    return {
      label:
        targets.length > 1 ? 'Convert both locally' : `Convert ${first.toUpperCase()} locally`,
      onClick: handleConvert,
    };
  }

  function handleConvert(): void {
    void convertFailedSlots();
  }

  /** Converts every rejected slot in turn; a cancel stops the batch. */
  async function convertFailedSlots(): Promise<void> {
    for (const id of SLOT_IDS) {
      if (!needsConversion(slotOf(id))) {
        continue;
      }

      const converted = await convertSlot(id);

      if (!converted) {
        return;
      }
    }
  }

  function handleCancelConversion(): void {
    conversionCancelRequested = true;
    transcoder?.cancel();
  }

  /**
   * Runs one conversion and loads the proxy, keeping the chosen file as the slot's identity.
   *
   * Everything the user sees about the *file* (name, label, source duration, source codec)
   * keeps describing the original; only the picture being played comes from the proxy.
   */
  async function convertSlot(id: SlotId): Promise<boolean> {
    const slot = slotOf(id);
    const file = slot.file;

    if (file === null || slot.conversion !== null || convertingSlot !== null) {
      return false;
    }

    // A conversion is a heavy, blocking job; it must not compete with playback.
    engine.pause();
    state.playing = false;
    renderControls();

    if (file.size > MAX_CONVERSION_BYTES) {
      slot.error = conversionLimitMessage(file.name, file.size);
      renderZone(id);
      syncStatus();
      syncCompare();
      return false;
    }

    convertingSlot = id;
    conversionCancelRequested = false;
    slot.conversion = { stage: 'loading', ratio: null };
    slot.error = null;
    renderZone(id);
    syncStatus();
    syncCompare();

    const worker = await loadTranscoder();

    // A replacement, a clear or a cancel took over while the module was loading.
    if (conversionCancelRequested || slot.file !== file) {
      slot.conversion = null;
      convertingSlot = null;
      renderZone(id);
      syncStatus();
      syncCompare();
      return false;
    }

    const outcome = await worker.convert(
      { file, fastProxy: state.settings.fastProxy },
      {
        onStage: (stage) => {
          if (slot.file !== file) {
            return;
          }

          slot.conversion = {
            stage,
            ratio: stage === 'converting' ? (slot.conversion?.ratio ?? null) : null,
          };
          renderZone(id);
        },
        onRatio: (ratio) => {
          if (slot.file !== file) {
            return;
          }

          slot.conversion = { stage: 'converting', ratio };
          renderZone(id);
        },
      },
    );

    convertingSlot = null;

    // The slot was replaced (or the page went away) during the conversion.
    if (slot.file !== file) {
      return false;
    }

    slot.conversion = null;

    if (outcome.status === 'cancelled') {
      slot.error = conversionCancelledMessage(file.name);
      renderZone(id);
      syncStatus();
      syncCompare();
      return false;
    }

    if (outcome.status === 'error') {
      slot.error = outcome.message;
      renderZone(id);
      syncStatus();
      syncCompare();
      return false;
    }

    const loaded = await media.load(id, outcome.file);

    if (slot.file !== file) {
      media.clear(id);
      return false;
    }

    slot.objectUrl = media.getObjectUrl(id);

    if (loaded.status !== 'loaded') {
      media.clear(id);
      slot.objectUrl = null;
      slot.status = 'error';
      slot.error =
        loaded.status === 'error'
          ? loaded.message
          : 'The converted file could not be loaded. Choose Convert locally to try again.';
      renderZone(id);
      syncStatus();
      syncCompare();
      return false;
    }

    slot.source = 'proxy';
    slot.sourceCodec = outcome.probe.videoCodec;
    slot.sourceDurationSeconds = outcome.probe.durationSeconds;
    slot.sourceWidth = outcome.probe.width;
    slot.sourceHeight = outcome.probe.height;
    slot.durationSeconds = loaded.metadata.duration;
    slot.width = loaded.metadata.width;
    slot.height = loaded.metadata.height;
    slot.status = 'ready';
    slot.error = null;
    slot.fps = null;
    state.compareAnyway = false;

    renderZone(id);
    syncStatus();
    syncCompare();

    // Put the new picture on the playhead the other side already holds.
    if (state.independent) {
      engine.seekSlot(id, state.playheads[id]);
    } else {
      engine.seek(engine.getCurrentTime());
    }

    return true;
  }

  /** The user switched the local converter between full resolution and a 720p proxy. */
  function handleFastProxyChange(fast: boolean): void {
    state.settings.fastProxy = fast;
  }

  /**
   * True while a mix slider is being dragged; `mixResume` remembers whether playback was
   * interrupted by that drag and therefore has to be restarted on release.
   */
  let mixing = false;
  let mixResume = false;

  /**
   * Video levels to come back to when the third source is removed.
   *
   * Loading a track turns both video faders to 0 % so the track is what you hear, but that is a
   * *level preset*, not a mode: the faders stay live, and removing the track restores what the
   * user was listening to (or A, if that was silence, so removal can never leave dead air).
   */
  let mixBeforeTrack: AudioMix = { ...DEFAULT_AUDIO_MIX };

  const controls: Controls = createControls({
    host: controlsHost,
    fullscreenTarget: compare,
    onTogglePlay: handleTogglePlay,
    onBeginScrub: handleBeginScrub,
    onScrubTo: handleScrubTo,
    onEndScrub: handleEndScrub,
    onSpeedChange: handleSpeedChange,
    onToggleLoop: handleToggleLoop,
    onSwap: () => {
      void handleSwap();
    },
    onStep: handleStep,
    onStepUnitChange: handleStepUnitChange,
    onToggleIndependent: handleToggleIndependent,
  });

  const transports: Record<SlotId, SlotTransport> = {
    a: createSlotTransport({
      host: transportsHost,
      slot: 'a',
      onTogglePlay: () => {
        void engine.toggleSlot('a').catch(() => undefined);
      },
      onBeginScrub: () => engine.beginSlotScrub('a'),
      onScrubTo: (seconds) => engine.scrubSlotTo('a', seconds),
      onEndScrub: () => engine.endSlotScrub('a'),
      onStep: (direction) => engine.stepSlotFrames('a', direction),
    }),
    b: createSlotTransport({
      host: transportsHost,
      slot: 'b',
      onTogglePlay: () => {
        void engine.toggleSlot('b').catch(() => undefined);
      },
      onBeginScrub: () => engine.beginSlotScrub('b'),
      onScrubTo: (seconds) => engine.scrubSlotTo('b', seconds),
      onEndScrub: () => engine.endSlotScrub('b'),
      onStep: (direction) => engine.stepSlotFrames('b', direction),
    }),
  };

  const mixPanel: MixPanel = createMix({
    host: controlsHost,
    mix: state.mix,
    trackLevel: state.trackLevel,
    onMixChange: handleMixChange,
    onTrackLevelChange: handleTrackLevelChange,
    onAdjustingChange: handleMixAdjustingChange,
  });

  const settings = createSettings({
    host: actions,
    toleranceSeconds: state.settings.durationToleranceSeconds,
    track: trackView(),
    fastProxy: state.settings.fastProxy,
    onToleranceChange: handleToleranceChange,
    onTrackFile: (file) => {
      void handleTrackFile(file);
    },
    onRemoveTrack: handleRemoveTrack,
    onFastProxyChange: handleFastProxyChange,
  });

  const help: ShortcutHelp = createShortcutHelp({ host: actions });

  const shortcuts = createShortcuts({
    target: document,
    handlers: {
      onTogglePlay: handleTogglePlay,
      onStepFrames: handleStepFrames,
      onSeekBy: handleSeekBy,
      onToggleLoop: handleToggleLoop,
      onCycleAudio: handleCycleAudio,
      onToggleFullscreen: handleToggleFullscreen,
      onToggleHelp: handleToggleHelp,
    },
  });

  shortcuts.attach();

  function renderControls(): void {
    const fpsA = state.slotA.fps;
    const frame = fpsA === null ? null : frameIndexAt(state.currentTime, fpsA);

    state.frame = frame ?? 0;

    controls.render({
      playing: state.playing,
      currentTime: state.currentTime,
      timelineDuration: state.timelineDurationSeconds,
      speed: state.speed,
      loop: state.loop,
      stepUnit: state.settings.stepUnit,
      frame,
      fps: fpsA,
      independent: state.independent,
      anySlotPlaying: state.slotPlaying.a || state.slotPlaying.b,
    });
  }

  /** Both rows, from the state the engine reported. Cheap enough to run every frame. */
  function renderTransports(): void {
    for (const id of ['a', 'b'] as const) {
      transports[id].render({
        playing: state.slotPlaying[id],
        currentTime: state.playheads[id],
        durationSeconds: slotOf(id).durationSeconds,
        enabled: slotOf(id).status === 'ready',
      });
    }
  }

  function handleSlotTimeUpdate(id: SlotId, currentTime: number): void {
    state.playheads[id] = currentTime;
    renderTransports();
  }

  function handleSlotPlayStateChange(id: SlotId, playing: boolean): void {
    state.slotPlaying[id] = playing;
    renderTransports();
    renderControls();
  }

  /**
   * The mode switch.
   *
   * Enabling pauses both videos: two independent transports cannot inherit a shared playhead
   * meaningfully, and starting from a pause is the only state the user can predict. Disabling
   * puts B back on A's picture (the engine does the seek) so leaving the mode never leaves the
   * comparison silently misaligned.
   */
  function handleToggleIndependent(): void {
    const next = !state.independent;

    state.independent = next;
    engine.setIndependent(next);
    transportsHost.hidden = !next;

    if (!next) {
      for (const id of ['a', 'b'] as const) {
        state.slotPlaying[id] = false;
        state.playheads[id] = engine.getSlotTime(id);
      }

      // The shared playhead is A's again, and the mixer restart hook must not fire behind us.
      mixResume = false;
      state.currentTime = engine.getCurrentTime();
    } else {
      state.playing = false;

      for (const id of ['a', 'b'] as const) {
        state.playheads[id] = engine.getSlotTime(id);
      }
    }

    renderTransports();
    renderControls();
  }

  function handleTimeUpdate(currentTime: number, duration: number): void {
    state.currentTime = currentTime;
    state.timelineDurationSeconds = duration;
    renderControls();
  }

  function handlePlayStateChange(playing: boolean): void {
    state.playing = playing;
    renderControls();
  }

  function handleEnded(): void {
    state.playing = false;
    renderControls();
  }

  /**
   * Playback errors happen long after loading, so the engine can only describe the slot and
   * the kind. The message is rebuilt here, where the file name lives, so every error state
   * names the file the user actually chose.
   */
  function handleMediaError(id: SlotId, kind: MediaErrorKind, fallbackMessage: string): void {
    const slot = slotOf(id);
    const filename = slot.file?.name ?? '';

    status.render({
      tone: 'danger',
      message: `Video ${id.toUpperCase()} stopped playing.`,
      detail: filename.length > 0 ? mediaErrorMessage(kind, filename) : fallbackMessage,
      action: null,
    });
  }

  function handleTogglePlay(): void {
    // An explicit play/pause during a mix drag takes over from the drag's own pause, so the
    // release must not resume behind the user's back.
    mixResume = false;

    // A click or Space press is the gesture the audio graph needs to start.
    audioMixer.unlock();

    void engine.togglePlay().catch(() => {
      // The engine has already paused both elements and reported the failure.
    });
  }

  function handleBeginScrub(): void {
    mixResume = false;
    engine.beginScrub();
  }

  function handleScrubTo(seconds: number): void {
    engine.scrubTo(seconds);
  }

  function handleEndScrub(): void {
    engine.endScrub();
  }

  /** Applied to both elements in the same tick by the engine. */
  function handleSpeedChange(speed: PlaybackSpeed): void {
    state.speed = speed;
    engine.setSpeed(speed);
    renderControls();
  }

  /**
   * Levels go straight to the audio graph, which ramps the gain over ~10 ms; the media
   * elements' own volume is never touched, so a drag cannot disturb either pipeline.
   */
  function handleMixChange(mix: AudioMix): void {
    state.mix = mix;
    audioMixer.setMix(mix);
    mixPanel.render(mix);
  }

  /**
   * Dragging a level pauses playback so the pair is re-anchored on release: two media elements
   * are serviced independently, and `play()` aligns both on one time before running, so any
   * offset that built up is gone the moment the drag ends.
   */
  function handleMixAdjustingChange(adjusting: boolean): void {
    // The audio graph needs a gesture to start (autoplay policy); a drag is one.
    audioMixer.unlock();

    if (adjusting === mixing) {
      return;
    }

    mixing = adjusting;

    if (adjusting) {
      mixResume = engine.isPlaying();

      if (mixResume) {
        engine.pause();
      }

      return;
    }

    if (!mixResume) {
      return;
    }

    mixResume = false;
    void engine.play().catch(() => undefined);
  }

  /**
   * `M` steps to the next source that can actually be heard: A, B, the loaded track, silence.
   *
   * Both kinds of level are written together, because with three faders "the audio source" is
   * whichever one the user can hear — a cycle that moved only the video levels did nothing at
   * all while a track was loaded.
   */
  function handleCycleAudio(): void {
    const next = nextAudioLevels(
      { mix: state.mix, trackLevel: state.trackLevel },
      state.track.status === 'ready',
    );

    handleMixChange(next.mix);
    handleTrackLevelChange(next.trackLevel);
  }

  /** The track's own fader; the mixer mixes it in alongside the videos. */
  function handleTrackLevelChange(level: number): void {
    state.trackLevel = level;
    audioMixer.setTrackLevel(level);
    mixPanel.renderTrackLevel(level);
    renderTrackViews();
  }

  /** Keeps the panel and the Settings section in step with `state.track`. */
  function renderTrackViews(): void {
    const loaded = state.track.status === 'ready';

    mixPanel.renderTrack({
      loaded,
      active: loaded && state.trackLevel > 0,
      label: state.track.label,
    });
    settings.setTrack(trackView());
  }

  /**
   * Applies the level preset that means "listen to the track": videos to 0 %, track to full.
   *
   * This is deliberately a preset rather than a mode. Every fader keeps working afterwards, so
   * going back to A's or B's own soundtrack is a slider move, not a switch out of a mode — the
   * earlier "the track replaces both videos" rule left the video faders dead and looked exactly
   * like broken audio.
   */
  function presetTrackLevels(): void {
    // Replacing a track must not overwrite what the user was listening to before the *first*
    // track: by then the video faders already sit at 0 %.
    if (!isMixSilent(state.mix)) {
      mixBeforeTrack = { ...state.mix };
    }

    handleMixChange({ a: 0, b: 0 });
    handleTrackLevelChange(1);
  }

  /** Undoes `presetTrackLevels()`, without stomping a source the user picked in the meantime. */
  function restoreVideoLevels(): void {
    // Only undo the preset while the video faders still sit where it left them (0 %). If the
    // user has since switched to A's or B's own soundtrack, that choice wins.
    if (isMixSilent(state.mix)) {
      const restored = isMixSilent(mixBeforeTrack) ? DEFAULT_AUDIO_MIX : mixBeforeTrack;

      handleMixChange({ ...restored });
    }

    handleTrackLevelChange(1);
    mixBeforeTrack = { ...DEFAULT_AUDIO_MIX };
  }

  /**
   * Loads the third audio source.
   *
   * Replacing it is safe while playing: the engine re-aligns every element to the current
   * playhead once the new file is ready, so the track joins the running pair at the right time
   * instead of at 00:00. A rejected file leaves no track loaded — the loader has already
   * revoked the previous URL by then, so pretending otherwise would point at a dead source.
   */
  async function handleTrackFile(file: File): Promise<void> {
    if (!isProbablyAudioTrack(file)) {
      // The rejected file never becomes the source, but a previously loaded track must not keep
      // playing behind an error message either.
      media.clearTrack();
      resetTrack();
      state.track.status = 'error';
      state.track.error = nonAudioTrackMessage(file.name);
      restoreVideoLevels();
      engine.attachTrack();
      renderTrackViews();
      return;
    }

    state.track.status = 'loading';
    state.track.label = trackLabelFromFilename(file.name);
    state.track.error = null;
    renderTrackViews();

    // The channel is silent until the file is ready, so a half-loaded source cannot pop.
    audioMixer.setTrackLevel(0);

    const outcome = await media.loadTrack(file);

    if (outcome.status === 'superseded') {
      // Another pick (or pagehide) took over; the newer attempt owns the UI.
      return;
    }

    if (outcome.status === 'error') {
      // Detach the broken source: the element would otherwise keep a dead `src` and look loaded.
      media.clearTrack();
      resetTrack();
      state.track.status = 'error';
      state.track.error = audioTrackErrorMessage(outcome.kind, file.name);
      restoreVideoLevels();
      engine.attachTrack();
      renderTrackViews();
      return;
    }

    state.track.file = file;
    state.track.objectUrl = media.getTrackUrl();
    state.track.durationSeconds = outcome.metadata.duration;
    state.track.status = 'ready';
    state.track.error = null;

    presetTrackLevels();
    renderTrackViews();

    // Join the current playhead, never 00:00 — and start the track if the picture is already
    // running, otherwise the videos are at 0 % with nothing playing in their place.
    engine.attachTrack();
  }

  /** Removing the track is not destructive to playback: the videos keep their own time. */
  function handleRemoveTrack(): void {
    media.clearTrack();
    resetTrack();
    engine.attachTrack();
    restoreVideoLevels();
    renderTrackViews();
    renderControls();
  }

  function handleToggleLoop(): void {
    state.loop = !state.loop;
    engine.setLoop(state.loop);
    renderControls();
  }

  function handleStepFrames(frames: number): void {
    engine.stepFrames(frames);
  }

  /**
   * A press of the visible step buttons, in the selected unit.
   *
   * Stepping is a paused operation by design: a frame-accurate inspection is meaningless while
   * the picture is moving, so the engine pauses first (frame steps do that themselves) and the
   * composition root pauses for time steps. The target is computed by the pure `stepTarget`, so
   * both ends of the timeline clamp exactly as the tests say they do.
   */
  function handleStep(direction: StepDirection): void {
    const unit = state.settings.stepUnit;

    if (unit === 'frame') {
      engine.stepFrames(direction);
      return;
    }

    if (engine.isPlaying()) {
      engine.pause();
    }

    const target = stepTarget(
      state.currentTime,
      unit,
      direction,
      state.slotA.fps,
      state.timelineDurationSeconds,
    );

    engine.seek(target);
  }

  function handleStepUnitChange(unit: StepUnit): void {
    state.settings.stepUnit = unit;
    renderControls();
  }

  function handleSeekBy(deltaSeconds: number): void {
    engine.seekBy(deltaSeconds);
  }

  function handleToggleFullscreen(): void {
    controls.toggleFullscreen();
  }

  function handleToggleHelp(): void {
    help.toggle();
  }

  function renderZone(id: SlotId): void {
    zones[id].render(zoneView(slotOf(id)));
  }

  function renderZones(): void {
    renderZone('a');
    renderZone('b');
  }

  function handleWipePositionChange(position: number): void {
    state.wipe.position = position;
  }

  function handleLabelChange(id: SlotId, text: string): void {
    const slot = slotOf(id);
    const fallback = slot.file === null ? '' : labelFromFilename(slot.file.name);

    slot.label = text.length > 0 ? text : fallback;
    stage.setLabel(id, slot.label);
    renderInfo(id);
  }

  function factsOf(slot: VideoSlot): VideoFacts {
    return { width: slot.width, height: slot.height, fps: slot.fps };
  }

  /**
   * Every informational chip for the pair: the aspect-ratio/FPS differences plus a note for
   * each side that is playing a converted proxy, so a proxy is never mistaken for a master.
   */
  function warningsFor(a: VideoSlot, b: VideoSlot): InfoBarWarning[] {
    const warnings = infoWarnings(factsOf(a), factsOf(b));

    for (const slot of [a, b]) {
      if (slot.source === 'proxy') {
        warnings.push(proxyWarning(probeOfSlot(slot)));
      }
    }

    return warnings;
  }

  function renderInfo(id: SlotId): void {
    const slot = slotOf(id);
    const fallback = slot.file === null ? '' : labelFromFilename(slot.file.name);

    infobar.update(id, {
      label: slot.label.length > 0 ? slot.label : fallback,
      width: slot.width,
      height: slot.height,
      fps: slot.fps,
      durationSeconds: slot.durationSeconds,
    });
  }

  /**
   * An estimate arrives once per source, a few frames after playback starts. Until then the
   * info bar shows `—` and the frame counter steps on the 30 fps fallback, never a guess
   * presented as a measured value.
   */
  function handleFpsEstimate(id: SlotId, fps: number): void {
    const slot = slotOf(id);

    // A late estimate from a replaced source must not overwrite the new one.
    if (slot.status !== 'ready') {
      return;
    }

    slot.fps = fps;
    renderInfo(id);
    infobar.setWarnings(warningsFor(state.slotA, state.slotB));
    renderControls();
  }

  /** True while both slots hold a usable file; a slot mid-replacement keeps the stage up. */
  function isStageReady(): boolean {
    const a = state.slotA;
    const b = state.slotB;

    return a.file !== null && b.file !== null && a.status !== 'error' && b.status !== 'error';
  }

  /** Draws everything that depends on both slots: stage visibility, tags, info, chips. */
  function syncCompare(): void {
    const ready = isStageReady();
    compare.hidden = !ready;
    // Once both videos exist the zones become a compact "replace" row under the stage.
    loader.classList.toggle('loader--compact', ready);

    renderInfo('a');
    renderInfo('b');
    infobar.setWarnings(warningsFor(state.slotA, state.slotB));
    renderTransports();
    renderControls();

    if (!ready) {
      return;
    }

    stage.setAspectRatio(state.slotA.width, state.slotA.height);
    stage.setLabel('a', state.slotA.label);
    stage.setLabel('b', state.slotB.label);
  }

  function durationView(a: VideoSlot, b: VideoSlot): DurationStatusView {
    const invalidSlots: string[] = [];
    const durationA = sourceDurationOf(a);
    const durationB = sourceDurationOf(b);

    if (!isValidDuration(durationA)) {
      invalidSlots.push('A');
    }

    if (!isValidDuration(durationB)) {
      invalidSlots.push('B');
    }

    if (invalidSlots.length > 0) {
      return {
        tone: 'danger',
        message:
          invalidSlots.length === 2
            ? 'The duration of neither video could be read.'
            : `The duration of video ${invalidSlots.join(' and ')} could not be read.`,
        detail:
          'The file may be damaged or still being written. Re-encode it to H.264 MP4 or WebM.',
        action: null,
      };
    }

    const check = compareDurations(
      durationA,
      durationB,
      state.settings.durationToleranceSeconds,
    );

    const pair = `A ${formatTime(durationA)} / B ${formatTime(durationB)}`;
    const tolerance = formatTolerance(check.toleranceSeconds);

    if (check.match) {
      return {
        tone: 'ok',
        message: `Durations match (${pair})`,
        detail: `Difference ${formatDeltaMs(check.deltaMs)} ms, within the ${tolerance} tolerance.`,
        action: null,
      };
    }

    const longer = check.longer === 'b' ? 'B' : 'A';

    if (!state.compareAnyway) {
      return {
        tone: 'warn',
        message: `Durations differ by ${formatDeltaMs(check.deltaMs)} ms. Video ${longer} is longer (${pair}).`,
        detail: `Compare anyway uses the shorter video (${formatTime(check.clampTo)}) without changing the ${tolerance} tolerance.`,
        action: {
          label: 'Compare anyway',
          onClick: handleCompareAnyway,
        },
      };
    }

    return {
      tone: 'warn',
      message: `Comparing the shorter video (${formatTime(check.clampTo)}).`,
      detail: `Durations differ by ${formatDeltaMs(check.deltaMs)} ms (${pair}). Replace a file or change the tolerance to check again.`,
      action: null,
    };
  }

  function statusView(): DurationStatusView {
    const a = state.slotA;
    const b = state.slotB;
    const failedA = a.status === 'error';
    const failedB = b.status === 'error';

    // A running conversion is reported first: it is the only job in the app that can take
    // minutes, and its message must stay identical while the percentage moves so the polite
    // live region announces it once instead of a hundred times.
    const converting = SLOT_IDS.find((id) => slotOf(id).conversion !== null);

    if (converting !== undefined) {
      const stage = slotOf(converting).conversion?.stage;

      return {
        tone: 'neutral',
        message: `Converting video ${converting.toUpperCase()} locally…`,
        detail:
          stage === 'loading'
            ? 'Loading the local decoder (about 32 MB, downloaded once). Everything stays on this device.'
            : stage === 'probing'
              ? 'Reading the stream details before choosing a conversion.'
              : 'Re-encoding a temporary H.264 proxy. This can take a while for long clips; nothing is uploaded.',
        action: {
          label: 'Cancel conversion',
          onClick: handleCancelConversion,
        },
      };
    }

    if (failedA && failedB) {
      return {
        tone: 'danger',
        message: 'Neither video could be loaded.',
        detail:
          'Convert both files locally, or replace each with an MP4 or WebM this browser can play.',
        action: conversionAction(),
      };
    }

    if (failedA) {
      return {
        tone: 'danger',
        message: 'Video A could not be loaded.',
        detail: a.error,
        action: conversionAction(),
      };
    }

    if (failedB) {
      return {
        tone: 'danger',
        message: 'Video B could not be loaded.',
        detail: b.error,
        action: conversionAction(),
      };
    }

    const emptyA = a.status === 'empty';
    const emptyB = b.status === 'empty';

    if (emptyA && emptyB) {
      return {
        tone: 'neutral',
        message: 'Load both videos to check their durations.',
        detail: 'Drop a file on each zone, or click a zone to choose one.',
        action: null,
      };
    }

    if (emptyA || emptyB) {
      return {
        tone: 'neutral',
        message: `Load video ${emptyA ? 'A' : 'B'} to check durations.`,
        detail: null,
        action: null,
      };
    }

    if (a.status === 'loading' || b.status === 'loading') {
      const bothLoading = a.status === 'loading' && b.status === 'loading';

      return {
        tone: 'neutral',
        message: 'Reading duration metadata…',
        detail: `Waiting for ${bothLoading ? 'both videos' : `video ${a.status === 'loading' ? 'A' : 'B'}`}.`,
        action: null,
      };
    }

    return durationView(a, b);
  }

  function syncStatus(): void {
    state.timelineDurationSeconds = timelineDuration(
      state.slotA.durationSeconds,
      state.slotB.durationSeconds,
    );
    status.render(statusView());
  }

  function handleCompareAnyway(): void {
    if (state.compareAnyway) {
      return;
    }

    state.compareAnyway = true;
    syncStatus();
  }

  function handleToleranceChange(seconds: number): void {
    state.settings.durationToleranceSeconds = seconds;
    state.compareAnyway = false;
    syncStatus();
  }

  async function selectFile(id: SlotId, file: File): Promise<void> {
    const slot = slotOf(id);

    // Replacing a source must stop playback before the element is emptied: the old timeline
    // no longer applies, and the engine must not keep driving a source that is going away.
    engine.pause();
    state.playing = false;

    // A conversion for this slot is about to become pointless: stop it before its result
    // could land on a slot that now holds a different file.
    if (slot.conversion !== null) {
      conversionCancelRequested = true;
      transcoder?.cancel();
    }

    state.compareAnyway = false;

    if (!isProbablyVideoFile(file)) {
      media.clear(id);
      slot.file = null;
      slot.objectUrl = null;
      slot.label = '';
      slot.status = 'error';
      slot.error = nonVideoMessage(file.name);
      resetMetadata(slot);
      renderZone(id);
      syncStatus();
      syncCompare();
      return;
    }

    slot.file = file;
    slot.objectUrl = null;
    slot.label = labelFromFilename(file.name);
    slot.status = 'loading';
    slot.error = null;
    resetMetadata(slot);
    renderZone(id);
    syncStatus();
    syncCompare();

    const outcome = await media.load(id, file);

    // A newer file (or a clear) took over while metadata was in flight.
    if (slot.file !== file || outcome.status === 'superseded') {
      return;
    }

    slot.objectUrl = media.getObjectUrl(id);

    if (outcome.status === 'loaded') {
      slot.durationSeconds = outcome.metadata.duration;
      slot.width = outcome.metadata.width;
      slot.height = outcome.metadata.height;
      slot.status = 'ready';
      slot.error = null;
    } else {
      slot.status = 'error';
      slot.error = outcome.message;
    }

    renderZone(id);
    syncStatus();
    syncCompare();

    if (outcome.status === 'loaded') {
      // Replacing the follower keeps the master's playhead (the engine reset it to 0 only
      // when the master itself was replaced), so re-anchor both elements on one position:
      // otherwise the new file sits on frame 0 while the other holds an old frame.
      //
      // Independent mode is the exception: the other video's playhead is none of this file's
      // business, so only the replaced row is put back where it was.
      if (state.independent) {
        engine.seekSlot(id, state.playheads[id]);
      } else {
        engine.seek(engine.getCurrentTime());
      }
    }
  }

  let swapping = false;

  /**
   * Exchanges the two videos, keeping the playhead and the play state.
   *
   * The media loader moves the sources first; the app state only follows once that swap
   * actually succeeded. A failed or superseded swap therefore cannot leave the elements and
   * the state pointing at different files. Each video keeps its own volume, so the mixer stays
   * attached to its side rather than to a soundtrack, and the timeline is re-anchored on the
   * preserved time so the pair resumes
   * in sync rather than inheriting two independently seeked positions.
   */
  async function handleSwap(): Promise<void> {
    const a = state.slotA;
    const b = state.slotB;

    // Independent mode keeps a playhead per element, so exchanging sources would also have to
    // exchange playheads; the button is disabled there and this guard keeps it honest.
    if (state.independent || swapping || a.status !== 'ready' || b.status !== 'ready') {
      return;
    }

    const time = engine.getCurrentTime();
    const wasPlaying = engine.isPlaying();
    const fileA = a.file;
    const fileB = b.file;

    swapping = true;
    engine.pause();
    state.playing = false;
    renderControls();

    try {
      const outcome = await media.swap();

      // A replacement (or pagehide) took over while the swap loaded.
      if (outcome.status === 'superseded' || a.file !== fileA || b.file !== fileB) {
        return;
      }

      if (outcome.status === 'error') {
        const failed = slotOf(outcome.slot);
        failed.status = 'error';
        failed.error = mediaErrorMessage(
          outcome.kind,
          failed.file?.name ?? `Video ${outcome.slot.toUpperCase()}`,
        );
        failed.fps = null;
        renderZone(outcome.slot);
        syncStatus();
        syncCompare();
        return;
      }

      const contentA = contentOf(a);
      const contentB = contentOf(b);

      applyContent(a, contentB);
      applyContent(b, contentA);

      // The elements were re-attached to new sources; the graph keeps its gains.
      audioMixer.refresh();

      renderZones();
      syncStatus();
      syncCompare();

      engine.seek(time);

      if (wasPlaying) {
        await engine.play().catch(() => undefined);
      } else {
        renderControls();
      }
    } finally {
      swapping = false;
    }
  }

  function resetAllSlots(): void {
    resetSlot(state.slotA);
    resetSlot(state.slotB);
    state.compareAnyway = false;
    renderZones();
    syncStatus();
    syncCompare();
  }

  function preventWindowDrop(event: DragEvent): void {
    // A drop that misses a zone must not navigate away from the app.
    event.preventDefault();
  }

  function handlePageHide(): void {
    // Stops playback first, then revokes both URLs and returns the UI to a clean,
    // consistent state so a bfcache restore never shows a slot whose `src` has been released.
    //
    // The audio graph is deliberately left alive: destroy() would close its `AudioContext`,
    // and a bfcache restore runs no init code, so both elements would stay bound to a closed
    // context and the app would come back silent. The context itself is released with the
    // document.
    conversionCancelRequested = true;
    transcoder?.cancel();
    convertingSlot = null;
    engine.pause();
    media.releaseAll();
    resetAllSlots();
    resetTrack();
    audioMixer.setTrackLevel(0);
    renderTrackViews();
    // Nothing can resume a mix adjustment once the page is gone; drop the pending restart.
    mixing = false;
    mixResume = false;
    state.playing = false;
    state.currentTime = 0;
    state.playheads = { a: 0, b: 0 };
    state.slotPlaying = { a: false, b: false };
    renderTransports();
    renderControls();
  }

  window.addEventListener('dragover', preventWindowDrop);
  window.addEventListener('drop', preventWindowDrop);
  window.addEventListener('pagehide', handlePageHide);

  renderZones();
  syncStatus();
  syncCompare();
}

const root = document.getElementById('app');

if (root === null) {
  throw new Error('Missing #app root element in index.html');
}

mountAppShell(root);

// The welcome card is self-contained: it reads its own stored flag, so nothing in the shell has
// to know about it. It is created after the shell so it can float above the finished layout.
createWelcome({ message: WELCOME_MESSAGE });

