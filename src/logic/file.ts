/**
 * File-name and media-error helpers. Pure and DOM-free: the media layer passes in
 * plain values, so every message the user can see is unit-testable.
 */

/** Minimum shape needed to judge a picked file; `File` satisfies it. */
export interface FileIdentity {
  readonly name: string;
  readonly type: string;
}

/** Shown when a file has no usable name left after trimming and extension stripping. */
export const FALLBACK_LABEL = 'Untitled video';

/**
 * Extensions accepted when the browser reports no MIME type.
 *
 * Browsers decode only a handful of codecs, so this list is deliberately wider than the
 * list of formats that play directly: an editing container (AVI, MXF, WMV, MPEG-TS, …) is
 * accepted so it can be converted locally instead of being rejected as "not a video".
 * `.mkv` and `.mov` are included for the same reason. The media element, not this list,
 * decides whether a file plays as-is.
 */
export const VIDEO_FILE_EXTENSIONS = [
  '.mp4',
  '.m4v',
  '.webm',
  '.ogv',
  '.ogg',
  '.mov',
  '.mkv',
  '.avi',
  '.wmv',
  '.asf',
  '.flv',
  '.f4v',
  '.mpg',
  '.mpeg',
  '.m1v',
  '.m2v',
  '.m2p',
  '.ts',
  '.mts',
  '.m2ts',
  '.mxf',
  '.dv',
  '.vob',
  '.3gp',
  '.3g2',
  '.ogm',
  '.rm',
  '.rmvb',
  '.divx',
  '.h264',
  '.264',
  '.h265',
  '.265',
  '.hevc',
  '.av1',
  '.ivf',
  '.y4m',
] as const;

/** `accept` attribute for both video pickers, built from the extension list above. */
export const VIDEO_ACCEPT_ATTRIBUTE = ['video/*', ...VIDEO_FILE_EXTENSIONS].join(',');

/** How a failed media load is described to the user. */
export type MediaErrorKind = 'aborted' | 'network' | 'decode' | 'unsupported' | 'unknown';

/** File name without its last extension; falls back to {@link FALLBACK_LABEL}. */
export type FileLabeler = (filename: string) => string;

/** Cheap pre-flight check; the media element remains the real gate. */
export type VideoFileGuard = (file: FileIdentity) => boolean;

/** Maps `MediaError.code` onto the five messages the app can produce. */
export type MediaErrorClassifier = (code: number | null | undefined) => MediaErrorKind;

function normalise(filename: string): string {
  return filename.trim();
}

/**
 * Strips only the last extension, so `archive.tar.gz` becomes `archive.tar`.
 * Dotfiles keep their leading dot (`.env` stays `.env`), a name ending in a dot is
 * returned unchanged, and blank names fall back to {@link FALLBACK_LABEL}.
 */
export const labelFromFilename: FileLabeler = (filename) => {
  const name = normalise(filename);

  if (name.length === 0) {
    return FALLBACK_LABEL;
  }

  const lastDot = name.lastIndexOf('.');

  if (lastDot <= 0 || lastDot === name.length - 1) {
    return name;
  }

  const stem = name.slice(0, lastDot).trim();

  return stem.length > 0 ? stem : name;
};

/** True when the name ends in one of {@link VIDEO_FILE_EXTENSIONS}, case-insensitively. */
function hasVideoExtension(filename: string): boolean {
  const name = normalise(filename).toLowerCase();

  return VIDEO_FILE_EXTENSIONS.some((extension) => name.endsWith(extension));
}

/**
 * MIME types that carry no information about the content. Windows browsers report these for
 * `.mkv` and `.mov` dragged in from the file manager; treating them as authoritative would
 * reject a playable file with a misleading "not a video" message.
 */
const GENERIC_MIME_TYPES = ['application/octet-stream', 'binary/octet-stream'];

/**
 * A non-empty, specific MIME type is authoritative: `video/*` passes, anything else is
 * rejected even if the name looks like a video. When the type is empty or generic (common
 * for `.mkv` and for files dragged from some file managers) the extension is the only
 * signal left.
 */
export const isProbablyVideoFile: VideoFileGuard = (file) => {
  const mime = normalise(file.type).toLowerCase();

  if (mime.length > 0 && !GENERIC_MIME_TYPES.includes(mime)) {
    return mime.startsWith('video/');
  }

  return hasVideoExtension(file.name);
};

/**
 * `MediaError.code`: 1 aborted, 2 network, 3 decode, 4 source not supported.
 * Anything else (including a missing error object) is `unknown`.
 */
export const classifyMediaError: MediaErrorClassifier = (code) => {
  switch (code) {
    case 1:
      return 'aborted';
    case 2:
      return 'network';
    case 3:
      return 'decode';
    case 4:
      return 'unsupported';
    default:
      return 'unknown';
  }
};

/** Inline message for a dropped file that is not a video at all. */
export function nonVideoMessage(filename: string): string {
  const name = normalise(filename);
  const subject = name.length > 0 ? `"${name}" is not a video file.` : 'That file is not a video.';

  return `${subject} Choose an MP4, WebM, MOV, AVI or MKV file.`;
}

/** Friendly, file-naming message for a media element failure. */
export function mediaErrorMessage(kind: MediaErrorKind, filename: string): string {
  const name = normalise(filename);
  const subject = name.length > 0 ? `"${name}"` : 'This file';

  switch (kind) {
    case 'aborted':
      return `Loading ${subject} was cancelled. Choose the file again to retry.`;
    case 'network':
      return `${subject} could not be read. The file may have been moved or deleted.`;
    case 'decode':
      return `${subject} could not be decoded. It may be damaged or use an unsupported codec. Use Convert locally, or re-encode it to H.264 MP4 or WebM.`;
    case 'unsupported':
      return `This browser cannot play ${subject}. Its container or codec is unsupported (Lagarith, ProRes, DNxHD and other editing codecs, some HEVC and MKV files). Use Convert locally, or re-encode it to H.264 MP4 or WebM.`;
    case 'unknown':
      return `${subject} could not be played. Use Convert locally, or re-encode it to H.264 MP4 or WebM.`;
  }
}
