/**
 * One video's own transport row, used twice in independent mode.
 *
 * Deliberately built from the same parts as the shared bar — a native range input, a plain
 * button, a monospace readout — so a row behaves exactly like the transport the user already
 * knows, only scoped to a single element. Like `controls.ts`, this module owns no playback
 * state: every action goes through a callback, and the engine remains the only writer of
 * `currentTime`, `play()` and `pause()`.
 */

import { formatTime } from '../logic/format';
import type { SlotId } from '../state';

/** Snapshot one row renders from; produced by the composition root. */
export interface SlotTransportState {
  readonly playing: boolean;
  readonly currentTime: number;
  /** That video's own duration; NaN until its metadata is known. */
  readonly durationSeconds: number;
  /** False while the slot has no usable file, which disables the whole row. */
  readonly enabled: boolean;
}

export interface SlotTransportOptions {
  readonly host: HTMLElement;
  readonly slot: SlotId;
  /** Play/pause for this video only. */
  onTogglePlay: () => void;
  /** Pointer down on this row's scrubber. */
  onBeginScrub: () => void;
  /** Newest position for this row; the engine throttles the actual seeks. */
  onScrubTo: (seconds: number) => void;
  /** Pointer released or keyboard change committed. */
  onEndScrub: () => void;
  /** One frame backwards (-1) or forwards (+1) on this video. */
  onStep: (direction: -1 | 1) => void;
}

export interface SlotTransport {
  readonly element: HTMLElement;
  render(state: SlotTransportState): void;
  destroy(): void;
}

/** Steps per second of the row's scrubber. */
const SCRUB_STEPS_PER_SECOND = 1000;

/** Smallest step a range input accepts without collapsing the track to one value. */
const MIN_SCRUB_STEP = 0.001;

function usableDuration(seconds: number): number {
  return Number.isFinite(seconds) && seconds > 0 ? seconds : 0;
}

export function createSlotTransport(options: SlotTransportOptions): SlotTransport {
  const letter = options.slot.toUpperCase();

  const root = document.createElement('div');
  root.className = 'transport';
  root.dataset.slot = options.slot;
  root.setAttribute('role', 'group');
  root.setAttribute('aria-label', `Video ${letter} transport`);

  const badge = document.createElement('span');
  badge.className = 'transport__badge';
  badge.textContent = letter;
  badge.setAttribute('aria-hidden', 'true');

  const playButton = document.createElement('button');
  playButton.className = 'transport__play';
  playButton.type = 'button';
  playButton.textContent = 'Play';
  playButton.setAttribute('aria-label', `Play video ${letter}`);
  playButton.disabled = true;

  const range = document.createElement('input');
  range.className = 'transport__range';
  range.type = 'range';
  range.min = '0';
  range.max = '0';
  range.step = String(MIN_SCRUB_STEP);
  range.value = '0';
  range.disabled = true;
  range.setAttribute('aria-label', `Video ${letter} timeline`);
  range.setAttribute('aria-valuetext', `${formatTime(0)} of ${formatTime(Number.NaN)}`);

  const readout = document.createElement('span');
  readout.className = 'transport__time';
  readout.textContent = `${formatTime(0)} / ${formatTime(Number.NaN)}`;

  const stepBack = document.createElement('button');
  stepBack.className = 'transport__step';
  stepBack.type = 'button';
  stepBack.textContent = '◀';
  stepBack.setAttribute('aria-label', `Previous frame of video ${letter}`);
  stepBack.title = 'Previous frame';
  stepBack.disabled = true;

  const stepForward = document.createElement('button');
  stepForward.className = 'transport__step';
  stepForward.type = 'button';
  stepForward.textContent = '▶';
  stepForward.setAttribute('aria-label', `Next frame of video ${letter}`);
  stepForward.title = 'Next frame';
  stepForward.disabled = true;

  root.append(badge, playButton, range, readout, stepBack, stepForward);
  options.host.append(root);

  let scrubbing = false;
  let destroyed = false;

  const onPlayClick = (): void => {
    options.onTogglePlay();
  };

  const onPointerDown = (): void => {
    if (range.disabled) {
      return;
    }

    scrubbing = true;
    options.onBeginScrub();
  };

  const onRangeInput = (): void => {
    options.onScrubTo(Number(range.value));
  };

  /** `change` fires on release (pointer) and on every keyboard adjustment. */
  const onRangeChange = (): void => {
    scrubbing = false;
    options.onEndScrub();
  };

  // A drag that ends outside the range still has to release the scrub in the engine.
  const onWindowPointerEnd = (): void => {
    if (!scrubbing) {
      return;
    }

    scrubbing = false;
    options.onEndScrub();
  };

  const onStepBack = (): void => {
    options.onStep(-1);
  };

  const onStepForward = (): void => {
    options.onStep(1);
  };

  playButton.addEventListener('click', onPlayClick);
  range.addEventListener('pointerdown', onPointerDown);
  range.addEventListener('input', onRangeInput);
  range.addEventListener('change', onRangeChange);
  stepBack.addEventListener('click', onStepBack);
  stepForward.addEventListener('click', onStepForward);
  window.addEventListener('pointerup', onWindowPointerEnd);
  window.addEventListener('pointercancel', onWindowPointerEnd);

  return {
    element: root,
    render: (state) => {
      if (destroyed) {
        return;
      }

      const duration = usableDuration(state.durationSeconds);
      const enabled = state.enabled && duration > 0;

      playButton.disabled = !enabled;
      range.disabled = !enabled;
      stepBack.disabled = !enabled;
      stepForward.disabled = !enabled;

      const label = state.playing ? 'Pause' : 'Play';

      playButton.textContent = label;
      playButton.setAttribute('aria-label', `${label} video ${letter}`);

      const step = Math.max(
        duration / SCRUB_STEPS_PER_SECOND,
        MIN_SCRUB_STEP,
      );

      if (range.max !== String(duration)) {
        range.max = String(duration);
      }

      if (range.step !== String(step)) {
        range.step = String(step);
      }

      // Never fight the user's thumb: the engine echoes the target back immediately.
      if (!scrubbing) {
        range.value = String(Math.min(Math.max(state.currentTime, 0), duration));
      }

      readout.textContent = `${formatTime(state.currentTime)} / ${formatTime(state.durationSeconds)}`;
      range.setAttribute(
        'aria-valuetext',
        `${formatTime(state.currentTime)} of ${formatTime(state.durationSeconds)}`,
      );
    },
    destroy: () => {
      destroyed = true;
      playButton.removeEventListener('click', onPlayClick);
      range.removeEventListener('pointerdown', onPointerDown);
      range.removeEventListener('input', onRangeInput);
      range.removeEventListener('change', onRangeChange);
      stepBack.removeEventListener('click', onStepBack);
      stepForward.removeEventListener('click', onStepForward);
      window.removeEventListener('pointerup', onWindowPointerEnd);
      window.removeEventListener('pointercancel', onWindowPointerEnd);
      root.remove();
    },
  };
}
