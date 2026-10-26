import { describe, expect, it } from 'vitest';

import {
  FALLBACK_LABEL,
  VIDEO_ACCEPT_ATTRIBUTE,
  VIDEO_FILE_EXTENSIONS,
  classifyMediaError,
  isProbablyVideoFile,
  labelFromFilename,
  mediaErrorMessage,
  nonVideoMessage,
} from '../src/logic/file';

describe('labelFromFilename', () => {
  it('strips the last extension only', () => {
    expect(labelFromFilename('clip.mp4')).toBe('clip');
    expect(labelFromFilename('archive.tar.gz')).toBe('archive.tar');
    expect(labelFromFilename('take 2.final.FINAL.mov')).toBe('take 2.final.FINAL');
  });

  it('keeps dotfiles and names without an extension', () => {
    expect(labelFromFilename('.env')).toBe('.env');
    expect(labelFromFilename('README')).toBe('README');
  });

  it('does not strip a trailing dot into an empty label', () => {
    expect(labelFromFilename('trailing.')).toBe('trailing.');
  });

  it('trims surrounding whitespace', () => {
    expect(labelFromFilename('  holiday clip.mp4  ')).toBe('holiday clip');
    expect(labelFromFilename('   spaced name   ')).toBe('spaced name');
  });

  it('falls back for blank names', () => {
    expect(labelFromFilename('')).toBe(FALLBACK_LABEL);
    expect(labelFromFilename('   ')).toBe(FALLBACK_LABEL);
  });

  it('keeps a leading-dot name even when the dot starts the extension', () => {
    expect(labelFromFilename('   .mp4')).toBe('.mp4');
    expect(labelFromFilename(' .mp4 ')).toBe('.mp4');
  });
});

describe('isProbablyVideoFile', () => {
  it('accepts any video/* MIME type', () => {
    expect(isProbablyVideoFile({ name: 'clip.mp4', type: 'video/mp4' })).toBe(true);
    expect(isProbablyVideoFile({ name: 'clip', type: 'video/x-matroska' })).toBe(true);
    expect(isProbablyVideoFile({ name: 'clip.mp4', type: 'VIDEO/MP4' })).toBe(true);
  });

  it('rejects a non-video MIME type even when the name looks like a video', () => {
    expect(isProbablyVideoFile({ name: 'clip.mp4', type: 'image/png' })).toBe(false);
    expect(isProbablyVideoFile({ name: 'clip.mov', type: 'text/plain' })).toBe(false);
    expect(isProbablyVideoFile({ name: 'clip.mp4', type: 'application/pdf' })).toBe(false);
  });

  it('falls back to the extension when the MIME type is empty', () => {
    expect(isProbablyVideoFile({ name: 'movie.MKV', type: '' })).toBe(true);
    expect(isProbablyVideoFile({ name: 'movie.mov', type: '   ' })).toBe(true);
    expect(isProbablyVideoFile({ name: 'notes.txt', type: '' })).toBe(false);
    expect(isProbablyVideoFile({ name: 'noextension', type: '' })).toBe(false);
    expect(isProbablyVideoFile({ name: '', type: '' })).toBe(false);
  });

  it('falls back to the extension for a generic octet-stream type', () => {
    // Windows browsers report this for .mkv/.mov dragged from the file manager.
    expect(isProbablyVideoFile({ name: 'movie.mkv', type: 'application/octet-stream' })).toBe(true);
    expect(isProbablyVideoFile({ name: 'movie.MOV', type: 'binary/octet-stream' })).toBe(true);
    expect(isProbablyVideoFile({ name: 'notes.txt', type: 'application/octet-stream' })).toBe(
      false,
    );
    expect(isProbablyVideoFile({ name: 'noextension', type: 'binary/octet-stream' })).toBe(false);
  });

  it('keeps a specific non-video type authoritative over the extension', () => {
    expect(isProbablyVideoFile({ name: 'clip.mkv', type: 'text/plain' })).toBe(false);
    expect(isProbablyVideoFile({ name: 'clip.mov', type: 'image/png' })).toBe(false);
  });

  it('does not match extensions in the middle of a name', () => {
    expect(isProbablyVideoFile({ name: 'mp4-notes.txt', type: '' })).toBe(false);
    expect(isProbablyVideoFile({ name: 'clip.mp4.txt', type: '' })).toBe(false);
  });

  it('covers every extension in the allowlist', () => {
    for (const extension of VIDEO_FILE_EXTENSIONS) {
      expect(isProbablyVideoFile({ name: `clip${extension}`, type: '' })).toBe(true);
      expect(isProbablyVideoFile({ name: `clip${extension.toUpperCase()}`, type: '' })).toBe(true);
    }
  });
});

describe('classifyMediaError', () => {
  it('maps the four MediaError codes', () => {
    expect(classifyMediaError(1)).toBe('aborted');
    expect(classifyMediaError(2)).toBe('network');
    expect(classifyMediaError(3)).toBe('decode');
    expect(classifyMediaError(4)).toBe('unsupported');
  });

  it('treats unknown and missing codes as unknown', () => {
    expect(classifyMediaError(0)).toBe('unknown');
    expect(classifyMediaError(5)).toBe('unknown');
    expect(classifyMediaError(Number.NaN)).toBe('unknown');
    expect(classifyMediaError(null)).toBe('unknown');
    expect(classifyMediaError(undefined)).toBe('unknown');
  });
});

describe('nonVideoMessage', () => {
  it('names the file and suggests what to pick', () => {
    const message = nonVideoMessage('notes.txt');

    expect(message).toContain('"notes.txt"');
    expect(message).toContain('not a video file');
    expect(message).toContain('MP4');
  });

  it('stays readable without a name', () => {
    expect(nonVideoMessage('  ')).toContain('not a video');
    expect(nonVideoMessage('')).not.toContain('""');
  });
});

describe('mediaErrorMessage', () => {
  it('names the file in every message', () => {
    const kinds = ['aborted', 'network', 'decode', 'unsupported', 'unknown'] as const;

    for (const kind of kinds) {
      expect(mediaErrorMessage(kind, 'holiday.mkv')).toContain('"holiday.mkv"');
    }
  });

  it('suggests re-encoding for decode, unsupported and unknown failures', () => {
    for (const kind of ['decode', 'unsupported', 'unknown'] as const) {
      const message = mediaErrorMessage(kind, 'clip.mov');
      expect(message).toContain('H.264 MP4');
      expect(message).toContain('WebM');
    }
  });

  it('does not suggest re-encoding for an aborted or unreadable file', () => {
    expect(mediaErrorMessage('aborted', 'clip.mp4')).not.toContain('H.264');
    expect(mediaErrorMessage('network', 'clip.mp4')).not.toContain('H.264');
  });

  it('falls back to "This file" when there is no name', () => {
    expect(mediaErrorMessage('decode', '  ')).toContain('This file');
    expect(mediaErrorMessage('decode', '  ')).not.toContain('""');
  });
});

describe('VIDEO_ACCEPT_ATTRIBUTE', () => {
  it('accepts video MIME types and every editing extension the picker should show', () => {
    expect(VIDEO_ACCEPT_ATTRIBUTE.startsWith('video/*')).toBe(true);

    for (const extension of ['.mp4', '.webm', '.mov', '.mkv', '.avi', '.mxf', '.ts']) {
      expect(VIDEO_ACCEPT_ATTRIBUTE.split(',')).toContain(extension);
      expect([...VIDEO_FILE_EXTENSIONS]).toContain(extension);
    }
  });

  it('has no empty entries', () => {
    expect(VIDEO_ACCEPT_ATTRIBUTE.split(',').every((entry) => entry.trim().length > 0)).toBe(true);
  });
});
