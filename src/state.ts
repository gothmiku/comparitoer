import { DEFAULT_DURATION_TOLERANCE_SECONDS } from './logic/duration';
import { DEFAULT_AUDIO_MIX } from './logic/mix';
import type { AudioMix } from './logic/mix';
import type { StepUnit } from './logic/step';
import { WIPE_DEFAULT_PERCENT } from './logic/wipe';

export type { AudioMix } from './logic/mix';

/** Which of the two loaded videos a value refers to. */
export type SlotId = 'a' | 'b';

/** Playback rates offered by the speed control; applied to both videos. */
export const PLAYBACK_SPEEDS = [0.25, 0.5, 1, 1.5, 2] as const;

export type PlaybackSpeed = (typeof PLAYBACK_SPEEDS)[number];

/** Default divider position as a percentage measured from the left edge. */
export const DEFAULT_WIPE_POSITION = WIPE_DEFAULT_PERCENT;

/**
 * Slot lifecycle: `empty` (nothing chosen), `loading` (metadata in flight),
 * `ready` (metadata read), `error` (rejected or unplayable file).
 */
export type SlotStatus = 'empty' | 'loading' | 'ready' | 'error';

/** Where the pictures on screen come from: the chosen file, or a locally converted proxy. */
export type SlotSourceKind = 'native' | 'proxy';

/** Stage of a local conversion, from loading the decoder to writing the proxy. */
export type ConversionStage = 'loading' | 'probing' | 'converting';

/** Progress of the local converter for one slot. */
export interface SlotConversion {
  readonly stage: ConversionStage;
  /** Completed fraction 0-1; null while the converter has no measurable progress yet. */
  readonly ratio: number | null;
}

/** One video slot: the local file, its object URL, and metadata read from the element. */
export interface VideoSlot {
  readonly id: SlotId;
  /** Selected local file, or null while the slot is empty or after a rejected file. */
  file: File | null;
  /** Object URL created for `file`; revoked on replacement and on pagehide. */
  objectUrl: string | null;
  /** Where the slot is in its load lifecycle; drives the drop zone and the status region. */
  status: SlotStatus;
  /** User-facing message for the `error` status; null otherwise. */
  error: string | null;
  /** Corner tag text; defaults to the filename without extension and is user-editable. */
  label: string;
  /** Duration from `loadedmetadata` in seconds; NaN until known. */
  durationSeconds: number;
  /** Intrinsic width in CSS pixels; 0 until `loadedmetadata`. */
  width: number;
  /** Intrinsic height in CSS pixels; 0 until `loadedmetadata`. */
  height: number;
  /** Estimated frame rate; null until sampled from requestVideoFrameCallback. */
  fps: number | null;
  /** `native` plays `file`; `proxy` plays a converted copy of it. */
  source: SlotSourceKind;
  /** Codec of the chosen file as the local probe reported it; null until a proxy exists. */
  sourceCodec: string | null;
  /** Duration of the *chosen* file in seconds; NaN while native or still unknown. */
  sourceDurationSeconds: number;
  /** Width of the chosen file; 0 while native or still unknown. */
  sourceWidth: number;
  /** Height of the chosen file; 0 while native or still unknown. */
  sourceHeight: number;
  /** Progress of a running local conversion; null when none is running. */
  conversion: SlotConversion | null;
}

/**
 * The optional third audio source: one local file whose soundtrack replaces both videos' audio.
 *
 * Kept separate from `VideoSlot` because it has no picture, no frame rate and no aspect ratio,
 * and because it must survive a video swap untouched.
 */
export interface ExternalTrack {
  /** Selected local file, or null while none is loaded. */
  file: File | null;
  /** Object URL created for `file`; revoked on replacement and on pagehide. */
  objectUrl: string | null;
  /** Label shown in Settings and on the mixer; defaults to the filename without extension. */
  label: string;
  /** Load lifecycle, reusing the slot vocabulary so every surface speaks the same language. */
  status: SlotStatus;
  /** User-facing message for the `error` status; null otherwise. */
  error: string | null;
  /** Duration reported by the element in seconds; NaN until known. */
  durationSeconds: number;
}

/** Divider state shared by the wipe controller and the keyboard handler. */
export interface WipeState {
  /** Divider position in percent, 0-100. */
  position: number;
  /** True while the handle is being dragged with a pointer. */
  dragging: boolean;
}

/** User-tunable comparison settings. */
export interface CompareSettings {
  /** Allowed |durationA - durationB| in seconds before a mismatch is reported. */
  durationToleranceSeconds: number;
  /** What one press of the step buttons moves: one frame, or 1/5/10 seconds. */
  stepUnit: StepUnit;
  /**
   * Convert to a 720p proxy instead of full resolution. Faster and smaller, at the cost of
   * fine detail in the comparison.
   */
  fastProxy: boolean;
}

/** Everything the UI renders from. Mutated only by the composition root in main.ts. */
export interface AppState {
  slotA: VideoSlot;
  slotB: VideoSlot;
  settings: CompareSettings;
  wipe: WipeState;
  /** Per-video audio levels; a level of 0 silences that video. */
  mix: AudioMix;
  /** Gain of the external track, 0-1; ignored while no track is loaded. */
  trackLevel: number;
  /** The optional third audio source that replaces both video soundtracks. */
  track: ExternalTrack;
  speed: PlaybackSpeed;
  loop: boolean;
  playing: boolean;
  /**
   * Independent mode: each video has its own transport and playhead, and nothing corrects the
   * difference between them. Enabling it pauses both; disabling it hard-seeks B onto A.
   */
  independent: boolean;
  /** Per-video playhead in seconds; meaningful in independent mode, mirrors the other in linked. */
  playheads: Record<SlotId, number>;
  /** True while that video's own element is running; only ever set in independent mode. */
  slotPlaying: Record<SlotId, boolean>;
  /** Playhead in seconds, 0 .. timelineDurationSeconds. */
  currentTime: number;
  /** Timeline length = min(durationA, durationB); NaN until both are known. */
  timelineDurationSeconds: number;
  /** Frame index of A at `currentTime`, using A's estimated fps. */
  frame: number;
  /** True once the user acknowledged a duration mismatch with "Compare anyway". */
  compareAnyway: boolean;
}

/** Overrides applied by `createInitialState`, used by tests and defaults. */
export interface InitialStateOverrides {
  readonly durationToleranceSeconds?: number;
  readonly stepUnit?: StepUnit;
  readonly mix?: AudioMix;
  readonly trackLevel?: number;
  readonly speed?: PlaybackSpeed;
  readonly wipePosition?: number;
  readonly independent?: boolean;
  readonly fastProxy?: boolean;
}

/** Builds an empty slot: no file, no URL, unknown metadata. */
export function createEmptySlot(id: SlotId): VideoSlot {
  return {
    id,
    file: null,
    objectUrl: null,
    status: 'empty',
    error: null,
    label: '',
    durationSeconds: Number.NaN,
    width: 0,
    height: 0,
    fps: null,
    source: 'native',
    sourceCodec: null,
    sourceDurationSeconds: Number.NaN,
    sourceWidth: 0,
    sourceHeight: 0,
    conversion: null,
  };
}

/** Builds an empty track: no file, no URL, unknown duration. */
export function createEmptyTrack(): ExternalTrack {
  return {
    file: null,
    objectUrl: null,
    label: '',
    status: 'empty',
    error: null,
    durationSeconds: Number.NaN,
  };
}

/** Builds the initial app state: empty slots, 50% divider, audio from A only, 1x speed. */
export function createInitialState(overrides: InitialStateOverrides = {}): AppState {
  return {
    slotA: createEmptySlot('a'),
    slotB: createEmptySlot('b'),
    settings: {
      durationToleranceSeconds:
        overrides.durationToleranceSeconds ?? DEFAULT_DURATION_TOLERANCE_SECONDS,
      stepUnit: overrides.stepUnit ?? 'frame',
      fastProxy: overrides.fastProxy ?? false,
    },
    wipe: {
      position: overrides.wipePosition ?? DEFAULT_WIPE_POSITION,
      dragging: false,
    },
    mix: overrides.mix ?? { ...DEFAULT_AUDIO_MIX },
    trackLevel: overrides.trackLevel ?? 1,
    track: createEmptyTrack(),
    speed: overrides.speed ?? 1,
    loop: false,
    playing: false,
    independent: overrides.independent ?? false,
    playheads: { a: 0, b: 0 },
    slotPlaying: { a: false, b: false },
    currentTime: 0,
    timelineDurationSeconds: Number.NaN,
    frame: 0,
    compareAnyway: false,
  };
}
