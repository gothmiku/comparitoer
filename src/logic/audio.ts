/**
 * External audio-track helpers. Pure and DOM-free, mirroring `logic/file.ts` so every message
 * the user can see is unit-tested.
 *
 * The third source is a plain media file whose soundtrack replaces both videos' audio. It may be
 * an audio container *or* a video container: `<audio>` happily plays the soundtrack of an MP4 or
 * a WebM, and being able to point the track at a clean master of the same clip is the whole
 * reason this feature exists.
 */

import { FALLBACK_LABEL, labelFromFilename } from './file';
import type { FileIdentity } from './file';

/** Shown when a chosen track has no usable name. */
export const FALLBACK_TRACK_LABEL = 'Audio track';

/**
 * File name without its last extension, with a track-specific fallback.
 *
 * Reuses the video label rules (so `.env` and `trailing.` behave the same) but never calls a
 * nameless audio file "Untitled video".
 */
export function trackLabelFromFilename(filename: string): string {
  const label = labelFromFilename(filename);

  return label === FALLBACK_LABEL ? FALLBACK_TRACK_LABEL : label;
}

/**
 * Extensions accepted when the browser reports no MIME type. The media element, not this list,
 * decides whether the file is playable, so an unsupported codec gets an honest error.
 */
export const AUDIO_TRACK_EXTENSIONS = [
  '.mp3',
  '.m4a',
  '.m4b',
  '.aac',
  '.wav',
  '.ogg',
  '.oga',
  '.opus',
  '.flac',
  '.webm',
  '.mp4',
  '.mov',
] as const;

/**
 * `accept` attribute for the track picker.
 *
 * `audio/*` plus the video containers worth offering, because a video file is a valid source for
 * the soundtrack. Extensions are repeated for browsers that ignore the wildcards.
 */
export const AUDIO_TRACK_ACCEPT_ATTRIBUTE = [
  'audio/*',
  'video/mp4',
  'video/webm',
  'video/quicktime',
  ...AUDIO_TRACK_EXTENSIONS,
].join(',');

/** MIME types that carry no information about the content; the extension decides instead. */
const GENERIC_MIME_TYPES = ['application/octet-stream', 'binary/octet-stream'];

/** A non-empty, specific MIME type that can carry a soundtrack. */
function isMediaMime(mime: string): boolean {
  return mime.startsWith('audio/') || mime.startsWith('video/');
}

function hasAudioTrackExtension(filename: string): boolean {
  const name = filename.trim().toLowerCase();

  return AUDIO_TRACK_EXTENSIONS.some((extension) => name.endsWith(extension));
}

/**
 * True when the file is worth handing to the track element.
 *
 * A specific MIME type is authoritative: any `audio/*` or `video/*` passes, anything else is
 * rejected even when the name looks right. When the type is empty or generic (common for `.m4a`
 * and `.flac` dragged from some file managers) the extension is the only signal left.
 */
export function isProbablyAudioTrack(file: FileIdentity): boolean {
  const mime = file.type.trim().toLowerCase();

  if (mime.length > 0 && !GENERIC_MIME_TYPES.includes(mime)) {
    return isMediaMime(mime);
  }

  return hasAudioTrackExtension(file.name);
}

/** Inline message for a track file that is neither audio nor a video container. */
export function nonAudioTrackMessage(filename: string): string {
  const name = filename.trim();
  const subject = name.length > 0 ? `"${name}" is not an audio file.` : 'That file is not audio.';

  return `${subject} Choose an MP3, M4A, WAV, OGG, FLAC, MP4 or WebM file.`;
}

/** Friendly, file-naming message for a track that the media element refused to play. */
export function audioTrackErrorMessage(kind: string, filename: string): string {
  const name = filename.trim();
  const subject = name.length > 0 ? `"${name}"` : 'The audio track';

  switch (kind) {
    case 'aborted':
      return `Loading ${subject} was cancelled. Choose the file again to retry.`;
    case 'network':
      return `${subject} could not be read. The file may have been moved or deleted.`;
    case 'decode':
      return `${subject} could not be decoded. It may be damaged or use an unsupported codec. Re-encode it to MP3, M4A or WebM.`;
    case 'unsupported':
      return `This browser cannot play ${subject}. Its container or codec is unsupported. Re-encode it to MP3, M4A or WebM.`;
    default:
      return `${subject} could not be played. If it plays elsewhere, re-encode it to MP3, M4A or WebM.`;
  }
}
