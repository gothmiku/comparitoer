import {
  formatVolume,
  isMixBlended,
  isMixSilent,
  percentToVolume,
  volumeToPercent,
} from '../logic/mix';
import type { AudioMix } from '../state';

/** Snapshot the panel renders from; produced by the composition root. */
export interface MixOptions {
  readonly host: HTMLElement;
  /** Initial levels, mirrored from AppState. */
  readonly mix: AudioMix;
  /** Initial gain of the external track. */
  readonly trackLevel: number;
  /** Fires on every slider move; the engine applies the level immediately. */
  onMixChange: (mix: AudioMix) => void;
  /** Fires on every move of the track slider. */
  onTrackLevelChange: (level: number) => void;
  /**
   * True while a level is being dragged with a pointer, false when the gesture ends.
   *
   * Changing the gain of a playing media element makes the browser rebuild its audio path,
   * and two elements are serviced independently — so a continuous drag can leave the pair
   * audibly (and measurably) offset. The composition root pauses playback for the whole
   * gesture and re-aligns on release, which is why this is reported rather than handled here.
   * A single keyboard adjustment is a discrete step and does not pause anything.
   */
  onAdjustingChange?: (adjusting: boolean) => void;
}

/** What the panel needs to know about the third source. */
export interface MixTrackView {
  /** A track has loaded, so its channel is meaningful. */
  readonly loaded: boolean;
  /** The track can be heard right now (loaded and above 0 %). */
  readonly active: boolean;
  readonly label: string;
}

/** One level slider per source, plus a badge and percent read-out for each. */
export interface MixPanel {
  readonly element: HTMLElement;
  /** External state -> view; never overwrites a slider the user is currently dragging. */
  render(mix: AudioMix): void;
  /** External state -> the track slider, e.g. after the `M` cycle moved it. */
  renderTrackLevel(level: number): void;
  /** Shows or hides the track channel and its hint. */
  renderTrack(view: MixTrackView): void;
  destroy(): void;
}

export type MixFactory = (options: MixOptions) => MixPanel;

interface Channel {
  readonly root: HTMLElement;
  readonly range: HTMLInputElement;
  readonly value: HTMLSpanElement;
}

function createChannel(
  id: 'a' | 'b' | 'track',
  label: string,
  title: string,
): Channel {
  const root = document.createElement('div');
  root.className = 'mix__channel';
  root.dataset.slot = id;

  const badge = document.createElement('span');
  badge.className = 'mix__badge';
  badge.textContent = id === 'track' ? '♪' : id.toUpperCase();
  badge.setAttribute('aria-hidden', 'true');

  const range = document.createElement('input');
  range.className = 'mix__range';
  range.type = 'range';
  range.min = '0';
  range.max = '100';
  range.step = '1';
  range.value = '0';
  range.setAttribute('aria-label', label);
  range.title = title;

  const value = document.createElement('span');
  value.className = 'mix__value';

  root.append(badge, range, value);

  return { root, range, value };
}

/**
 * The audio mixer: one slider per video.
 *
 * Both videos have their own soundtrack and their own media element, so they are mixed by the
 * browser rather than switched. The panel only reports intent; the sync engine owns `volume`
 * and `muted` on the elements, exactly like it owns their playback.
 *
 * The sliders are native `<input type="range">` elements: keyboard support, touch dragging and
 * screen-reader semantics come for free, and each one is a 44 px touch target.
 */
export function createMix(options: MixOptions): MixPanel {
  const root = document.createElement('div');
  root.className = 'mix';
  root.setAttribute('role', 'group');
  root.setAttribute('aria-label', 'Audio mix');

  const title = document.createElement('span');
  title.className = 'mix__title';
  title.textContent = 'Audio';
  title.setAttribute('aria-hidden', 'true');

  // Both sliders at 0 % is a valid state with no obvious symptom, so it is named explicitly.
  const silent = document.createElement('span');
  silent.className = 'mix__silent';
  silent.textContent = 'Silent';
  silent.hidden = true;

  const channelA = createChannel(
    'a',
    'Video A volume',
    'Video A volume — playback pauses while you drag',
  );
  const channelB = createChannel(
    'b',
    'Video B volume',
    'Video B volume — playback pauses while you drag',
  );
  const channelTrack = createChannel(
    'track',
    'Audio track volume',
    'Audio track volume — mixed in with the videos',
  );

  /** The third channel only exists once a track is loaded, so it starts hidden. */
  channelTrack.root.hidden = true;

  /**
   * Honest note for the blended state: the two media elements are mixed by the browser's
   * audio graph with independent buffering, so a few milliseconds of offset can survive even
   * when the engine has both `currentTime`s aligned. Nothing here can fix that; saying so
   * beats a user chasing an unfixable "still desynced" feeling.
   */
  const note = document.createElement('p');
  note.className = 'mix__note';
  note.textContent =
    'Both soundtracks are mixed. The two players can sit a few milliseconds apart even when their pictures match.';
  note.hidden = true;

  /** Explains why the two video sliders went quiet when a track took over. */
  const trackNote = document.createElement('p');
  trackNote.className = 'mix__note';
  trackNote.hidden = true;

  root.append(title, silent, channelA.root, channelB.root, channelTrack.root, note, trackNote);
  options.host.append(root);

  let destroyed = false;
  /** The channel whose thumb the user is dragging; only that one must not be overwritten. */
  let draggingChannel: Channel | null = null;
  /** True from the first level change of a gesture until its `change`/release. */
  let adjusting = false;

  const setAdjusting = (next: boolean): void => {
    if (next === adjusting) {
      return;
    }

    adjusting = next;
    options.onAdjustingChange?.(next);
  };

  /** Latest track view, so the "Silent" chip can account for the third source. */
  let trackState: MixTrackView = { loaded: false, active: false, label: '' };
  let trackLevelValue = options.trackLevel;

  /**
   * "Silent" is only true when nothing is audible at all. A loaded track at 0 % is silent, and
   * so is a track that has not loaded yet — the chip counts what can actually be heard.
   */
  const showSilence = (mix: AudioMix): void => {
    const trackAudible = trackState.loaded && trackLevelValue > 0.001;

    silent.hidden = !(isMixSilent(mix) && !trackAudible);
    note.hidden = !isMixBlended(mix);
    trackNote.hidden = !trackState.loaded;
  };

  const showLevel = (channel: Channel, level: number): void => {
    const percent = volumeToPercent(level);
    const text = formatVolume(level);

    channel.value.textContent = text;
    channel.range.setAttribute('aria-valuetext', text);

    // Never fight the user's thumb: the engine echoes the value back, and a re-render during
    // a drag must not move it. A focused but idle slider still follows external changes, so
    // pressing `M` while a slider has focus updates both channels.
    if (channel !== draggingChannel) {
      channel.range.value = String(percent);
    }
  };

  const currentMix = (): AudioMix => ({
    a: percentToVolume(channelA.range.valueAsNumber),
    b: percentToVolume(channelB.range.valueAsNumber),
  });

  const onInput = (): void => {
    const mix = currentMix();

    showLevel(channelA, mix.a);
    showLevel(channelB, mix.b);
    showSilence(mix);
    options.onMixChange(mix);
  };

  /** The track has its own callback: it is not part of the two-video mix. */
  const onTrackInput = (): void => {
    const level = percentToVolume(channelTrack.range.valueAsNumber);

    trackLevelValue = level;
    showLevel(channelTrack, level);
    showSilence(currentMix());
    options.onTrackLevelChange(level);
  };

  /** The pause gesture starts with the pointer, so a keyboard step never stops playback. */
  const onRangePointerDown = (event: PointerEvent): void => {
    const target = event.currentTarget;

    draggingChannel =
      target === channelB.range
        ? channelB
        : target === channelTrack.range
          ? channelTrack
          : channelA;

    setAdjusting(true);
  };

  /** `change` fires on pointer release and after each committed keyboard adjustment. */
  const onRangeChange = (): void => {
    draggingChannel = null;
    setAdjusting(false);
  };

  const onPointerEnd = (): void => {
    draggingChannel = null;
    setAdjusting(false);
  };

  const channels = [channelA, channelB, channelTrack];

  for (const channel of channels) {
    channel.range.addEventListener('input', channel === channelTrack ? onTrackInput : onInput);
    channel.range.addEventListener('change', onRangeChange);
    channel.range.addEventListener('pointerdown', onRangePointerDown);
  }

  window.addEventListener('pointerup', onPointerEnd);
  window.addEventListener('pointercancel', onPointerEnd);
  window.addEventListener('blur', onPointerEnd);

  const render = (mix: AudioMix): void => {
    if (destroyed) {
      return;
    }

    showLevel(channelA, mix.a);
    showLevel(channelB, mix.b);
    showSilence(mix);
  };

  const renderTrack = (view: MixTrackView): void => {
    if (destroyed) {
      return;
    }

    trackState = view;

    channelTrack.root.hidden = !view.loaded;
    channelTrack.range.disabled = !view.loaded;

    showSilence(currentMix());

    if (view.loaded) {
      const name = view.label.trim();

      trackNote.textContent = view.active
        ? `${name} is mixed in with the videos.`
        : `${name} is loaded but silent — raise its level to hear it.`;
    }
  };

  /** The track fader, e.g. after `M` moved it: the slider must not disagree with the mixer. */
  const renderTrackLevel = (level: number): void => {
    if (destroyed) {
      return;
    }

    trackLevelValue = percentToVolume(volumeToPercent(level));
    showLevel(channelTrack, trackLevelValue);
    showSilence(currentMix());
  };

  render(options.mix);
  showLevel(channelTrack, options.trackLevel);
  renderTrack({ loaded: false, active: false, label: '' });

  return {
    element: root,
    render,
    renderTrackLevel,
    renderTrack,
    destroy: () => {
      destroyed = true;

      for (const channel of channels) {
        channel.range.removeEventListener('input', onInput);
        channel.range.removeEventListener('input', onTrackInput);
        channel.range.removeEventListener('change', onRangeChange);
        channel.range.removeEventListener('pointerdown', onRangePointerDown);
      }

      window.removeEventListener('pointerup', onPointerEnd);
      window.removeEventListener('pointercancel', onPointerEnd);
      window.removeEventListener('blur', onPointerEnd);
      // A teardown mid-drag must not leave the pair paused with no resume path.
      setAdjusting(false);
      root.remove();
    },
  };
}
