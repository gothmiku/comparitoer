import { resolveShortcut } from '../logic/keys';
import type { ShortcutAction } from '../logic/keys';

/** What a key press asks the app to do; the composition root decides who handles it. */
export interface ShortcutHandlers {
  onTogglePlay: () => void;
  /** Left/Right arrow: one frame at A's estimated fps. */
  onStepFrames: (frames: number) => void;
  /** Shift + Left/Right: whole seconds. */
  onSeekBy: (deltaSeconds: number) => void;
  onToggleLoop: () => void;
  onCycleAudio: () => void;
  onToggleFullscreen: () => void;
  /** `?`: opens or closes the shortcut list. */
  onToggleHelp: () => void;
}

/** A row in the "?" popover, kept next to the handlers so the two cannot drift apart. */
export interface ShortcutHelpEntry {
  readonly keys: string;
  readonly action: string;
}

export interface ShortcutsOptions {
  /** Element the keydown listener is attached to (the document). */
  readonly target: Document;
  readonly handlers: ShortcutHandlers;
  /** True while focus sits in a label field or input, where keys must keep typing. */
  readonly shouldIgnore?: (event: KeyboardEvent) => boolean;
}

export interface Shortcuts {
  /** Registers the keydown listener; safe to call once. */
  attach(): void;
  /** Removes the listener and any popover it opened. */
  destroy(): void;
}

export const SHORTCUT_HELP: readonly ShortcutHelpEntry[] = [
  { keys: 'Space', action: 'Play / pause (both videos)' },
  { keys: 'ArrowLeft / ArrowRight', action: 'Step one frame (Step unit buttons: Frame / 1·5·10 s)' },
  { keys: 'Shift + ArrowLeft / ArrowRight', action: 'Jump one second' },
  { keys: 'Independent', action: 'Give each video its own Play, timeline and frame step (arrows then step video A)' },
  { keys: 'L', action: 'Toggle loop' },
  { keys: 'M', action: 'Cycle audio source: A → B → third track → silent' },
  { keys: 'F', action: 'Fullscreen' },
  { keys: '?', action: 'Show this list' },
];

/** Form fields keep their own keys: typing in a label must never trigger a shortcut. */
function isTextEntryTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) {
    return false;
  }

  if (target.isContentEditable) {
    return true;
  }

  if (target instanceof HTMLTextAreaElement || target instanceof HTMLSelectElement) {
    return true;
  }

  if (target instanceof HTMLInputElement) {
    return (
      target.type !== 'range' &&
      target.type !== 'checkbox' &&
      target.type !== 'radio' &&
      target.type !== 'button'
    );
  }

  return false;
}

function isButtonTarget(target: EventTarget | null): boolean {
  return target instanceof HTMLElement && target.closest('button, [role="button"]') !== null;
}

function isRangeTarget(target: EventTarget | null): boolean {
  return target instanceof HTMLInputElement && target.type === 'range';
}

/**
 * One `keydown` listener on the document; the decision itself lives in `logic/keys.ts`.
 *
 * Nothing is prevented unless an action was actually resolved, so browser keys, form keys
 * and the scrubber's own arrow handling keep working exactly as they would without us.
 */
export function createShortcuts(options: ShortcutsOptions): Shortcuts {
  let attached = false;

  const dispatch = (action: ShortcutAction): void => {
    switch (action) {
      case 'togglePlay':
        options.handlers.onTogglePlay();
        return;
      case 'stepBackward':
        options.handlers.onStepFrames(-1);
        return;
      case 'stepForward':
        options.handlers.onStepFrames(1);
        return;
      case 'seekBackward':
        options.handlers.onSeekBy(-1);
        return;
      case 'seekForward':
        options.handlers.onSeekBy(1);
        return;
      case 'toggleLoop':
        options.handlers.onToggleLoop();
        return;
      case 'cycleAudio':
        options.handlers.onCycleAudio();
        return;
      case 'toggleFullscreen':
        options.handlers.onToggleFullscreen();
        return;
      case 'toggleHelp':
        options.handlers.onToggleHelp();
    }
  };

  const onKeyDown = (event: KeyboardEvent): void => {
    if (options.shouldIgnore?.(event) === true) {
      return;
    }

    const target =
      event.target instanceof HTMLElement ? event.target : options.target.activeElement;

    const action = resolveShortcut({
      key: event.key,
      shiftKey: event.shiftKey,
      ctrlKey: event.ctrlKey,
      metaKey: event.metaKey,
      altKey: event.altKey,
      repeat: event.repeat,
      typing: isTextEntryTarget(target),
      onButton: isButtonTarget(target),
      onRange: isRangeTarget(target),
    });

    if (action === null) {
      return;
    }

    event.preventDefault();
    dispatch(action);
  };

  return {
    attach: () => {
      if (attached) {
        return;
      }

      attached = true;
      options.target.addEventListener('keydown', onKeyDown);
    },
    destroy: () => {
      if (!attached) {
        return;
      }

      attached = false;
      options.target.removeEventListener('keydown', onKeyDown);
    },
  };
}

/** Options for the "?" popover that lists every shortcut. */
export interface ShortcutHelpOptions {
  /** Where the trigger goes; the panel is positioned relative to it. */
  readonly host: HTMLElement;
}

/** The "?" trigger and its non-modal panel; closed by Escape, an outside click or the trigger. */
export interface ShortcutHelp {
  readonly element: HTMLElement;
  open(): void;
  close(): void;
  toggle(): void;
  isOpen(): boolean;
  destroy(): void;
}

let helpCounter = 0;

/** Renders `Shift + ArrowLeft / ArrowRight` as individual `<kbd>` chips. */
function appendKeys(parent: HTMLElement, keys: string): void {
  keys.split(' / ').forEach((chord, chordIndex) => {
    if (chordIndex > 0) {
      parent.append(' / ');
    }

    chord.split(' + ').forEach((part, partIndex) => {
      if (partIndex > 0) {
        parent.append(' + ');
      }

      const key = document.createElement('kbd');
      key.className = 'help__key';
      key.textContent = part;
      parent.append(key);
    });
  });
}

/**
 * Builds the shortcut list from `SHORTCUT_HELP`, so the popover and the listener can never
 * disagree about what a key does.
 */
export function createShortcutHelp(options: ShortcutHelpOptions): ShortcutHelp {
  helpCounter += 1;
  const idPrefix = `help-${helpCounter}`;

  const section = document.createElement('div');
  section.className = 'help';

  const trigger = document.createElement('button');
  trigger.className = 'help__trigger';
  trigger.type = 'button';
  trigger.textContent = '?';
  trigger.title = 'Keyboard shortcuts (?)';
  trigger.setAttribute('aria-label', 'Keyboard shortcuts');
  trigger.setAttribute('aria-expanded', 'false');
  trigger.setAttribute('aria-controls', `${idPrefix}-panel`);
  trigger.setAttribute('aria-haspopup', 'dialog');

  const panel = document.createElement('div');
  panel.className = 'help__panel';
  panel.id = `${idPrefix}-panel`;
  panel.setAttribute('role', 'dialog');
  panel.setAttribute('aria-labelledby', `${idPrefix}-title`);
  panel.tabIndex = -1;
  panel.hidden = true;

  const title = document.createElement('h2');
  title.className = 'help__title';
  title.id = `${idPrefix}-title`;
  title.textContent = 'Keyboard shortcuts';

  const list = document.createElement('ul');
  list.className = 'help__list';

  for (const entry of SHORTCUT_HELP) {
    const row = document.createElement('li');
    row.className = 'help__row';

    const keys = document.createElement('span');
    keys.className = 'help__keys';
    appendKeys(keys, entry.keys);

    const action = document.createElement('span');
    action.className = 'help__action';
    action.textContent = entry.action;

    row.append(keys, action);
    list.append(row);
  }

  const note = document.createElement('p');
  note.className = 'help__note';
  note.textContent =
    'Shortcuts are ignored while a label field or another form control has focus.';

  const closeButton = document.createElement('button');
  closeButton.className = 'help__close';
  closeButton.type = 'button';
  closeButton.textContent = 'Close';

  panel.append(title, list, note, closeButton);
  section.append(trigger, panel);
  options.host.append(section);

  let open = false;

  const setOpen = (next: boolean, focusTarget: HTMLElement | null): void => {
    open = next;
    panel.hidden = !next;
    trigger.setAttribute('aria-expanded', next ? 'true' : 'false');

    if (next) {
      document.addEventListener('pointerdown', onDocumentPointerDown);
      panel.focus();
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
    setOpen(!open, null);
  };

  const onPanelKeyDown = (event: KeyboardEvent): void => {
    if (event.key !== 'Escape') {
      return;
    }

    event.preventDefault();
    setOpen(false, trigger);
  };

  const onCloseClick = (): void => {
    setOpen(false, trigger);
  };

  const onSectionFocusOut = (event: FocusEvent): void => {
    if (!open) {
      return;
    }

    const next = event.relatedTarget;

    if (next instanceof Node && section.contains(next)) {
      return;
    }

    setOpen(false, null);
  };

  trigger.addEventListener('click', onTriggerClick);
  panel.addEventListener('keydown', onPanelKeyDown);
  section.addEventListener('focusout', onSectionFocusOut);
  closeButton.addEventListener('click', onCloseClick);

  return {
    element: section,
    open: () => {
      setOpen(true, null);
    },
    close: () => {
      setOpen(false, null);
    },
    toggle: () => {
      if (open) {
        setOpen(false, trigger);
        return;
      }

      setOpen(true, null);
    },
    isOpen: () => open,
    destroy: () => {
      document.removeEventListener('pointerdown', onDocumentPointerDown);
      trigger.removeEventListener('click', onTriggerClick);
      panel.removeEventListener('keydown', onPanelKeyDown);
      section.removeEventListener('focusout', onSectionFocusOut);
      closeButton.removeEventListener('click', onCloseClick);
      section.remove();
    },
  };
}
