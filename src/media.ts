import { classifyMediaError, mediaErrorMessage } from './logic/file';
import type { MediaErrorKind } from './logic/file';
import type { SlotId } from './state';

/** Facts the duration check and the (later) stage need from `loadedmetadata`. */
export interface MediaMetadata {
  readonly duration: number;
  readonly width: number;
  readonly height: number;
}

/**
 * Result of one load attempt. `superseded` means the slot was cleared or replaced while
 * metadata was still loading, so this outcome must be ignored.
 */
export type MediaLoadOutcome =
  | { readonly status: 'loaded'; readonly metadata: MediaMetadata }
  | { readonly status: 'error'; readonly kind: MediaErrorKind; readonly message: string }
  | { readonly status: 'superseded' };

/**
 * Result of exchanging the two sources. The URLs are *not* revoked: each keeps playing in
 * its new element. `superseded` means a slot was cleared/replaced while the swap loaded
 * (or that one slot had no source yet), so nothing was exchanged.
 */
export type MediaSwapOutcome =
  | { readonly status: 'swapped' }
  | { readonly status: 'error'; readonly slot: SlotId; readonly kind: MediaErrorKind }
  | { readonly status: 'superseded' };

export interface MediaLoaderOptions {
  /** Optional host element; both `<video>` elements are appended here when given. */
  readonly host?: HTMLElement;
}

/**
 * Owns the two media elements, the optional audio-track element and every object URL. This is
 * the only module that calls `URL.createObjectURL` / `URL.revokeObjectURL`; the stage phase
 * mounts these same elements instead of creating its own, so there is never a second owner of
 * `src`.
 */
export interface MediaLoader {
  readonly videoA: HTMLVideoElement;
  readonly videoB: HTMLVideoElement;
  /** Third source: plays the external soundtrack instead of the videos' own audio. */
  readonly audioTrack: HTMLAudioElement;
  /** Revokes the slot's previous URL, then loads `file` and waits for metadata. */
  load(slot: SlotId, file: File): Promise<MediaLoadOutcome>;
  /** Exchanges the two sources, keeping both URLs alive, and waits for new metadata. */
  swap(): Promise<MediaSwapOutcome>;
  /** Revokes the previous track URL, then loads `file` and waits for metadata. */
  loadTrack(file: File): Promise<MediaLoadOutcome>;
  /** Cancels a pending load, revokes the URL and detaches `src`. */
  clear(slot: SlotId): void;
  /** Cancels a pending track load, revokes its URL and detaches `src`. */
  clearTrack(): void;
  /** Revokes every URL; called by the composition root on `pagehide` and by `destroy`. */
  releaseAll(): void;
  getObjectUrl(slot: SlotId): string | null;
  getTrackUrl(): string | null;
  destroy(): void;
}

interface SlotRecord {
  readonly video: HTMLVideoElement;
  objectUrl: string | null;
  generation: number;
  removeListeners: (() => void) | null;
  settle: ((outcome: MediaLoadOutcome) => void) | null;
}

/** Same bookkeeping as a video slot, for the one audio element. */
interface TrackRecord {
  readonly audio: HTMLAudioElement;
  objectUrl: string | null;
  generation: number;
  removeListeners: (() => void) | null;
  settle: ((outcome: MediaLoadOutcome) => void) | null;
}

const SLOT_IDS: readonly SlotId[] = ['a', 'b'];

function createVideoElement(slot: SlotId): HTMLVideoElement {
  const video = document.createElement('video');
  video.className = 'video-layer';
  video.dataset.slot = slot;
  // The stage shows the first frame before playback exists, so the element is allowed to
  // buffer local data. Blob URLs are read from disk, never uploaded.
  video.preload = 'auto';
  video.muted = true;
  video.playsInline = true;
  video.tabIndex = -1;
  video.setAttribute('playsinline', '');
  video.setAttribute('aria-hidden', 'true');
  return video;
}

function createTrackElement(): HTMLAudioElement {
  const audio = document.createElement('audio');
  audio.className = 'track-layer';
  audio.preload = 'auto';
  // Muted until the mixer applies a level: an unmuted element that is never played would still
  // be a (silent) autoplay surface, and the mixer starts every channel at 0 anyway.
  audio.muted = true;
  audio.tabIndex = -1;
  audio.setAttribute('aria-hidden', 'true');
  return audio;
}

export function createMediaLoader(options: MediaLoaderOptions): MediaLoader {
  const records: Record<SlotId, SlotRecord> = {
    a: {
      video: createVideoElement('a'),
      objectUrl: null,
      generation: 0,
      removeListeners: null,
      settle: null,
    },
    b: {
      video: createVideoElement('b'),
      objectUrl: null,
      generation: 0,
      removeListeners: null,
      settle: null,
    },
  };

  const track: TrackRecord = {
    audio: createTrackElement(),
    objectUrl: null,
    generation: 0,
    removeListeners: null,
    settle: null,
  };

  // The stage mounts the video elements, so a host is optional; without one they stay detached
  // until a stage adopts them. The audio element is never rendered, and it is attached to the
  // document on purpose: a detached media element is played by every current browser, but
  // Safari has historically been unreliable about it, and an unrendered <audio> costs nothing.
  options.host?.append(records.a.video, records.b.video);
  document.body.append(track.audio);

  /** Detaches the listeners of the in-flight attempt, if any. */
  function detachListeners(record: SlotRecord): void {
    record.removeListeners?.();
    record.removeListeners = null;
  }

  /** Resolves the pending attempt exactly once; later calls are no-ops. */
  function settle(record: SlotRecord, outcome: MediaLoadOutcome): void {
    detachListeners(record);
    const resolve = record.settle;
    record.settle = null;
    resolve?.(outcome);
  }

  /** Revokes the URL and detaches `src` so the element stops reading the old file. */
  function releaseSource(record: SlotRecord): void {
    if (record.objectUrl !== null) {
      URL.revokeObjectURL(record.objectUrl);
      record.objectUrl = null;
    }

    record.video.removeAttribute('src');
    // `load()` aborts any pending metadata request and resets the media element.
    record.video.load();
  }

  function clear(slot: SlotId): void {
    const record = records[slot];
    record.generation += 1;
    settle(record, { status: 'superseded' });
    releaseSource(record);
  }

  function load(slot: SlotId, file: File): Promise<MediaLoadOutcome> {
    const record = records[slot];

    // Revokes the previous URL *before* the replacement URL is created.
    clear(slot);

    const generation = record.generation;
    const objectUrl = URL.createObjectURL(file);
    record.objectUrl = objectUrl;

    const { video } = record;

    return new Promise<MediaLoadOutcome>((resolve) => {
      // A queued event from the previous file must never settle the new attempt.
      const isCurrent = (): boolean =>
        record.generation === generation && record.objectUrl === objectUrl;

      const onLoadedMetadata = (): void => {
        if (!isCurrent()) {
          return;
        }

        settle(record, {
          status: 'loaded',
          metadata: {
            duration: video.duration,
            width: video.videoWidth,
            height: video.videoHeight,
          },
        });
      };

      const onError = (): void => {
        if (!isCurrent()) {
          return;
        }

        const kind = classifyMediaError(video.error?.code ?? null);
        settle(record, { status: 'error', kind, message: mediaErrorMessage(kind, file.name) });
      };

      record.removeListeners = () => {
        video.removeEventListener('loadedmetadata', onLoadedMetadata);
        video.removeEventListener('error', onError);
      };
      record.settle = resolve;

      video.addEventListener('loadedmetadata', onLoadedMetadata);
      video.addEventListener('error', onError);

      video.src = objectUrl;
      video.load();
    });
  }

  /**
   * Points one slot at a URL and resolves once metadata (or an error) arrives for it.
   * `clear()`/`load()` invalidate the attempt through the record's `settle` hook, so a
   * swap can never finish against a source that was already released.
   */
  function attachSource(
    record: SlotRecord,
    url: string,
  ): Promise<'ok' | 'error' | 'superseded'> {
    const { video } = record;

    return new Promise((resolve) => {
      let settled = false;

      // Each attempt owns its listener pair. A superseded attempt still detaches them: the
      // record hook is shared, so leaving this to `detachListeners` would leak a pair per
      // interrupted swap and could let an old attempt detach a newer attempt's listeners.
      const removeOwnListeners = (): void => {
        video.removeEventListener('loadedmetadata', onLoadedMetadata);
        video.removeEventListener('error', onError);
      };

      const finish = (result: 'ok' | 'error' | 'superseded'): void => {
        if (settled) {
          return;
        }

        settled = true;
        removeOwnListeners();

        if (record.removeListeners === removeOwnListeners) {
          record.removeListeners = null;
        }

        if (record.settle === cancel) {
          record.settle = null;
        }

        resolve(result);
      };

      const onLoadedMetadata = (): void => {
        if (record.objectUrl === url) {
          finish('ok');
        }
      };

      const onError = (): void => {
        if (record.objectUrl === url) {
          finish('error');
        }
      };

      const cancel = (): void => finish('superseded');

      record.removeListeners = removeOwnListeners;
      record.settle = cancel;

      video.addEventListener('loadedmetadata', onLoadedMetadata);
      video.addEventListener('error', onError);

      video.src = url;
      video.load();
    });
  }

  /**
   * Exchanges the two sources without touching the object URLs: both stay valid, so nothing
   * needs revoking, and each file simply plays in the other element. Any metadata request
   * still in flight for the old assignment is superseded first.
   */
  async function swapSources(): Promise<MediaSwapOutcome> {
    const a = records.a;
    const b = records.b;
    const urlA = a.objectUrl;
    const urlB = b.objectUrl;

    if (urlA === null || urlB === null) {
      return { status: 'superseded' };
    }

    a.generation += 1;
    b.generation += 1;
    settle(a, { status: 'superseded' });
    settle(b, { status: 'superseded' });

    a.objectUrl = urlB;
    b.objectUrl = urlA;

    const [resultA, resultB] = await Promise.all([
      attachSource(a, urlB),
      attachSource(b, urlA),
    ]);

    if (a.objectUrl !== urlB || b.objectUrl !== urlA) {
      return { status: 'superseded' };
    }

    if (resultA === 'superseded' || resultB === 'superseded') {
      return { status: 'superseded' };
    }

    const failingSlot: SlotId | null =
      resultA === 'error' ? 'a' : resultB === 'error' ? 'b' : null;

    if (failingSlot === null) {
      return { status: 'swapped' };
    }

    const kind = classifyMediaError(records[failingSlot].video.error?.code ?? null);

    // Put the original assignment back: a failed swap must not leave the elements crossed
    // while the app state still believes the files never moved.
    a.objectUrl = urlA;
    b.objectUrl = urlB;
    a.generation += 1;
    b.generation += 1;
    await Promise.all([attachSource(a, urlA), attachSource(b, urlB)]);

    return { status: 'error', slot: failingSlot, kind };
  }

  function releaseAll(): void {
    for (const slot of SLOT_IDS) {
      clear(slot);
    }

    clearTrack();
  }

  /**
   * Track bookkeeping. Deliberately a mirror of the slot path rather than a shared generic: the
   * element type differs, the outcome carries no picture size, and keeping it separate means the
   * video path — the one with the swap logic — is untouched by this feature.
   */
  function detachTrackListeners(): void {
    track.removeListeners?.();
    track.removeListeners = null;
  }

  function settleTrack(outcome: MediaLoadOutcome): void {
    detachTrackListeners();
    const resolve = track.settle;
    track.settle = null;
    resolve?.(outcome);
  }

  function releaseTrackSource(): void {
    if (track.objectUrl !== null) {
      URL.revokeObjectURL(track.objectUrl);
      track.objectUrl = null;
    }

    track.audio.removeAttribute('src');
    track.audio.load();
  }

  function clearTrack(): void {
    track.generation += 1;
    settleTrack({ status: 'superseded' });
    releaseTrackSource();
  }

  function loadTrack(file: File): Promise<MediaLoadOutcome> {
    // Revokes the previous URL *before* the replacement URL is created.
    clearTrack();

    const generation = track.generation;
    const objectUrl = URL.createObjectURL(file);
    track.objectUrl = objectUrl;

    const { audio } = track;

    return new Promise<MediaLoadOutcome>((resolve) => {
      const isCurrent = (): boolean =>
        track.generation === generation && track.objectUrl === objectUrl;

      const onLoadedMetadata = (): void => {
        if (!isCurrent()) {
          return;
        }

        settleTrack({
          status: 'loaded',
          metadata: { duration: audio.duration, width: 0, height: 0 },
        });
      };

      const onError = (): void => {
        if (!isCurrent()) {
          return;
        }

        const kind = classifyMediaError(audio.error?.code ?? null);
        settleTrack({ status: 'error', kind, message: mediaErrorMessage(kind, file.name) });
      };

      track.removeListeners = () => {
        audio.removeEventListener('loadedmetadata', onLoadedMetadata);
        audio.removeEventListener('error', onError);
      };
      track.settle = resolve;

      audio.addEventListener('loadedmetadata', onLoadedMetadata);
      audio.addEventListener('error', onError);

      audio.src = objectUrl;
      audio.load();
    });
  }

  // `pagehide` teardown is owned by the composition root, which pauses playback before it
  // calls `releaseAll()`: a second listener here would revoke the URLs under the engine.
  return {
    videoA: records.a.video,
    videoB: records.b.video,
    audioTrack: track.audio,
    load,
    swap: swapSources,
    loadTrack,
    clear,
    clearTrack,
    releaseAll,
    getObjectUrl: (slot) => records[slot].objectUrl,
    getTrackUrl: () => track.objectUrl,
    destroy: () => {
      releaseAll();
      records.a.video.remove();
      records.b.video.remove();
      track.audio.remove();
    },
  };
}
