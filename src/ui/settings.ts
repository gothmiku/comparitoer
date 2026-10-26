import { AUDIO_TRACK_ACCEPT_ATTRIBUTE } from '../logic/audio';
import {
  DEFAULT_DURATION_TOLERANCE_SECONDS,
  formatToleranceSeconds,
  parseTolerance,
  TOLERANCE_ERROR_TEXT,
} from '../logic/duration';
import { formatTime } from '../logic/format';
import type { SlotStatus } from '../state';

/** What the audio-track section renders from; produced by the composition root. */
export interface TrackView {
  readonly status: SlotStatus;
  readonly label: string;
  readonly durationSeconds: number;
  readonly error: string | null;
}

export interface SettingsOptions {
  /** Where the trigger goes; the panel is positioned relative to it. */
  readonly host: HTMLElement;
  readonly toleranceSeconds: number;
  readonly track: TrackView;
  /** Current proxy-quality choice for the local codec converter. */
  readonly fastProxy: boolean;
  onToleranceChange: (seconds: number) => void;
  /** A file was picked as the third audio source (already validated by the caller). */
  onTrackFile: (file: File) => void;
  onRemoveTrack: () => void;
  /** The user switched the local converter between full resolution and a 720p proxy. */
  onFastProxyChange: (fast: boolean) => void;
}

/** Header settings popover: duration tolerance, external audio track and local converter. */
export interface Settings {
  readonly element: HTMLElement;
  getTolerance(): number;
  /** Updates the field without clobbering a value the user is currently editing. */
  setTolerance(seconds: number): void;
  /** Updates the audio-track section. */
  setTrack(track: TrackView): void;
  /** Updates the proxy-quality checkbox without firing a change. */
  setFastProxy(fast: boolean): void;
  open(): void;
  close(): void;
  isOpen(): boolean;
  destroy(): void;
}

let settingsCounter = 0;

export function createSettings(options: SettingsOptions): Settings {
  settingsCounter += 1;
  const idPrefix = `settings-${settingsCounter}`;

  const section = document.createElement('div');
  section.className = 'settings';

  const trigger = document.createElement('button');
  trigger.className = 'settings__trigger';
  trigger.type = 'button';
  trigger.textContent = 'Settings';
  trigger.setAttribute('aria-expanded', 'false');
  trigger.setAttribute('aria-controls', `${idPrefix}-panel`);
  trigger.setAttribute('aria-haspopup', 'dialog');

  const panel = document.createElement('div');
  panel.className = 'settings__panel';
  panel.id = `${idPrefix}-panel`;
  panel.setAttribute('role', 'dialog');
  panel.setAttribute('aria-labelledby', `${idPrefix}-title`);
  panel.hidden = true;

  const title = document.createElement('h2');
  title.className = 'settings__title';
  title.id = `${idPrefix}-title`;
  title.textContent = 'Settings';

  const field = document.createElement('div');
  field.className = 'field';

  const label = document.createElement('label');
  label.className = 'field__label';
  label.htmlFor = `${idPrefix}-tolerance`;
  label.textContent = 'Duration tolerance';

  const control = document.createElement('div');
  control.className = 'field__control';

  const input = document.createElement('input');
  input.className = 'field__input';
  input.id = `${idPrefix}-tolerance`;
  input.type = 'number';
  input.inputMode = 'decimal';
  input.min = '0';
  input.step = '0.01';
  input.setAttribute('aria-describedby', `${idPrefix}-hint ${idPrefix}-error`);

  const unit = document.createElement('span');
  unit.className = 'field__unit';
  unit.textContent = 'seconds';

  const hint = document.createElement('p');
  hint.className = 'field__hint';
  hint.id = `${idPrefix}-hint`;
  hint.textContent = `Differences up to this value count as a match. Default ${formatToleranceSeconds(
    DEFAULT_DURATION_TOLERANCE_SECONDS,
  )} s.`;

  const error = document.createElement('p');
  error.className = 'field__error';
  error.id = `${idPrefix}-error`;
  error.setAttribute('role', 'alert');
  error.hidden = true;

  const reset = document.createElement('button');
  reset.className = 'settings__reset';
  reset.type = 'button';
  reset.textContent = `Reset to ${formatToleranceSeconds(DEFAULT_DURATION_TOLERANCE_SECONDS)} s`;

  // --- Audio track section -------------------------------------------------------------
  // "Both videos muted, one third source audible" is a mode, so it lives in Settings next to
  // the other global choices rather than in the transport bar.
  const trackField = document.createElement('div');
  trackField.className = 'field';
  trackField.setAttribute('role', 'group');
  trackField.setAttribute('aria-labelledby', `${idPrefix}-track-label`);

  const trackLabel = document.createElement('span');
  trackLabel.className = 'field__label';
  trackLabel.id = `${idPrefix}-track-label`;
  trackLabel.textContent = 'Audio track';

  const trackHint = document.createElement('p');
  trackHint.className = 'field__hint';
  trackHint.id = `${idPrefix}-track-hint`;
  trackHint.textContent =
    'A third source, mixed in with the videos. Loading it turns both videos down to 0 %; every fader stays live.';

  const trackControl = document.createElement('div');
  trackControl.className = 'field__control';

  const trackPick = document.createElement('button');
  trackPick.className = 'settings__track-pick';
  trackPick.type = 'button';
  trackPick.textContent = 'Choose audio file…';
  trackPick.setAttribute('aria-describedby', `${idPrefix}-track-hint ${idPrefix}-track-status`);

  const trackInput = document.createElement('input');
  trackInput.className = 'settings__track-input';
  trackInput.type = 'file';
  trackInput.accept = AUDIO_TRACK_ACCEPT_ATTRIBUTE;
  trackInput.tabIndex = -1;
  trackInput.hidden = true;
  trackInput.setAttribute('aria-hidden', 'true');

  const trackRemove = document.createElement('button');
  trackRemove.className = 'settings__track-remove';
  trackRemove.type = 'button';
  trackRemove.textContent = 'Remove';
  trackRemove.hidden = true;

  const trackStatus = document.createElement('p');
  trackStatus.className = 'settings__track-status';
  trackStatus.id = `${idPrefix}-track-status`;
  trackStatus.setAttribute('role', 'status');
  trackStatus.setAttribute('aria-live', 'polite');

  trackControl.append(trackPick, trackInput, trackRemove);
  trackField.append(trackLabel, trackHint, trackControl, trackStatus);

  // --- Local codec converter -------------------------------------------------------------
  // Browsers cannot decode most editing codecs, so the app ships an opt-in local converter.
  // It is described here (next to the other global choices) because the quality setting
  // changes what every later conversion produces.
  const converterField = document.createElement('div');
  converterField.className = 'field';
  converterField.setAttribute('role', 'group');
  converterField.setAttribute('aria-labelledby', `${idPrefix}-converter-label`);

  const converterLabel = document.createElement('span');
  converterLabel.className = 'field__label';
  converterLabel.id = `${idPrefix}-converter-label`;
  converterLabel.textContent = 'Codec converter';

  const converterHint = document.createElement('p');
  converterHint.className = 'field__hint';
  converterHint.id = `${idPrefix}-converter-hint`;
  converterHint.textContent =
    'Converts files this browser cannot decode (Lagarith, ProRes, DNxHD, FFV1, AVI, MXF…) into a temporary H.264 proxy. The 32 MB decoder is downloaded once, and only when you convert.';

  const fastProxyLabel = document.createElement('label');
  fastProxyLabel.className = 'settings__checkbox';
  fastProxyLabel.htmlFor = `${idPrefix}-fast-proxy`;

  const fastProxyInput = document.createElement('input');
  fastProxyInput.className = 'settings__checkbox-input';
  fastProxyInput.id = `${idPrefix}-fast-proxy`;
  fastProxyInput.type = 'checkbox';
  fastProxyInput.setAttribute('aria-describedby', `${idPrefix}-converter-hint`);

  const fastProxyText = document.createElement('span');
  fastProxyText.className = 'settings__checkbox-text';
  fastProxyText.textContent = 'Fast 720p proxy';

  fastProxyLabel.append(fastProxyInput, fastProxyText);

  const converterNote = document.createElement('p');
  converterNote.className = 'field__hint';
  converterNote.textContent =
    'Uses ffmpeg.wasm (FFmpeg, GPL-2.0-or-later). Conversion runs on this device; no file is uploaded.';

  converterField.append(converterLabel, converterHint, fastProxyLabel, converterNote);

  control.append(input, unit);
  field.append(label, control, hint, error);
  panel.append(title, field, reset, trackField, converterField);
  section.append(trigger, panel);
  options.host.append(section);

  let tolerance = options.toleranceSeconds;
  let isOpen = false;
  let track: TrackView = options.track;
  let fastProxy = options.fastProxy;

  /** Loading is not removable: the pending attempt would just resolve into a fresh ready. */
  const applyTrackButtons = (loaded: boolean): void => {
    trackPick.textContent = loaded ? 'Replace audio file…' : 'Choose audio file…';
    trackRemove.hidden = !loaded;
    trackRemove.disabled = track.status === 'loading';
  };

  const showTrack = (): void => {
    const loaded = track.status === 'ready' || track.status === 'loading';
    const name = track.label.trim();

    if (track.status === 'ready') {
      trackStatus.textContent = `${name} · ${formatTime(track.durationSeconds)}`;
    } else if (track.status === 'loading') {
      trackStatus.textContent = `Loading ${name}…`;
    } else if (track.status === 'error') {
      trackStatus.textContent = track.error ?? 'The audio track could not be played.';
    } else {
      trackStatus.textContent = 'No audio track. The videos keep their own sound.';
    }

    trackStatus.classList.toggle('settings__track-status--error', track.status === 'error');
    trackStatus.classList.toggle('settings__track-status--ok', track.status === 'ready');

    applyTrackButtons(loaded);
  };

  const showError = (message: string | null): void => {
    error.textContent = message ?? '';
    error.hidden = message === null;

    if (message === null) {
      input.removeAttribute('aria-invalid');
    } else {
      input.setAttribute('aria-invalid', 'true');
    }
  };

  const showTolerance = (): void => {
    input.value = formatToleranceSeconds(tolerance);
  };

  /** Reflects the converter choice without firing a change event. */
  const showFastProxy = (): void => {
    fastProxyInput.checked = fastProxy;
  };

  const commit = (): void => {
    const parsed = parseTolerance(input.value);

    if (parsed === null) {
      showError(TOLERANCE_ERROR_TEXT);
      return;
    }

    showError(null);

    if (parsed !== tolerance) {
      tolerance = parsed;
      options.onToleranceChange(tolerance);
    }

    showTolerance();
  };

  const restoreField = (): void => {
    showError(null);
    showTolerance();
  };

  const setOpen = (open: boolean, focusTarget: HTMLElement | null): void => {
    isOpen = open;
    panel.hidden = !open;
    trigger.setAttribute('aria-expanded', open ? 'true' : 'false');

    if (open) {
      document.addEventListener('pointerdown', onDocumentPointerDown);
      showTolerance();
      showTrack();
      input.focus();
      input.select();
    } else {
      document.removeEventListener('pointerdown', onDocumentPointerDown);

      if (focusTarget !== null) {
        focusTarget.focus();
      }
    }
  };

  const onDocumentPointerDown = (event: PointerEvent): void => {
    const target = event.target;

    if (target instanceof Node && section.contains(target)) {
      return;
    }

    setOpen(false, null);
  };

  const onTriggerClick = (): void => {
    setOpen(!isOpen, null);
  };

  const onInputChange = (): void => {
    commit();
  };

  const onInputKeyDown = (event: KeyboardEvent): void => {
    if (event.key === 'Enter') {
      event.preventDefault();
      commit();
    }
  };

  const onInputBlur = (): void => {
    if (parseTolerance(input.value) === null) {
      restoreField();
      return;
    }

    commit();
  };

  const onPanelKeyDown = (event: KeyboardEvent): void => {
    if (event.key === 'Escape') {
      event.preventDefault();
      restoreField();
      setOpen(false, trigger);
    }
  };

  const onSectionFocusOut = (event: FocusEvent): void => {
    if (!isOpen) {
      return;
    }

    const next = event.relatedTarget;

    if (next instanceof Node && section.contains(next)) {
      return;
    }

    setOpen(false, null);
  };

  const onResetClick = (): void => {
    const parsed = DEFAULT_DURATION_TOLERANCE_SECONDS;
    showError(null);
    tolerance = parsed;
    showTolerance();
    options.onToleranceChange(tolerance);
    input.focus();
  };

  const onTrackPickClick = (): void => {
    trackInput.click();
  };

  const onTrackInputChange = (): void => {
    const file = trackInput.files?.[0];

    // Clearing the value lets the same file be chosen again after a failure, which a
    // `<input type="file">` would otherwise ignore.
    trackInput.value = '';

    if (file !== undefined) {
      options.onTrackFile(file);
    }
  };

  const onTrackRemoveClick = (): void => {
    options.onRemoveTrack();
  };

  const onFastProxyInputChange = (): void => {
    fastProxy = fastProxyInput.checked;
    options.onFastProxyChange(fastProxy);
  };

  trigger.addEventListener('click', onTriggerClick);
  panel.addEventListener('keydown', onPanelKeyDown);
  section.addEventListener('focusout', onSectionFocusOut);
  input.addEventListener('change', onInputChange);
  input.addEventListener('keydown', onInputKeyDown);
  input.addEventListener('blur', onInputBlur);
  reset.addEventListener('click', onResetClick);
  trackPick.addEventListener('click', onTrackPickClick);
  trackInput.addEventListener('change', onTrackInputChange);
  trackRemove.addEventListener('click', onTrackRemoveClick);
  fastProxyInput.addEventListener('change', onFastProxyInputChange);

  showTolerance();
  showTrack();
  showFastProxy();

  return {
    element: section,
    getTolerance: () => tolerance,
    setTolerance: (seconds) => {
      if (!Number.isFinite(seconds) || seconds < 0) {
        return;
      }

      tolerance = seconds;

      if (document.activeElement !== input) {
        showTolerance();
      }
    },
    setTrack: (next) => {
      track = next;
      // Rendered even while the panel is closed: the nodes are hidden, and the next open must
      // not show a stale status.
      showTrack();
    },
    setFastProxy: (fast) => {
      fastProxy = fast;
      showFastProxy();
    },
    open: () => {
      setOpen(true, null);
    },
    close: () => {
      setOpen(false, null);
    },
    isOpen: () => isOpen,
    destroy: () => {
      document.removeEventListener('pointerdown', onDocumentPointerDown);
      trigger.removeEventListener('click', onTriggerClick);
      panel.removeEventListener('keydown', onPanelKeyDown);
      section.removeEventListener('focusout', onSectionFocusOut);
      input.removeEventListener('change', onInputChange);
      input.removeEventListener('keydown', onInputKeyDown);
      input.removeEventListener('blur', onInputBlur);
      reset.removeEventListener('click', onResetClick);
      trackPick.removeEventListener('click', onTrackPickClick);
      trackInput.removeEventListener('change', onTrackInputChange);
      trackRemove.removeEventListener('click', onTrackRemoveClick);
      fastProxyInput.removeEventListener('change', onFastProxyInputChange);
      section.remove();
    },
  };
}
