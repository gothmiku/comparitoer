import { clampVolume } from './logic/mix';
import type { AudioMix, SlotId } from './state';

/**
 * The audio mixer: the only module that controls how loud either video is.
 *
 * Why Web Audio instead of `HTMLMediaElement.volume`
 * ------------------------------------------------
 * Two `<video>` elements each drive their own audio pipeline. Setting `volume` on one of
 * them mid-playback goes through that pipeline (it is read-only on iOS, and the elements are
 * serviced independently), which is exactly the kind of thing that shifts a decoded stream
 * relative to the other. Routing both elements through one `AudioContext` instead gives:
 *
 * - one gain stage per source, summed by one output clock, so the two soundtracks are mixed
 *   by the browser's audio graph rather than by two competing pipelines;
 * - click-free level changes (`setTargetAtTime`, 10 ms) that never touch the decoder, so a
 *   slider drag cannot disturb playback at all;
 * - real gain control on iOS, where `volume` is ignored.
 *
 * Fallback: when `AudioContext` is unavailable, or the context cannot be resumed (autoplay
 * policy, no gesture yet), the element's own `volume`/`muted` are used. The graph is only
 * taken over once the context is actually running, because a suspended context routing the
 * media elements would silence them.
 *
 * A `MediaElementAudioSourceNode` can only be created once per element, so the graph is built
 * lazily and never rebuilt.
 *
 * The external track is a third channel, not a switch: loading one turns the video levels down
 * (the composition root does that), but every fader stays live, so "play A's sound, then B's,
 * then the track" is three level changes rather than a mode the mixer can get stuck in.
 */

/** Elements whose levels this module owns. */
export interface AudioMixerOptions {
  readonly videoA: HTMLVideoElement;
  readonly videoB: HTMLVideoElement;
  /** Optional third source; when absent the mixer behaves exactly as before. */
  readonly track?: HTMLAudioElement;
}

export interface AudioMixer {
  /** Applies the two video levels. Safe before the graph exists: the element path is used. */
  setMix(mix: AudioMix): void;
  /** Gain of the external track, 0-1. */
  setTrackLevel(level: number): void;
  /**
   * Starts the audio graph. Must be called from a user gesture (click, key, pointer) so the
   * autoplay policy lets the context run; a no-op once the graph is up.
   */
  unlock(): void;
  /** Re-asserts the current levels, e.g. after a source swap. */
  refresh(): void;
  /**
   * Fades one source out and back in around a corrective seek, so the decoder rebuild that a
   * seek forces is heard as a short dip rather than a click or a dropout. `'track'` ducks the
   * external track.
   */
  duck(slot: SlotId | 'track', holdMs: number): void;
  destroy(): void;
}

/** Fade used for every level change so a drag is inaudible as clicks. */
const GAIN_RAMP_SECONDS = 0.01;

/** Fade in/out time for a duck around a corrective seek. */
const DUCK_FADE_SECONDS = 0.012;

/** Keeps float rounding from producing a non-zero gain at a level the user set to 0. */
const SILENCE_THRESHOLD = 1e-4;

/** The audio-track channel shares the slot machinery but is not a video slot. */
type ChannelId = SlotId | 'track';

const CHANNELS: readonly ChannelId[] = ['a', 'b', 'track'];

interface AudioGraph {
  readonly context: AudioContext;
  readonly gains: Record<ChannelId, GainNode>;
}

interface ContextConstructor {
  new (): AudioContext;
}

/** Safari still ships the prefixed constructor on older versions. */
function getAudioContextConstructor(): ContextConstructor | null {
  const candidate =
    (window as unknown as { AudioContext?: ContextConstructor }).AudioContext ??
    (window as unknown as { webkitAudioContext?: ContextConstructor }).webkitAudioContext;

  return typeof candidate === 'function' ? candidate : null;
}


/** Fallback used before the graph exists: levels applied straight to the elements. */
function applyElementLevel(
  element: HTMLMediaElement,
  level: number,
): void {
  // A silent channel is muted outright so the browser can skip its soundtrack entirely.
  element.volume = level < SILENCE_THRESHOLD ? 0 : level;
  element.muted = level < SILENCE_THRESHOLD;
}

export function createAudioMixer(options: AudioMixerOptions): AudioMixer {
  const videos: Record<SlotId, HTMLVideoElement> = {
    a: options.videoA,
    b: options.videoB,
  };

  const track = options.track ?? null;

  let mix: AudioMix = { a: 1, b: 0 };
  let trackLevel = 1;
  let graph: AudioGraph | null = null;
  let context: AudioContext | null = null;
  let unavailable = false;
  let destroyed = false;
  /** Elements already wired into a graph; a second source node for one element throws. */
  const wired = new Set<ChannelId>();

  /**
   * The level a channel should reach.
   *
   * Every channel owns exactly one number. The third source is *not* an override that silences
   * the videos: it is a third fader, so whichever slider the user touches is the one that is
   * heard. An override here made the video sliders dead while a track was loaded, which is
   * indistinguishable from broken audio.
   */
  function effectiveLevel(channel: ChannelId): number {
    return channel === 'track' ? clampVolume(trackLevel) : clampVolume(mix[channel]);
  }

  function elementFor(channel: ChannelId): HTMLMediaElement | null {
    return channel === 'track' ? track : videos[channel];
  }

  function applyElementLevels(): void {
    for (const channel of CHANNELS) {
      const element = elementFor(channel);

      if (element !== null) {
        applyElementLevel(element, effectiveLevel(channel));
      }
    }
  }

  function applyGains(): void {
    if (graph === null) {
      return;
    }

    for (const channel of CHANNELS) {
      // A ramp instead of an assignment: a slider drag produces a stream of values and a
      // direct write would step the gain, which is audible as zipper noise. Any duck in
      // flight is dropped first: the user just moved this slider, so their value wins.
      const gain = graph.gains[channel].gain;

      gain.cancelScheduledValues(graph.context.currentTime);
      gain.setTargetAtTime(
        effectiveLevel(channel),
        graph.context.currentTime,
        GAIN_RAMP_SECONDS,
      );
    }
  }

  function apply(): void {
    if (graph === null) {
      applyElementLevels();
      return;
    }

    applyGains();
  }

  /**
   * Wires every channel into the running context. Element `volume`/`muted` must be neutral
   * afterwards: a muted element feeds silence into its source node.
   */
  function buildGraph(active: AudioContext): boolean {
    if (destroyed || graph !== null) {
      return graph !== null;
    }

    // An element can only ever belong to one source node. If a previous attempt wired one of
    // them and then failed, a fresh gain node would not be fed by it; keep the element path
    // instead of building a half-silent graph.
    if (wired.size > 0) {
      unavailable = true;
      void active.close().catch(() => undefined);
      return false;
    }

    const gains: Record<ChannelId, GainNode> = {
      a: active.createGain(),
      b: active.createGain(),
      track: active.createGain(),
    };

    for (const channel of CHANNELS) {
      const element = elementFor(channel);

      if (element === null) {
        continue;
      }

      try {
        active.createMediaElementSource(element).connect(gains[channel]);
        wired.add(channel);
      } catch {
        // Bound to another context already: keep the element path rather than go silent.
        unavailable = true;
        void active.close().catch(() => undefined);
        wired.clear();
        return false;
      }

      // A muted element feeds silence into its source node, and its `volume` would apply a
      // second gain on top of ours.
      element.muted = false;
      element.volume = 1;

      // Start silent: a fresh GainNode is at 1, so connecting it first would let a channel the
      // user muted play at full level for one tick.
      gains[channel].gain.value = 0;
      gains[channel].connect(active.destination);
    }

    graph = { context: active, gains };
    applyGains();

    return true;
  }

  function unlock(): void {
    if (destroyed || unavailable) {
      return;
    }

    if (context !== null) {
      // Already created; a suspended context needs a gesture to start, and every gesture
      // retries because the graph is only adopted once the context actually runs.
      if (context.state !== 'running') {
        void context.resume().catch(() => undefined);
      } else {
        buildGraph(context);
      }

      return;
    }

    const Ctor = getAudioContextConstructor();

    if (Ctor === null) {
      unavailable = true;
      return;
    }

    let created: AudioContext;

    try {
      created = new Ctor();
    } catch {
      unavailable = true;
      return;
    }

    context = created;
    created.addEventListener('statechange', () => {
      if (created.state === 'running') {
        buildGraph(created);
      }
    });

    void created
      .resume()
      .then(() => {
        if (created.state === 'running') {
          buildGraph(created);
        }
      })
      .catch(() => {
        unavailable = true;
      });
  }

  apply();

  return {
    setMix: (next) => {
      if (destroyed) {
        return;
      }

      mix = { a: clampVolume(next.a), b: clampVolume(next.b) };
      apply();
    },
    setTrackLevel: (level) => {
      if (destroyed) {
        return;
      }

      trackLevel = clampVolume(level);
      apply();
    },
    unlock,
    refresh: () => {
      if (!destroyed) {
        apply();
      }
    },
    duck: (channel, holdMs) => {
      if (destroyed || graph === null) {
        // Without a graph there is no gain to automate; the element path keeps playing and
        // the seek's own dropout is all that happens.
        return;
      }

      const { context } = graph;
      const gain = graph.gains[channel].gain;
      const now = context.currentTime;
      const level = effectiveLevel(channel);
      const hold = Math.max(holdMs, 0) / 1000;

      gain.cancelScheduledValues(now);
      gain.setValueAtTime(gain.value, now);
      gain.linearRampToValueAtTime(0, now + DUCK_FADE_SECONDS);
      gain.setValueAtTime(0, now + DUCK_FADE_SECONDS + hold);
      gain.linearRampToValueAtTime(level, now + DUCK_FADE_SECONDS * 2 + hold);
    },
    destroy: () => {
      if (destroyed) {
        return;
      }

      destroyed = true;

      if (graph !== null) {
        for (const channel of CHANNELS) {
          graph.gains[channel].disconnect();
        }
      }

      graph = null;

      if (context !== null) {
        void context.close().catch(() => undefined);
        context = null;
      }

      wired.clear();
    },
  };
}
