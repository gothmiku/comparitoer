import { formatTime } from '../logic/format';
import { formatFrameCounter } from '../logic/fps';
import { formatFps } from '../logic/info';
import {
  formatStepUnitValue,
  parseStepUnit,
  STEP_UNITS,
  stepActionLabel,
  stepUnitLabel,
} from '../logic/step';
import type { StepDirection, StepUnit } from '../logic/step';
import { PLAYBACK_SPEEDS } from '../state';
import type { PlaybackSpeed } from '../state';

/** Snapshot the control bar renders from; produced by the composition root. */
export interface ControlsState {
  readonly playing: boolean;
  readonly currentTime: number;
  /** Timeline length = min(durationA, durationB); NaN or 0 disables the controls. */
  readonly timelineDuration: number;
  readonly speed: PlaybackSpeed;
  readonly loop: boolean;
  /** What one press of the step buttons moves. */
  readonly stepUnit: StepUnit;
  /** Frame index of A at `currentTime`; null until A's frame rate is estimated. */
  readonly frame: number | null;
  /** A's estimated frame rate, used for the frame counter's tooltip. */
  readonly fps: number | null;
  /** Independent mode: each video has its own row, so the shared timeline steps aside. */
  readonly independent: boolean;
  /** True while either video is running (independent mode only). */
  readonly anySlotPlaying: boolean;
}

export interface ControlsOptions {
  readonly host: HTMLElement;
  /** The box that goes fullscreen: stage + controls + info, so playback stays operable. */
  readonly fullscreenTarget: HTMLElement;
  /** Play/pause button funnels through here; the engine decides what it means. */
  onTogglePlay: () => void;
  /** Pointer down on the scrubber: the engine pauses both videos. */
  onBeginScrub: () => void;
  /** Latest scrub position in seconds; the engine throttles the actual seeks. */
  onScrubTo: (seconds: number) => void;
  /** Pointer released or keyboard change committed. */
  onEndScrub: () => void;
  /** Applied to both videos by the engine. */
  onSpeedChange: (speed: PlaybackSpeed) => void;
  onToggleLoop: () => void;
  /** Exchanges the two sources; handled by the composition root. */
  onSwap: () => void;
  /** One press of a step button: -1 backwards, +1 forwards, in the selected unit. */
  onStep: (direction: StepDirection) => void;
  /** A new step unit was picked in the select. */
  onStepUnitChange: (unit: StepUnit) => void;
  /** The independent-mode switch was pressed. */
  onToggleIndependent: () => void;
}

/** Play/pause, timeline, time and frame readouts, speed, loop, swap, fullscreen. */
export interface Controls {
  render(state: ControlsState): void;
  /** Used by the `F` shortcut and the fullscreen button; a no-op when unsupported. */
  toggleFullscreen(): void;
  destroy(): void;
}

export type ControlsFactory = (options: ControlsOptions) => Controls;

/** Steps per second of timeline, so the keyboard moves in fine increments. */
const SCRUB_STEPS_PER_SECOND = 1000;

/** Smallest step a range input accepts without rounding the whole track to one value. */
const MIN_SCRUB_STEP = 0.001;

function usableDuration(seconds: number): number {
  return Number.isFinite(seconds) && seconds > 0 ? seconds : 0;
}

function parsePlaybackSpeed(value: string | undefined): PlaybackSpeed | null {
  const parsed = Number(value);

  return PLAYBACK_SPEEDS.find((speed) => speed === parsed) ?? null;
}

function createButton(className: string, label: string): HTMLButtonElement {
  const button = document.createElement('button');
  button.className = className;
  button.type = 'button';
  button.textContent = label;
  return button;
}

/** A visible label wrapping its select: implicit association, no extra ids needed. */
function createField(labelText: string): { root: HTMLLabelElement; select: HTMLSelectElement } {
  const root = document.createElement('label');
  root.className = 'controls__field';

  const text = document.createElement('span');
  text.className = 'controls__label';
  text.textContent = labelText;

  const select = document.createElement('select');
  select.className = 'controls__select';

  root.append(text, select);

  return { root, select };
}

/**
 * The playback controls.
 *
 * Every control only reports intent through a callback; nothing in this module reads or
 * writes `currentTime`, `play()`, `pause()` or `playbackRate`. That keeps the sync engine the
 * single owner of both elements, so no UI action can desync the pair.
 *
 * The scrubber is a native `<input type="range">`, which gives keyboard support, touch
 * dragging and screen-reader semantics for free. The engine receives three distinct events
 * so it can pause during a drag, seek at most once per animation frame, and resume on
 * release; the value in the input is never overwritten while the user is dragging it.
 */
export function createControls(options: ControlsOptions): Controls {
  const root = document.createElement('div');
  root.className = 'controls';

  const playButton = createButton('controls__play', 'Play');
  playButton.setAttribute('aria-label', 'Play');
  playButton.disabled = true;

  const timelineGroup = document.createElement('div');
  timelineGroup.className = 'controls__timeline';

  const range = document.createElement('input');
  range.className = 'controls__range';
  range.type = 'range';
  range.min = '0';
  range.max = '0';
  range.step = String(MIN_SCRUB_STEP);
  range.value = '0';
  range.disabled = true;
  range.setAttribute('aria-label', 'Timeline');
  range.setAttribute('aria-valuetext', `${formatTime(0)} of ${formatTime(Number.NaN)}`);

  const readout = document.createElement('span');
  readout.className = 'controls__time';
  readout.textContent = `${formatTime(0)} / ${formatTime(Number.NaN)}`;

  timelineGroup.append(range, readout);

  const frame = document.createElement('span');
  frame.className = 'controls__frame';
  frame.textContent = formatFrameCounter(null);
  frame.title = 'Frame of video A (estimated frame rate not available yet)';

  // Step group: one press moves by the selected unit, which is a frame by default so the
  // buttons match the arrow keys until the user asks for something coarser.
  const stepGroup = document.createElement('div');
  stepGroup.className = 'controls__steps';
  stepGroup.setAttribute('role', 'group');
  stepGroup.setAttribute('aria-label', 'Step');

  const stepBackButton = createButton('controls__step', '◀');
  stepBackButton.disabled = true;

  const stepUnitSelect = document.createElement('select');
  stepUnitSelect.className = 'controls__step-unit';
  stepUnitSelect.setAttribute('aria-label', 'Step unit');

  for (const unit of STEP_UNITS) {
    const option = document.createElement('option');
    option.value = formatStepUnitValue(unit);
    option.textContent = stepUnitLabel(unit);
    stepUnitSelect.append(option);
  }

  const stepForwardButton = createButton('controls__step', '▶');
  stepForwardButton.disabled = true;

  stepGroup.append(stepBackButton, stepUnitSelect, stepForwardButton);

  const speedField = createField('Speed');
  speedField.select.setAttribute('aria-label', 'Playback speed');

  for (const speed of PLAYBACK_SPEEDS) {
    const option = document.createElement('option');
    option.value = String(speed);
    option.textContent = `${speed}x`;
    speedField.select.append(option);
  }

  const loopButton = createButton('controls__toggle', 'Loop');
  loopButton.setAttribute('aria-pressed', 'false');
  loopButton.title = 'Loop the shorter timeline (L)';

  // The mode switch sits before the transport it changes, so the bar reads
  // "Independent | Play | timeline | …" and the reason the shared timeline disappeared
  // is always visible.
  const independentButton = createButton('controls__toggle', 'Independent');
  independentButton.setAttribute('aria-pressed', 'false');
  independentButton.title =
    'Give each video its own transport and playhead instead of keeping them in sync';

  const swapButton = createButton('controls__toggle', 'Swap A/B');
  swapButton.title = 'Exchange the two videos, keeping the playhead';
  swapButton.disabled = true;

  const fullscreenButton = createButton('controls__toggle', 'Fullscreen');
  fullscreenButton.setAttribute('aria-pressed', 'false');
  fullscreenButton.title = 'Fullscreen (F)';

  root.append(
    independentButton,
    playButton,
    timelineGroup,
    frame,
    stepGroup,
    speedField.root,
    loopButton,
    swapButton,
    fullscreenButton,
  );
  options.host.append(root);

  const fullscreenSupported =
    document.fullscreenEnabled !== false &&
    typeof options.fullscreenTarget.requestFullscreen === 'function';

  let scrubbing = false;
  let destroyed = false;

  const onPlayClick = (): void => {
    options.onTogglePlay();
  };

  const onIndependentClick = (): void => {
    options.onToggleIndependent();
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

  const onSpeedChange = (): void => {
    const speed = parsePlaybackSpeed(speedField.select.value);

    if (speed !== null) {
      options.onSpeedChange(speed);
    }
  };

  const onLoopClick = (): void => {
    options.onToggleLoop();
  };

  const onSwapClick = (): void => {
    options.onSwap();
  };

  const onStepBackClick = (): void => {
    options.onStep(-1);
  };

  const onStepForwardClick = (): void => {
    options.onStep(1);
  };

  const onStepUnitChange = (): void => {
    const unit = parseStepUnit(stepUnitSelect.value);

    if (unit !== null) {
      options.onStepUnitChange(unit);
    }
  };

  const syncFullscreenButton = (): void => {
    const active = document.fullscreenElement === options.fullscreenTarget;
    const label = active ? 'Exit fullscreen' : 'Fullscreen';

    fullscreenButton.textContent = label;
    fullscreenButton.setAttribute('aria-pressed', active ? 'true' : 'false');
    fullscreenButton.title = active ? 'Leave fullscreen (F)' : 'Fullscreen (F)';
  };

  const toggleFullscreen = (): void => {
    if (destroyed || !fullscreenSupported) {
      return;
    }

    if (document.fullscreenElement !== null) {
      void document.exitFullscreen().catch(() => undefined);
      return;
    }

    void options.fullscreenTarget.requestFullscreen().catch(() => undefined);
  };

  const onFullscreenClick = (): void => {
    toggleFullscreen();
  };

  playButton.addEventListener('click', onPlayClick);
  independentButton.addEventListener('click', onIndependentClick);
  range.addEventListener('pointerdown', onPointerDown);
  range.addEventListener('input', onRangeInput);
  range.addEventListener('change', onRangeChange);
  speedField.select.addEventListener('change', onSpeedChange);
  loopButton.addEventListener('click', onLoopClick);
  swapButton.addEventListener('click', onSwapClick);
  stepBackButton.addEventListener('click', onStepBackClick);
  stepForwardButton.addEventListener('click', onStepForwardClick);
  stepUnitSelect.addEventListener('change', onStepUnitChange);
  fullscreenButton.addEventListener('click', onFullscreenClick);
  window.addEventListener('pointerup', onWindowPointerEnd);
  window.addEventListener('pointercancel', onWindowPointerEnd);
  document.addEventListener('fullscreenchange', syncFullscreenButton);

  return {
    render: (state) => {
      if (destroyed) {
        return;
      }

      const duration = usableDuration(state.timelineDuration);
      const enabled = duration > 0;
      const independent = state.independent;
      const step = enabled
        ? Math.max(duration / SCRUB_STEPS_PER_SECOND, MIN_SCRUB_STEP)
        : MIN_SCRUB_STEP;

      // In independent mode the shared timeline, frame counter and step cluster are replaced by
      // one row per video; leaving them visible would offer two contradictory playheads.
      timelineGroup.hidden = independent;
      frame.hidden = independent;
      stepGroup.hidden = independent;

      independentButton.setAttribute('aria-pressed', independent ? 'true' : 'false');

      // "Play" still means "run both", so it stays usable in independent mode.
      playButton.disabled = !enabled;
      range.disabled = !enabled || independent;
      // Swapping sources in independent mode would have to swap two independent playheads.
      swapButton.disabled = !enabled || independent;
      stepBackButton.disabled = !enabled;
      stepForwardButton.disabled = !enabled;
      stepUnitSelect.disabled = !enabled;
      fullscreenButton.disabled = !enabled || !fullscreenSupported;

      if (range.max !== String(duration)) {
        range.max = String(duration);
      }

      if (range.step !== String(step)) {
        range.step = String(step);
      }

      // Never fight the user's thumb: the engine echoes the scrub target back immediately,
      // but a late `timeUpdate` must not snap the thumb back mid-drag.
      if (!scrubbing) {
        const value = String(Math.min(Math.max(state.currentTime, 0), duration));
        range.value = value;
      }

      const label = state.playing || state.anySlotPlaying ? 'Pause' : 'Play';
      playButton.textContent = label;
      playButton.setAttribute('aria-label', label);
      playButton.title = independent
        ? 'Start or stop both videos (each from its own position)'
        : 'Start or stop both videos in sync';

      const text = `${formatTime(state.currentTime)} / ${formatTime(state.timelineDuration)}`;
      readout.textContent = text;
      range.setAttribute(
        'aria-valuetext',
        `${formatTime(state.currentTime)} of ${formatTime(state.timelineDuration)}`,
      );

      frame.textContent = formatFrameCounter(state.frame);
      frame.title =
        state.fps === null
          ? 'Frame of video A (estimated frame rate not available yet)'
          : `Frame of video A at ${formatFps(state.fps)}`;

      const speedValue = String(state.speed);

      if (speedField.select.value !== speedValue) {
        speedField.select.value = speedValue;
      }

      const stepValue = formatStepUnitValue(state.stepUnit);

      if (stepUnitSelect.value !== stepValue) {
        stepUnitSelect.value = stepValue;
      }

      // The label names what a press will actually do, which is the only place the selected
      // unit is visible while the select is collapsed.
      const backLabel = stepActionLabel(state.stepUnit, -1);
      const forwardLabel = stepActionLabel(state.stepUnit, 1);

      stepBackButton.setAttribute('aria-label', backLabel);
      stepBackButton.title = `${backLabel} (arrow keys step one frame, Shift for one second)`;
      stepForwardButton.setAttribute('aria-label', forwardLabel);
      stepForwardButton.title = `${forwardLabel} (arrow keys step one frame, Shift for one second)`;
      stepUnitSelect.title = `Step unit: ${stepUnitLabel(state.stepUnit)}`;

      loopButton.setAttribute('aria-pressed', state.loop ? 'true' : 'false');
    },
    toggleFullscreen,
    destroy: () => {
      destroyed = true;
      playButton.removeEventListener('click', onPlayClick);
      independentButton.removeEventListener('click', onIndependentClick);
      range.removeEventListener('pointerdown', onPointerDown);
      range.removeEventListener('input', onRangeInput);
      range.removeEventListener('change', onRangeChange);
      speedField.select.removeEventListener('change', onSpeedChange);
      loopButton.removeEventListener('click', onLoopClick);
      swapButton.removeEventListener('click', onSwapClick);
      stepBackButton.removeEventListener('click', onStepBackClick);
      stepForwardButton.removeEventListener('click', onStepForwardClick);
      stepUnitSelect.removeEventListener('change', onStepUnitChange);
      fullscreenButton.removeEventListener('click', onFullscreenClick);
      window.removeEventListener('pointerup', onWindowPointerEnd);
      window.removeEventListener('pointercancel', onWindowPointerEnd);
      document.removeEventListener('fullscreenchange', syncFullscreenButton);
      root.remove();
    },
  };
}
