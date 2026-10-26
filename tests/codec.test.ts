import { describe, expect, it } from 'vitest';

import {
  EMPTY_PROBE,
  MAX_CONVERSION_BYTES,
  buildProxyArgs,
  chooseConversionPlan,
  codecLabel,
  conversionBlocker,
  conversionCancelledMessage,
  conversionErrorMessage,
  conversionLimitMessage,
  parseProbeLog,
  proxyFilename,
  proxyVideoFilter,
  proxyWarning,
  safeInputName,
} from '../src/logic/codec';
import type { ProbeSummary } from '../src/logic/codec';

const LAGARITH_LOG = [
  "Input #0, avi, from 'take1.avi':",
  '  Duration: 00:00:10.00, start: 0.000000, bitrate: 123456 kb/s',
  '  Stream #0:0: Video: lagarith (LAGS / 0x5347414C), yuv420p, 1920x1080, 30 fps, 30 tbr, 30 tbn',
  '  Stream #0:1: Audio: pcm_s16le ([1][0][0][0] / 0x0001), 48000 Hz, stereo, s16, 1536 kb/s',
];

const probeOf = (overrides: Partial<ProbeSummary> = {}): ProbeSummary => ({
  ...EMPTY_PROBE,
  videoCodec: 'lagarith',
  audioCodec: 'pcm_s16le',
  width: 1920,
  height: 1080,
  durationSeconds: 10,
  ...overrides,
});

describe('parseProbeLog', () => {
  it('reads codecs, size and duration of an AVI', () => {
    expect(parseProbeLog(LAGARITH_LOG)).toEqual({
      videoCodec: 'lagarith',
      audioCodec: 'pcm_s16le',
      width: 1920,
      height: 1080,
      durationSeconds: 10,
    });
  });

  it('handles hours, fractions and a language-tagged stream', () => {
    const probe = parseProbeLog([
      "Input #0, matroska,webm, from 'clip.mkv':",
      '  Duration: 01:02:03.456, start: 0.000000, bitrate: 5000 kb/s',
      '  Stream #0:0(eng): Video: h264 (High), yuv420p(tv, bt709), 1280x720, 24 fps',
    ]);

    expect(probe.durationSeconds).toBeCloseTo(3723.456, 3);
    expect(probe.videoCodec).toBe('h264');
    expect(probe.width).toBe(1280);
    expect(probe.height).toBe(720);
  });

  it('never mistakes a hex codec tag for a picture size', () => {
    const probe = parseProbeLog([
      '  Stream #0:0: Video: lagarith (LAGS / 0x5347414C), yuv420p, 640x480, 25 fps',
    ]);

    expect(probe.width).toBe(640);
    expect(probe.height).toBe(480);
  });

  it('reports a silent video with no audio codec', () => {
    const probe = parseProbeLog([
      '  Stream #0:0: Video: ffv1 (FFV1 / 0x31564646), yuv420p, 720x576, 25 fps',
    ]);

    expect(probe.videoCodec).toBe('ffv1');
    expect(probe.audioCodec).toBeNull();
    expect(probe.durationSeconds).toBeNaN();
  });

  it('returns an empty probe for a log it cannot read', () => {
    const probe = parseProbeLog(['take1.avi: Invalid data found when processing input']);

    expect(probe.videoCodec).toBeNull();
    expect(probe.audioCodec).toBeNull();
    expect(probe.width).toBe(0);
    expect(probe.height).toBe(0);
    expect(probe.durationSeconds).toBeNaN();
  });
});

describe('chooseConversionPlan', () => {
  it('re-encodes a codec no browser decodes', () => {
    const plan = chooseConversionPlan(probeOf());

    expect(plan.kind).toBe('transcode-h264');
    expect(plan.copiesVideo).toBe(false);
    expect(plan.container).toBe('mp4');
    expect(plan.extension).toBe('.mp4');
    expect(plan.audio).toBe('aac');
    expect(plan.label).toContain('H.264');
    expect(plan.detail).toContain('Lagarith');
  });

  it('copies H.264 into MP4 and keeps AAC audio', () => {
    const plan = chooseConversionPlan(probeOf({ videoCodec: 'h264', audioCodec: 'aac' }));

    expect(plan.kind).toBe('remux-mp4');
    expect(plan.copiesVideo).toBe(true);
    expect(plan.audio).toBe('copy');
  });

  it('re-encodes audio that MP4 cannot carry', () => {
    const plan = chooseConversionPlan(probeOf({ videoCodec: 'h264', audioCodec: 'ac3' }));

    expect(plan.kind).toBe('remux-mp4');
    expect(plan.audio).toBe('aac');
  });

  it('copies VP9 into WebM and keeps Opus audio', () => {
    const plan = chooseConversionPlan(probeOf({ videoCodec: 'vp9', audioCodec: 'opus' }));

    expect(plan.kind).toBe('remux-webm');
    expect(plan.container).toBe('webm');
    expect(plan.extension).toBe('.webm');
    expect(plan.audio).toBe('copy');
  });

  it('re-encodes audio that WebM cannot carry', () => {
    const plan = chooseConversionPlan(probeOf({ videoCodec: 'vp8', audioCodec: 'pcm_s16le' }));

    expect(plan.kind).toBe('remux-webm');
    expect(plan.audio).toBe('opus');
  });

  it('drops audio when the source is silent', () => {
    expect(chooseConversionPlan(probeOf({ audioCodec: null })).audio).toBe('none');
    expect(chooseConversionPlan(probeOf({ videoCodec: 'h264', audioCodec: null })).audio).toBe(
      'none',
    );
  });

  it('re-encodes HEVC instead of copying it', () => {
    const plan = chooseConversionPlan(probeOf({ videoCodec: 'hevc', audioCodec: 'aac' }));

    expect(plan.kind).toBe('transcode-h264');
    expect(plan.copiesVideo).toBe(false);
  });

  it('re-encodes a file whose video codec could not be read', () => {
    const plan = chooseConversionPlan(EMPTY_PROBE);

    expect(plan.kind).toBe('transcode-h264');
    expect(plan.audio).toBe('none');
  });
});

describe('conversionBlocker', () => {
  it('accepts a file with a video stream', () => {
    expect(conversionBlocker(probeOf())).toBeNull();
  });

  it('rejects a file with no video stream', () => {
    expect(conversionBlocker(EMPTY_PROBE)).toContain('No video stream');
  });
});

describe('proxyVideoFilter', () => {
  it('scales a fast proxy down to 720p', () => {
    expect(proxyVideoFilter(probeOf({ height: 1080 }), true)).toBe('scale=-2:720');
  });

  it('never upscales a small fast proxy', () => {
    expect(proxyVideoFilter(probeOf({ height: 480 }), true)).toBe(
      'scale=trunc(iw/2)*2:trunc(ih/2)*2',
    );
  });

  it('keeps the size but forces even dimensions', () => {
    expect(proxyVideoFilter(probeOf({ height: 1080 }), false)).toBe(
      'scale=trunc(iw/2)*2:trunc(ih/2)*2',
    );
  });
});


describe('buildProxyArgs', () => {
  const input = '/input/take1.avi';
  const output = '/output/take1.proxy.mp4';

  it('re-encodes Lagarith to H.264/AAC with a faststart index', () => {
    const args = buildProxyArgs(chooseConversionPlan(probeOf()), input, output, probeOf(), false);

    expect(args).toContain('libx264');
    expect(args).toContain('yuv420p');
    expect(args).toContain('ultrafast');
    expect(args).toContain('aac');
    expect(args).toContain('+faststart');
    expect(args.slice(-2)).toEqual(['-y', output]);
    expect(args).not.toContain('copy');
  });

  it('copies the picture for a remux and adds no encoder options', () => {
    const probe = probeOf({ videoCodec: 'h264', audioCodec: 'aac' });
    const args = buildProxyArgs(
      chooseConversionPlan(probe),
      '/input/clip.mkv',
      '/output/clip.proxy.mp4',
      probe,
      false,
    );

    expect(args[args.indexOf('-c:v') + 1]).toBe('copy');
    expect(args).not.toContain('libx264');
    expect(args).not.toContain('-vf');
  });

  it('writes WebM without an MP4 faststart flag', () => {
    const probe = probeOf({ videoCodec: 'vp9', audioCodec: 'opus' });
    const args = buildProxyArgs(
      chooseConversionPlan(probe),
      '/input/clip.webm',
      '/output/clip.proxy.webm',
      probe,
      false,
    );

    expect(args).toContain('webm');
    expect(args).not.toContain('+faststart');
    expect(args).not.toContain('libx264');
  });

  it('adds -an for a silent source', () => {
    const probe = probeOf({ audioCodec: null });
    const args = buildProxyArgs(chooseConversionPlan(probe), input, output, probe, false);

    expect(args).toContain('-an');
    expect(args).not.toContain('-c:a');
  });

  it('passes the fast-proxy filter when asked for one', () => {
    const probe = probeOf({ height: 1080 });
    const args = buildProxyArgs(chooseConversionPlan(probe), input, output, probe, true);

    expect(args[args.indexOf('-vf') + 1]).toBe('scale=-2:720');
  });
});

describe('proxyFilename', () => {
  it('keeps the source stem and marks the file as a proxy', () => {
    expect(proxyFilename('take1.avi', '.mp4')).toBe('take1.proxy.mp4');
    expect(proxyFilename('My Clip.FINAL.mov', '.webm')).toBe('My Clip.FINAL.proxy.webm');
    expect(proxyFilename('no-extension', '.mp4')).toBe('no-extension.proxy.mp4');
  });
});

describe('safeInputName', () => {
  it('keeps spaces and parentheses intact', () => {
    expect(safeInputName('My Clip (final).avi')).toBe('My Clip (final).avi');
  });

  it('replaces path separators and control characters', () => {
    expect(safeInputName('a/b\\c:d*.avi')).toBe('a_b_c_d_.avi');
    expect(safeInputName('bad\u0007name.avi')).toBe('bad_name.avi');
  });

  it('falls back for an empty name', () => {
    expect(safeInputName('')).toBe('input');
  });
});

describe('codecLabel', () => {
  it('uses friendly names for known codecs', () => {
    expect(codecLabel('lagarith')).toBe('Lagarith');
    expect(codecLabel('prores')).toBe('ProRes');
    expect(codecLabel('dnxhd')).toBe('DNxHD');
    expect(codecLabel('h264')).toBe('H.264');
    expect(codecLabel('LAGARITH')).toBe('Lagarith');
  });

  it('keeps an unknown codec readable and names a missing one', () => {
    expect(codecLabel('some_new_codec')).toBe('some_new_codec');
    expect(codecLabel(null)).toBe('Unknown codec');
    expect(codecLabel('')).toBe('Unknown codec');
  });
});

describe('conversion messages', () => {
  it('names the file and the limit when a source is too large', () => {
    const message = conversionLimitMessage('huge.avi', MAX_CONVERSION_BYTES * 1.5);

    expect(message).toContain('"huge.avi"');
    expect(message).toContain('3.00 GB');
    expect(message).toContain('2 GB');
  });

  it('names the file and the reason when conversion fails', () => {
    const message = conversionErrorMessage('broken.avi', 'Invalid data found');

    expect(message).toContain('"broken.avi"');
    expect(message).toContain('Invalid data found');
    expect(message).toContain('H.264');
  });

  it('stays readable without a reason', () => {
    const message = conversionErrorMessage('broken.avi', null);

    expect(message).not.toContain('()');
    expect(message).toContain('"broken.avi"');
  });

  it('says a cancelled conversion can be retried', () => {
    expect(conversionCancelledMessage('take1.avi')).toContain('cancelled');
  });
});

describe('proxyWarning', () => {
  it('labels the picture as a proxy and keeps the source codec', () => {
    const warning = proxyWarning(probeOf());

    expect(warning.kind).toBe('proxy');
    expect(warning.message).toContain('Lagarith');
    expect(warning.message).toContain('1920 × 1080');
    expect(warning.message).toContain('H.264');
  });

  it('omits the size when the probe did not report one', () => {
    const warning = proxyWarning(probeOf({ width: 0, height: 0 }));

    expect(warning.message).not.toContain('×');
  });
});

