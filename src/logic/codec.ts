/**
 * Local codec-conversion helpers. Pure and DOM-free: the transcode layer feeds in ffmpeg's
 * log lines and gets back a plan, an argument list and every message the user can see.
 *
 * Browsers only decode a small set of codecs. Editing formats (Lagarith, ProRes, DNxHD,
 * FFV1, HuffYUV, Ut Video, CineForm, MagicYUV, MPEG-2, VC-1, …) therefore need a local
 * proxy before they can be compared, which is what these helpers describe.
 */

import { labelFromFilename } from './file';
import { formatResolution } from './info';
import type { InfoBarWarning } from './info';

/** Largest source the in-browser converter accepts: WebAssembly cannot address more. */
export const MAX_CONVERSION_BYTES = 2_147_483_648;

/** Height a "fast" proxy is scaled to; the width follows the source aspect ratio. */
export const PROXY_HD_HEIGHT = 720;

/** Constant-quality level of the proxy. Low enough that it is not confused with a master. */
export const PROXY_CRF = '20';

/** Audio bitrate of the proxy, in bits per second. */
export const PROXY_AUDIO_BITRATE = '128k';

/** Keyframe interval of the proxy, in frames: fast enough to scrub comfortably. */
export const PROXY_KEYFRAME_INTERVAL = 60;

/** Facts read from ffmpeg's own description of the file. */
export interface ProbeSummary {
  /** FFmpeg codec name of the first video stream, e.g. `lagarith`; null when absent. */
  readonly videoCodec: string | null;
  /** FFmpeg codec name of the first audio stream; null when the file is silent. */
  readonly audioCodec: string | null;
  readonly width: number;
  readonly height: number;
  /** Container duration in seconds; NaN when ffmpeg did not report one. */
  readonly durationSeconds: number;
}

/** A probe that found nothing; used until ffmpeg has described the file. */
export const EMPTY_PROBE: ProbeSummary = {
  videoCodec: null,
  audioCodec: null,
  width: 0,
  height: 0,
  durationSeconds: Number.NaN,
};

/** How the proxy is produced. `remux` copies the picture, `transcode` re-encodes it. */
export type ConversionKind = 'remux-mp4' | 'remux-webm' | 'transcode-h264';

/** What to do with the source's audio while producing the proxy. */
export type AudioStrategy = 'copy' | 'aac' | 'opus' | 'none';

/** Everything the transcode layer needs to build the ffmpeg command and describe it. */
export interface ConversionPlan {
  readonly kind: ConversionKind;
  /** Extension of the produced file, including the dot. */
  readonly extension: string;
  /** Container written by the plan; used as an explicit `-f` argument. */
  readonly container: 'mp4' | 'webm';
  /** True when the picture is copied instead of re-encoded. */
  readonly copiesVideo: boolean;
  readonly audio: AudioStrategy;
  /** Short action label, e.g. "Remuxing into MP4". */
  readonly label: string;
  /** One sentence explaining what will happen, shown under the status message. */
  readonly detail: string;
}

/** H.264 is the one codec every target browser plays, so it alone can be copied into MP4. */
const MP4_COPY_VIDEO_CODECS = ['h264'];

/** Codecs that can be copied into WebM unchanged. */
const WEBM_COPY_VIDEO_CODECS = ['vp8', 'vp9', 'av1'];

/** Audio codecs that can be copied into each container without re-encoding. */
const MP4_COPY_AUDIO_CODECS = ['aac', 'mp3'];
const WEBM_COPY_AUDIO_CODECS = ['opus', 'vorbis'];


/**
 * `Duration: 00:01:02.34` from the input section. FFmpeg prints it in every container that
 * carries a duration; a format that does not (some raw streams) keeps NaN.
 */
const DURATION_PATTERN = /Duration:\s*(\d+):(\d{2}):(\d{2}(?:\.\d+)?)/;

/**
 * `Stream #0:0(eng): Video: lagarith (LAGS / 0x5347414C), …`
 *
 * The optional `[...]` and `(...)` groups cover the stream-id and language decorations
 * ffmpeg adds for Matroska, MPEG-TS and MP4 inputs.
 */
const VIDEO_STREAM_PATTERN =
  /Stream #\d+:\d+(?:\[[^\]]*\])?(?:\([^)]*\))?:\s*Video:\s*([A-Za-z0-9_]+)/;

const AUDIO_STREAM_PATTERN =
  /Stream #\d+:\d+(?:\[[^\]]*\])?(?:\([^)]*\))?:\s*Audio:\s*([A-Za-z0-9_]+)/;

/**
 * `1920x1080` inside a video-stream line. Width and height must start with 1-9 so the hex
 * codec tag (`0x5347414C`) can never be mistaken for a picture size.
 */
const SIZE_PATTERN = /(?:^|[,\s])([1-9]\d{0,4})x([1-9]\d{0,4})(?:[,\s]|$)/;

/** Human names for the codecs this app is likely to meet; unmapped ones read as-is. */
const CODEC_LABELS: Readonly<Record<string, string>> = {
  h264: 'H.264',
  hevc: 'HEVC',
  vp8: 'VP8',
  vp9: 'VP9',
  av1: 'AV1',
  mpeg1video: 'MPEG-1',
  mpeg2video: 'MPEG-2',
  mpeg4: 'MPEG-4 Part 2',
  vc1: 'VC-1',
  wmv3: 'WMV9',
  lagarith: 'Lagarith',
  prores: 'ProRes',
  prores_raw: 'ProRes RAW',
  dnxhd: 'DNxHD',
  ffv1: 'FFV1',
  ffvhuff: 'FFVHuff',
  huffyuv: 'HuffYUV',
  utvideo: 'Ut Video',
  cfhd: 'CineForm',
  magicyuv: 'MagicYUV',
  qtrle: 'QuickTime RLE',
  mjpeg: 'Motion JPEG',
  theora: 'Theora',
  rawvideo: 'Raw video',
  png: 'PNG frames',
  apng: 'APNG',
  dvvideo: 'DV',
  msrle: 'Microsoft RLE',
  msvideo1: 'Microsoft Video 1',
  cinepak: 'Cinepak',
  rv10: 'RealVideo 1',
  rv20: 'RealVideo 2',
  rv30: 'RealVideo 3',
  rv40: 'RealVideo 4',
};

/** How a codec is written in the UI: `Lagarith`, `H.264`, or the raw name if unknown. */
export function codecLabel(codec: string | null | undefined): string {
  if (codec === null || codec === undefined || codec.length === 0) {
    return 'Unknown codec';
  }

  return CODEC_LABELS[codec.toLowerCase()] ?? codec;
}


/**
 * Reads the first video/audio stream and the container duration out of ffmpeg's log.
 *
 * Deliberately tolerant: a probe is a convenience, and a file whose log cannot be parsed is
 * still handed to the converter, which then either copies or re-encodes it.
 */
export function parseProbeLog(lines: readonly string[]): ProbeSummary {
  let videoCodec: string | null = null;
  let audioCodec: string | null = null;
  let width = 0;
  let height = 0;
  let durationSeconds = Number.NaN;

  for (const line of lines) {
    if (!Number.isFinite(durationSeconds)) {
      const duration = DURATION_PATTERN.exec(line);

      if (duration !== null) {
        const hours = Number(duration[1] ?? 0);
        const minutes = Number(duration[2] ?? 0);
        const seconds = Number(duration[3] ?? 0);
        durationSeconds = hours * 3600 + minutes * 60 + seconds;
      }
    }

    if (videoCodec === null) {
      const stream = VIDEO_STREAM_PATTERN.exec(line);

      if (stream !== null) {
        videoCodec = (stream[1] ?? '').toLowerCase();

        const size = SIZE_PATTERN.exec(line);

        if (size !== null) {
          width = Number(size[1] ?? 0);
          height = Number(size[2] ?? 0);
        }
      }
    }

    if (audioCodec === null) {
      const stream = AUDIO_STREAM_PATTERN.exec(line);

      if (stream !== null) {
        audioCodec = (stream[1] ?? '').toLowerCase();
      }
    }
  }

  return { videoCodec, audioCodec, width, height, durationSeconds };
}

/**
 * Chooses the cheapest way to make the file playable.
 *
 * Only H.264 is copied into MP4: HEVC looks copyable but a browser without a platform
 * decoder rejects the result, which would produce a second unusable proxy. Everything that
 * is not already web-safe is re-encoded to H.264.
 */
export function chooseConversionPlan(probe: ProbeSummary): ConversionPlan {
  const codec = probe.videoCodec;
  const hasAudio = probe.audioCodec !== null;
  const audioCodec = probe.audioCodec ?? '';

  if (codec !== null && WEBM_COPY_VIDEO_CODECS.includes(codec)) {
    return {
      kind: 'remux-webm',
      extension: '.webm',
      container: 'webm',
      copiesVideo: true,
      audio: hasAudio ? (WEBM_COPY_AUDIO_CODECS.includes(audioCodec) ? 'copy' : 'opus') : 'none',
      label: 'Remuxing into WebM',
      detail: `${codecLabel(codec)} is already web-friendly; the picture is copied, not re-encoded.`,
    };
  }

  if (codec !== null && MP4_COPY_VIDEO_CODECS.includes(codec)) {
    return {
      kind: 'remux-mp4',
      extension: '.mp4',
      container: 'mp4',
      copiesVideo: true,
      audio: hasAudio ? (MP4_COPY_AUDIO_CODECS.includes(audioCodec) ? 'copy' : 'aac') : 'none',
      label: 'Remuxing into MP4',
      detail: `${codecLabel(codec)} is already web-friendly; the picture is copied, not re-encoded.`,
    };
  }

  return {
    kind: 'transcode-h264',
    extension: '.mp4',
    container: 'mp4',
    copiesVideo: false,
    audio: hasAudio ? 'aac' : 'none',
    label: 'Converting to H.264',
    detail: `${codecLabel(codec)} cannot be decoded by this browser, so the picture is re-encoded. Colour and fine detail are approximate.`,
  };
}

/** Why a file cannot be converted at all, or null when the converter can take it. */
export function conversionBlocker(probe: ProbeSummary): string | null {
  if (probe.videoCodec === null) {
    return 'No video stream was found, so there is nothing to compare.';
  }

  return null;
}


/**
 * Even dimensions are a hard requirement of 4:2:0 encoding, and a fast proxy is scaled down
 * to {@link PROXY_HD_HEIGHT} without ever being upscaled.
 */
export function proxyVideoFilter(probe: ProbeSummary, fastProxy: boolean): string {
  if (fastProxy && probe.height > PROXY_HD_HEIGHT) {
    return `scale=-2:${PROXY_HD_HEIGHT}`;
  }

  return 'scale=trunc(iw/2)*2:trunc(ih/2)*2';
}

/**
 * The ffmpeg argument list for one conversion. Paths are virtual paths inside the
 * converter's filesystem; nothing is passed through a shell.
 */
export function buildProxyArgs(
  plan: ConversionPlan,
  inputPath: string,
  outputPath: string,
  probe: ProbeSummary,
  fastProxy: boolean,
): string[] {
  const args = ['-hide_banner', '-nostdin', '-i', inputPath, '-map', '0:v:0'];

  if (plan.audio !== 'none') {
    args.push('-map', '0:a:0?');
  }

  if (plan.copiesVideo) {
    args.push('-c:v', 'copy');
  } else {
    args.push(
      '-vf',
      proxyVideoFilter(probe, fastProxy),
      '-c:v',
      'libx264',
      '-preset',
      'ultrafast',
      '-crf',
      PROXY_CRF,
      '-pix_fmt',
      'yuv420p',
      '-g',
      String(PROXY_KEYFRAME_INTERVAL),
    );
  }

  switch (plan.audio) {
    case 'copy':
      args.push('-c:a', 'copy');
      break;
    case 'aac':
      args.push('-c:a', 'aac', '-b:a', PROXY_AUDIO_BITRATE, '-ac', '2');
      break;
    case 'opus':
      args.push('-c:a', 'libopus', '-b:a', PROXY_AUDIO_BITRATE, '-ac', '2');
      break;
    case 'none':
      args.push('-an');
      break;
  }

  if (plan.container === 'mp4') {
    // Moves the index to the front so the proxy starts without a full download.
    args.push('-movflags', '+faststart');
  }

  args.push('-f', plan.container, '-y', outputPath);

  return args;
}

/** `clip.proxy.mp4` for `clip.avi`; the stem keeps the name the user recognises. */
export function proxyFilename(filename: string, extension: string): string {
  const stem = labelFromFilename(filename);

  return `${stem}.proxy${extension}`;
}

/**
 * A name that is safe inside the converter's virtual filesystem. Only path separators and
 * characters the virtual filesystem rejects are replaced: spaces and non-ASCII names are
 * fine in an argv array.
 */
export function safeInputName(filename: string): string {
  const cleaned = filename.replace(/[\\/:*?"<>|]/g, '_').replace(/[\u0000-\u001f]/g, '_');

  return cleaned.length > 0 ? cleaned : 'input';
}


/** Message for a source the converter refuses to load, with the reason. */
export function conversionLimitMessage(filename: string, sizeBytes: number): string {
  const gigabytes = (sizeBytes / 1_073_741_824).toFixed(2);
  const limit = (MAX_CONVERSION_BYTES / 1_073_741_824).toFixed(0);

  return `"${filename}" is ${gigabytes} GB. Local conversion is limited to ${limit} GB, the most the in-browser decoder can address. Re-encode the file to H.264 MP4 or WebM on your machine instead.`;
}

/** Message when the converter reports a failure, naming the file and suggesting a way out. */
export function conversionErrorMessage(filename: string, reason: string | null): string {
  const detail = reason === null || reason.length === 0 ? '' : ` (${reason})`;

  return `"${filename}" could not be converted locally${detail}. The file may be damaged, use a codec ffmpeg cannot decode, or be too large for the browser's memory. Re-encoding it to H.264 MP4 or WebM on your machine will always work.`;
}

/** Message after the user cancels a conversion. */
export function conversionCancelledMessage(filename: string): string {
  return `Conversion of "${filename}" was cancelled. Choose Convert locally to try again, or pick another file.`;
}

/** Informational chip so a proxy is never mistaken for the original master. */
export function proxyWarning(probe: ProbeSummary): InfoBarWarning {
  const size = formatResolution(probe.width, probe.height);
  const dimensions = size === '—' ? '' : ` ${size}`;

  return {
    kind: 'proxy',
    message: `Proxy: ${codecLabel(probe.videoCodec)}${dimensions} was converted locally to H.264 for playback. Timing is preserved; colour and fine detail are approximate.`,
  };
}
