import type { SlotId } from '../state';
import { createWipe } from './wipe';
import type { WipeController } from './wipe';

/** One stage box holding both stacked videos, the wipe handle and the corner tags. */
export interface Stage {
  readonly element: HTMLElement;
  /** Bottom layer; the master clock. object-fit: contain. */
  readonly videoA: HTMLVideoElement;
  /** Top layer; clipped with clip-path from the divider position. */
  readonly videoB: HTMLVideoElement;
  /** Sets the frame shape from A's intrinsic size; ignored while it is still unknown. */
  setAspectRatio(width: number, height: number): void;
  /** Corner tag text; defaults to the filename without extension. */
  setLabel(slot: SlotId, text: string): void;
  /** Moves the divider without reporting it back (external state -> view only). */
  setWipePosition(position: number): void;
  getWipePosition(): number;
  destroy(): void;
}

export interface StageOptions {
  readonly host: HTMLElement;
  /** Both elements are owned by the media loader; the stage only mounts them. */
  readonly videoA: HTMLVideoElement;
  readonly videoB: HTMLVideoElement;
  /** Initial divider position in percent. */
  readonly wipePosition: number;
  /** Fired for pointer drags and keyboard adjustments of the divider. */
  onWipePositionChange?: (position: number) => void;
  /** Called when a corner tag is renamed through its inline field. */
  onLabelChange?: (slot: SlotId, text: string) => void;
}

export type StageFactory = (options: StageOptions) => Stage;

/** Fallback frame shape before A's metadata arrives. */
const DEFAULT_ASPECT_RATIO = 16 / 9;

interface CornerTag {
  readonly root: HTMLElement;
  setText(text: string): void;
  destroy(): void;
}

/**
 * Builds one corner chip: an A/B badge plus an always-editable text field.
 *
 * The field commits on Enter or blur and reverts on Escape. `setText` records the
 * committed text but never overwrites what the user is currently typing, because the
 * composition root re-syncs labels whenever any slot changes.
 */
function createCornerTag(slot: SlotId, onCommit: (text: string) => void): CornerTag {
  const letter = slot.toUpperCase();

  const root = document.createElement('div');
  root.className = `tag tag--${slot}`;

  const badge = document.createElement('span');
  badge.className = 'tag__badge';
  badge.textContent = letter;
  badge.setAttribute('aria-hidden', 'true');

  const input = document.createElement('input');
  input.className = 'tag__input';
  input.type = 'text';
  input.spellcheck = false;
  input.autocomplete = 'off';
  input.setAttribute('autocapitalize', 'off');
  input.setAttribute('enterkeyhint', 'done');
  input.setAttribute('aria-label', `Label for video ${letter}`);
  input.placeholder = `Video ${letter}`;

  root.append(badge, input);

  let committed = '';

  const describe = (text: string): void => {
    input.title = text.length > 0 ? `${text} — click to rename` : 'Click to rename';
  };

  const commit = (): void => {
    const text = input.value.trim();

    if (text === committed) {
      input.value = committed;
      return;
    }

    committed = text;
    input.value = text;
    describe(text);
    onCommit(text);
  };

  const onKeyDown = (event: KeyboardEvent): void => {
    if (event.key === 'Enter') {
      event.preventDefault();
      commit();
      input.blur();
      return;
    }

    if (event.key === 'Escape') {
      event.preventDefault();
      input.value = committed;
      input.blur();
    }
  };

  // Clicking the badge (or the chip's padding) starts renaming.
  const onRootPointerDown = (event: PointerEvent): void => {
    if (event.target === input) {
      return;
    }

    event.preventDefault();
    input.focus();
    input.select();
  };

  input.addEventListener('keydown', onKeyDown);
  input.addEventListener('blur', commit);
  root.addEventListener('pointerdown', onRootPointerDown);

  describe('');

  return {
    root,
    setText: (text) => {
      const previous = committed;
      committed = text;

      // Never overwrite an in-progress edit: only sync the field when it is not focused
      // or when it still shows exactly what was last committed (e.g. after clearing it
      // and having the fallback name restored).
      if (document.activeElement !== input || input.value === previous) {
        input.value = text;
        describe(text);
      }
    },
    destroy: () => {
      input.removeEventListener('keydown', onKeyDown);
      input.removeEventListener('blur', commit);
      root.removeEventListener('pointerdown', onRootPointerDown);
      root.remove();
    },
  };
}


/**
 * The single stage box: A at the bottom, B clipped from the left, one wipe strip and two
 * corner tags.
 *
 * Both `<video>` elements fill the frame with `object-fit: contain`, so a 4:3 source and a
 * 16:9 source letterbox inside the *same* box and always overlay pixel-for-pixel along the
 * divider. The frame takes A's aspect ratio so the letterboxing is symmetric.
 */
export function createStage(options: StageOptions): Stage {
  const { videoA, videoB } = options;

  const stage = document.createElement('section');
  stage.className = 'stage';
  stage.setAttribute('role', 'group');
  stage.setAttribute('aria-label', 'Video comparison stage');

  const frame = document.createElement('div');
  frame.className = 'stage__frame';
  frame.style.setProperty('--stage-ar', String(Number(DEFAULT_ASPECT_RATIO.toFixed(4))));

  videoA.classList.add('stage__video', 'stage__video--a');
  videoB.classList.add('stage__video', 'stage__video--b');

  const tags: Record<SlotId, CornerTag> = {
    a: createCornerTag('a', (text) => options.onLabelChange?.('a', text)),
    b: createCornerTag('b', (text) => options.onLabelChange?.('b', text)),
  };

  frame.append(videoA, videoB, tags.a.root, tags.b.root);
  stage.append(frame);
  options.host.append(stage);

  const wipe: WipeController = createWipe({
    host: frame,
    clipTarget: videoB,
    initialPosition: options.wipePosition,
    onPositionChange: (position) => options.onWipePositionChange?.(position),
  });

  return {
    element: stage,
    videoA,
    videoB,
    setAspectRatio: (width, height) => {
      if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) {
        return;
      }

      frame.style.setProperty('--stage-ar', String(Number((width / height).toFixed(4))));
    },
    setLabel: (slot, text) => {
      tags[slot].setText(text);
    },
    setWipePosition: (position) => {
      wipe.setPosition(position);
    },
    getWipePosition: () => wipe.getPosition(),
    destroy: () => {
      wipe.destroy();
      tags.a.destroy();
      tags.b.destroy();
      // The media loader owns both elements: detach them before the frame disappears.
      videoA.remove();
      videoB.remove();
      videoA.classList.remove('stage__video', 'stage__video--a');
      videoB.classList.remove('stage__video', 'stage__video--b');
      stage.remove();
    },
  };
}

