/**
 * Keyboard shortcut resolution, kept pure and DOM-free so the precedence rules (typing wins,
 * modifiers win, Space belongs to buttons, arrows belong to sliders) are unit-tested instead
 * of being incidental behaviour of a listener.
 */

/** What one key press asks for. Handled by the composition root. */
export type ShortcutAction =
  | 'togglePlay'
  | 'stepBackward'
  | 'stepForward'
  | 'seekBackward'
  | 'seekForward'
  | 'toggleLoop'
  | 'cycleAudio'
  | 'toggleFullscreen'
  | 'toggleHelp';

/** The subset of a KeyboardEvent the resolver needs, plus where focus sits. */
export interface ShortcutPress {
  readonly key: string;
  readonly shiftKey: boolean;
  readonly ctrlKey: boolean;
  readonly metaKey: boolean;
  readonly altKey: boolean;
  readonly repeat: boolean;
  /** Focus is in a text field (input, textarea, select, contenteditable): keys are typing. */
  readonly typing: boolean;
  /** Focus is on a button: Space/Enter already activate it natively. */
  readonly onButton: boolean;
  /** Focus is on a range input: arrow keys belong to the slider. */
  readonly onRange: boolean;
}

/** Letter shortcuts, so `L`, `l`, Shift+L and Caps Lock on all mean the same thing. */
function normalizeKey(key: string): string {
  return key.length === 1 ? key.toLowerCase() : key;
}

function isSpace(key: string): boolean {
  return key === ' ' || key === 'Spacebar' || key === 'Space';
}

function isArrowLeft(key: string): boolean {
  return key === 'ArrowLeft' || key === 'Left';
}

function isArrowRight(key: string): boolean {
  return key === 'ArrowRight' || key === 'Right';
}

/**
 * Maps a press to an action, or `null` when the key must keep its default behaviour.
 *
 * Order of precedence:
 * 1. Text entry focus wins over everything — renaming a tag never plays, loops or seeks.
 * 2. Any Ctrl/Meta/Alt combination is left to the browser (tabs, reload, history, menus).
 * 3. Space on a focused button is left alone: the button's native activation already fires.
 * 4. Arrows on a focused range input are left alone: the slider moves itself.
 * 5. Held keys repeat only for continuous actions (frame step, seek), never for toggles.
 */
export function resolveShortcut(press: ShortcutPress): ShortcutAction | null {
  if (press.typing) {
    return null;
  }

  if (press.ctrlKey || press.metaKey || press.altKey) {
    return null;
  }

  const key = normalizeKey(press.key);

  if (isSpace(key)) {
    // A focused button already activates itself; a held Space must not toggle repeatedly.
    return press.onButton || press.repeat ? null : 'togglePlay';
  }

  if (isArrowLeft(key) || isArrowRight(key)) {
    if (press.onRange) {
      return null;
    }

    const forward = isArrowRight(key);

    if (press.shiftKey) {
      return forward ? 'seekForward' : 'seekBackward';
    }

    return forward ? 'stepForward' : 'stepBackward';
  }

  // A toggle should fire once per press, not on every auto-repeat.
  if (press.repeat) {
    return null;
  }

  if (key === '?') {
    return 'toggleHelp';
  }

  if (key === 'l') {
    return 'toggleLoop';
  }

  if (key === 'm') {
    return 'cycleAudio';
  }

  if (key === 'f') {
    return 'toggleFullscreen';
  }

  return null;
}
