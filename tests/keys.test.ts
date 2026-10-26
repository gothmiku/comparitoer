import { describe, expect, it } from 'vitest';

import { resolveShortcut } from '../src/logic/keys';
import type { ShortcutPress } from '../src/logic/keys';

/** A bare press with focus in the page and no modifiers. */
function press(overrides: Partial<ShortcutPress> = {}): ShortcutPress {
  return {
    key: '',
    shiftKey: false,
    ctrlKey: false,
    metaKey: false,
    altKey: false,
    repeat: false,
    typing: false,
    onButton: false,
    onRange: false,
    ...overrides,
  };
}

describe('resolveShortcut — playback keys', () => {
  it('maps Space to play/pause', () => {
    expect(resolveShortcut(press({ key: ' ' }))).toBe('togglePlay');
    expect(resolveShortcut(press({ key: 'Spacebar' }))).toBe('togglePlay');
  });

  it('maps arrows to frame steps and Shift+arrows to one-second jumps', () => {
    expect(resolveShortcut(press({ key: 'ArrowRight' }))).toBe('stepForward');
    expect(resolveShortcut(press({ key: 'ArrowLeft' }))).toBe('stepBackward');
    expect(resolveShortcut(press({ key: 'ArrowRight', shiftKey: true }))).toBe('seekForward');
    expect(resolveShortcut(press({ key: 'ArrowLeft', shiftKey: true }))).toBe('seekBackward');
  });

  it('accepts the legacy Left/Right key names', () => {
    expect(resolveShortcut(press({ key: 'Left' }))).toBe('stepBackward');
    expect(resolveShortcut(press({ key: 'Right' }))).toBe('stepForward');
  });
});

describe('resolveShortcut — toggles', () => {
  it('maps L, M, F and ? regardless of letter case', () => {
    expect(resolveShortcut(press({ key: 'l' }))).toBe('toggleLoop');
    expect(resolveShortcut(press({ key: 'L' }))).toBe('toggleLoop');
    expect(resolveShortcut(press({ key: 'm' }))).toBe('cycleAudio');
    expect(resolveShortcut(press({ key: 'M' }))).toBe('cycleAudio');
    expect(resolveShortcut(press({ key: 'f' }))).toBe('toggleFullscreen');
    expect(resolveShortcut(press({ key: 'F' }))).toBe('toggleFullscreen');
    expect(resolveShortcut(press({ key: '?', shiftKey: true }))).toBe('toggleHelp');
  });

  it('leaves unrelated keys alone', () => {
    expect(resolveShortcut(press({ key: 'k' }))).toBeNull();
    expect(resolveShortcut(press({ key: 'Enter' }))).toBeNull();
    expect(resolveShortcut(press({ key: 'Escape' }))).toBeNull();
    expect(resolveShortcut(press({ key: 'Tab' }))).toBeNull();
    expect(resolveShortcut(press({ key: 'PageDown' }))).toBeNull();
  });
});

describe('resolveShortcut — typing a tag label', () => {
  it('ignores every shortcut while a text field has focus', () => {
    for (const key of [' ', 'ArrowLeft', 'ArrowRight', 'l', 'm', 'f', '?']) {
      expect(resolveShortcut(press({ key, typing: true, shiftKey: key === '?' }))).toBeNull();
    }
  });

  it('lets Shift+arrows type a selection, not seek', () => {
    expect(
      resolveShortcut(press({ key: 'ArrowRight', shiftKey: true, typing: true })),
    ).toBeNull();
  });
});

describe('resolveShortcut — focus ownership', () => {
  it('leaves Space to a focused button so it cannot fire twice', () => {
    expect(resolveShortcut(press({ key: ' ', onButton: true }))).toBeNull();
  });

  it('leaves arrows to a focused range input', () => {
    expect(resolveShortcut(press({ key: 'ArrowRight', onRange: true }))).toBeNull();
    expect(resolveShortcut(press({ key: 'ArrowLeft', onRange: true }))).toBeNull();
    expect(resolveShortcut(press({ key: 'ArrowRight', shiftKey: true, onRange: true }))).toBeNull();
  });

  it('still handles letters while a button or the scrubber has focus', () => {
    expect(resolveShortcut(press({ key: 'l', onButton: true }))).toBe('toggleLoop');
    expect(resolveShortcut(press({ key: ' ', onRange: true }))).toBe('togglePlay');
  });
});

describe('resolveShortcut — browser modifiers and auto-repeat', () => {
  it('never steals a browser shortcut', () => {
    const modifiers: Array<Partial<ShortcutPress>> = [
      { ctrlKey: true },
      { metaKey: true },
      { altKey: true },
    ];

    for (const modifier of modifiers) {
      expect(resolveShortcut(press({ key: ' ', ...modifier }))).toBeNull();
      expect(resolveShortcut(press({ key: 'ArrowRight', ...modifier }))).toBeNull();
      expect(resolveShortcut(press({ key: 'f', ...modifier }))).toBeNull();
      expect(resolveShortcut(press({ key: 'l', ...modifier }))).toBeNull();
    }
  });

  it('fires toggles once per press, not on every auto-repeat', () => {
    expect(resolveShortcut(press({ key: ' ', repeat: true }))).toBeNull();
    expect(resolveShortcut(press({ key: 'l', repeat: true }))).toBeNull();
    expect(resolveShortcut(press({ key: 'm', repeat: true }))).toBeNull();
    expect(resolveShortcut(press({ key: 'f', repeat: true }))).toBeNull();
    expect(resolveShortcut(press({ key: '?', repeat: true }))).toBeNull();
  });

  it('keeps repeating frame steps and seeks while a key is held', () => {
    expect(resolveShortcut(press({ key: 'ArrowRight', repeat: true }))).toBe('stepForward');
    expect(resolveShortcut(press({ key: 'ArrowLeft', repeat: true }))).toBe('stepBackward');
    expect(resolveShortcut(press({ key: 'ArrowRight', shiftKey: true, repeat: true }))).toBe(
      'seekForward',
    );
  });
});
