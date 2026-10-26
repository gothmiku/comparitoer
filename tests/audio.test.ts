import { describe, expect, it } from 'vitest';

import {
  AUDIO_TRACK_ACCEPT_ATTRIBUTE,
  AUDIO_TRACK_EXTENSIONS,
  audioTrackErrorMessage,
  FALLBACK_TRACK_LABEL,
  isProbablyAudioTrack,
  nonAudioTrackMessage,
  trackLabelFromFilename,
} from '../src/logic/audio';
import { createEmptyTrack, createInitialState } from '../src/state';

describe('audio track extensions', () => {
  it('covers the common audio containers plus video containers', () => {
    for (const extension of ['.mp3', '.m4a', '.wav', '.ogg', '.flac', '.webm', '.mp4', '.mov']) {
      expect(AUDIO_TRACK_EXTENSIONS).toContain(extension);
    }
  });

  it('builds an accept attribute from the wildcards and the extensions', () => {
    expect(AUDIO_TRACK_ACCEPT_ATTRIBUTE).toContain('audio/*');
    expect(AUDIO_TRACK_ACCEPT_ATTRIBUTE).toContain('video/mp4');

    for (const extension of AUDIO_TRACK_EXTENSIONS) {
      expect(AUDIO_TRACK_ACCEPT_ATTRIBUTE).toContain(extension);
    }
  });
});

describe('isProbablyAudioTrack', () => {
  it('accepts any specific audio MIME type', () => {
    expect(isProbablyAudioTrack({ name: 'track.mp3', type: 'audio/mpeg' })).toBe(true);
    expect(isProbablyAudioTrack({ name: 'clip.m4a', type: 'audio/mp4' })).toBe(true);
    expect(isProbablyAudioTrack({ name: 'weird.bin', type: 'audio/ogg' })).toBe(true);
  });

  it('accepts a video container, because its soundtrack is a valid source', () => {
    expect(isProbablyAudioTrack({ name: 'clip.mp4', type: 'video/mp4' })).toBe(true);
    expect(isProbablyAudioTrack({ name: 'clip.webm', type: 'video/webm' })).toBe(true);
  });

  it('rejects a specific non-media MIME type even with an audio name', () => {
    expect(isProbablyAudioTrack({ name: 'track.mp3', type: 'text/plain' })).toBe(false);
    expect(isProbablyAudioTrack({ name: 'track.wav', type: 'image/png' })).toBe(false);
    expect(isProbablyAudioTrack({ name: 'document.pdf', type: 'application/pdf' })).toBe(false);
  });

  it('falls back to the extension for an empty or generic type', () => {
    expect(isProbablyAudioTrack({ name: 'Track.MP3', type: '' })).toBe(true);
    expect(isProbablyAudioTrack({ name: 'song.flac', type: 'application/octet-stream' })).toBe(
      true,
    );
    expect(isProbablyAudioTrack({ name: 'binary/m4a', type: 'binary/octet-stream' })).toBe(false);
    expect(isProbablyAudioTrack({ name: 'clip.mp4', type: 'binary/octet-stream' })).toBe(true);
  });

  it('rejects names that are not audio at all', () => {
    expect(isProbablyAudioTrack({ name: 'notes.txt', type: '' })).toBe(false);
    expect(isProbablyAudioTrack({ name: 'photo.jpeg', type: '' })).toBe(false);
    expect(isProbablyAudioTrack({ name: '', type: '' })).toBe(false);
  });

  it('is case- and whitespace-insensitive', () => {
    expect(isProbablyAudioTrack({ name: '  LOUD.WAV  ', type: '  Audio/WAV ' })).toBe(true);
  });
});

describe('trackLabelFromFilename', () => {
  it('strips the extension like the video labeler does', () => {
    expect(trackLabelFromFilename('master.m4a')).toBe('master');
    expect(trackLabelFromFilename('archive.tar.gz')).toBe('archive.tar');
    expect(trackLabelFromFilename('.env')).toBe('.env');
    expect(trackLabelFromFilename('trailing.')).toBe('trailing.');
  });

  it('never calls a nameless track a video', () => {
    expect(trackLabelFromFilename('   ')).toBe(FALLBACK_TRACK_LABEL);
    expect(trackLabelFromFilename('   ')).not.toContain('video');
  });
});

describe('nonAudioTrackMessage', () => {
  it('names the file and lists what is accepted', () => {
    const message = nonAudioTrackMessage('notes.txt');

    expect(message).toContain('"notes.txt"');
    expect(message).toContain('not an audio file');
    expect(message).toContain('MP3');
  });

  it('reads sensibly without a name', () => {
    expect(nonAudioTrackMessage('   ')).toContain('That file is not audio.');
  });
});

describe('audioTrackErrorMessage', () => {
  it('names the file for every error kind', () => {
    for (const kind of ['aborted', 'network', 'decode', 'unsupported', 'unknown']) {
      expect(audioTrackErrorMessage(kind, 'song.m4a')).toContain('"song.m4a"');
    }
  });

  it('suggests re-encoding when the codec is unsupported', () => {
    expect(audioTrackErrorMessage('unsupported', 'song.flac')).toContain('Re-encode');
    expect(audioTrackErrorMessage('decode', 'song.wav')).toContain('Re-encode');
  });

  it('was cancelled, read, decoded and played are all distinct messages', () => {
    const messages = ['aborted', 'network', 'decode', 'unsupported', 'unknown'].map((kind) =>
      audioTrackErrorMessage(kind, 'x.mp3'),
    );

    expect(new Set(messages).size).toBe(messages.length);
  });

  it('falls back to a subject when the name is empty', () => {
    expect(audioTrackErrorMessage('network', '  ')).toContain('The audio track');
  });
});

describe('track state', () => {
  it('starts empty with full gain', () => {
    const track = createEmptyTrack();

    expect(track.file).toBeNull();
    expect(track.objectUrl).toBeNull();
    expect(track.status).toBe('empty');
    expect(track.label).toBe('');
    expect(Number.isNaN(track.durationSeconds)).toBe(true);
  });

  it('is part of the initial app state', () => {
    const state = createInitialState();

    expect(state.track.status).toBe('empty');
    expect(state.trackLevel).toBe(1);
  });

  it('accepts a level override', () => {
    expect(createInitialState({ trackLevel: 0.25 }).trackLevel).toBe(0.25);
  });

  it('gives every state its own track object', () => {
    const first = createInitialState();
    const second = createInitialState();

    expect(first.track).not.toBe(second.track);
  });
});
