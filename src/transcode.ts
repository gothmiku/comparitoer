import { FFFSType, FFmpeg } from '@ffmpeg/ffmpeg';
import type { LogEvent, ProgressEvent } from '@ffmpeg/ffmpeg';

import {
  MAX_CONVERSION_BYTES,
  buildProxyArgs,
  chooseConversionPlan,
  conversionBlocker,
  conversionErrorMessage,
  conversionLimitMessage,
  parseProbeLog,
  proxyFilename,
  safeInputName,
} from './logic/codec';
import type { ConversionPlan, ProbeSummary } from './logic/codec';
import type { ConversionStage } from './state';

/**
 * Resolves one core file against the page.
 *
 * `scripts/copy-ffmpeg-core.mjs` puts both files in `public/ffmpeg/`, so the URL is a plain
 * same-origin path that also works from a GitHub Pages subpath. Nothing is fetched from a
 * CDN, and nothing is uploaded.
 */
function coreAsset(name: string): string {
  return new URL(`ffmpeg/${name}`, document.baseURI).href;
}

const CORE_URL = coreAsset('ffmpeg-core.js');
const WASM_URL = coreAsset('ffmpeg-core.wasm');

/** Where a mounted source lives inside the converter's virtual filesystem. */
const MOUNT_POINT = '/input';

/** Where a large source is copied when mounting is unavailable. */
const WORK_DIR = '/work';

/** Where the proxy is written before it is read back into a `File`. */
const OUTPUT_DIR = '/output';

/** One conversion request: the chosen file and the proxy quality the user picked. */
export interface TranscodeRequest {
  readonly file: File;
  /** Scale the proxy down to 720p: quicker and smaller, at the cost of fine detail. */
  readonly fastProxy: boolean;
}

/** Progress reporting; every callback is optional because the UI only needs the ones it shows. */
export interface TranscodeCallbacks {
  /** The job moved to a new stage; `loading` means the ~32 MB decoder is being fetched. */
  readonly onStage?: (stage: ConversionStage) => void;
  /** Completed fraction 0-1 while ffmpeg is encoding. */
  readonly onRatio?: (ratio: number) => void;
}

/** A proxy that loaded successfully; the caller hands `file` to the media loader. */
export interface TranscodeSuccess {
  readonly status: 'converted';
  readonly file: File;
  readonly probe: ProbeSummary;
  readonly plan: ConversionPlan;
}

/** Every way a conversion can end. A failure never throws: it becomes a message. */
export type TranscodeOutcome =
  | TranscodeSuccess
  | { readonly status: 'cancelled' }
  | { readonly status: 'error'; readonly message: string };

/** The one module that drives ffmpeg; created by the composition root on first use. */
export interface Transcoder {
  convert(request: TranscodeRequest, callbacks?: TranscodeCallbacks): Promise<TranscodeOutcome>;
  /** Terminates the worker and discards the half-written proxy. Safe when nothing is running. */
  cancel(): void;
  isBusy(): boolean;
  destroy(): void;
}

/** Raised inside the job and turned into a `TranscodeOutcome` by `convert`. */
class ConversionFailure extends Error {
  constructor(reason: string | null) {
    super(reason ?? 'ffmpeg reported an error');
    this.name = 'ConversionFailure';
  }
}

/** Improves the generic error copy with the actual ffmpeg complaint, when there is one. */
const ERROR_LINE_PATTERN = /error|invalid|unsupported|not found|failed|could not|no such/i;

/**
 * The last line that looks like a complaint. ffmpeg prints its banner and stream summary
 * before anything goes wrong, so scanning from the end finds the useful line first.
 */
function lastErrorLine(lines: readonly string[]): string | null {
  for (let index = lines.length - 1; index >= 0; index -= 1) {
    const line = lines[index];

    if (line !== undefined && ERROR_LINE_PATTERN.test(line)) {
      return line.replace(/^\[[^\]]*\]\s*/, '').trim().slice(0, 200);
    }
  }

  return null;
}

/** Clamps ffmpeg's progress into a fraction the UI can render; NaN becomes null. */
function normaliseRatio(progress: number): number | null {
  if (!Number.isFinite(progress)) {
    return null;
  }

  return Math.min(1, Math.max(0, progress));
}


/** A mounted source, or a copy of it, plus whether it has to be removed afterwards. */
interface AttachedInput {
  readonly path: string;
  readonly mounted: boolean;
}

/** Creates a directory, tolerating "it already exists" from Emscripten's filesystem. */
async function ensureDir(ffmpeg: FFmpeg, path: string): Promise<void> {
  try {
    await ffmpeg.createDir(path);
  } catch {
    // The directory survived from a previous job; that is the state we want.
  }
}

/**
 * Makes the source readable by ffmpeg.
 *
 * `WORKERFS` is preferred: it lets the wasm read the `File` straight from the browser's
 * blob storage instead of copying a multi-hundred-megabyte buffer into Emscripten's heap.
 * A core without that filesystem (or a name it refuses) falls back to an ordinary copy.
 */
async function attachInput(ffmpeg: FFmpeg, file: File): Promise<AttachedInput> {
  await ensureDir(ffmpeg, MOUNT_POINT);

  try {
    const mounted = await ffmpeg.mount(FFFSType.WORKERFS, { files: [file] }, MOUNT_POINT);

    if (mounted) {
      return { path: `${MOUNT_POINT}/${file.name}`, mounted: true };
    }
  } catch {
    // Fall through to the in-memory copy.
  }

  await ensureDir(ffmpeg, WORK_DIR);

  const path = `${WORK_DIR}/${safeInputName(file.name)}`;
  await ffmpeg.writeFile(path, new Uint8Array(await file.arrayBuffer()));

  return { path, mounted: false };
}

/** Runs `ffmpeg -i <file>` and reads the stream summary out of the log it prints. */
async function probeInput(ffmpeg: FFmpeg, path: string): Promise<ProbeSummary> {
  const lines: string[] = [];
  const onLog = (event: LogEvent): void => {
    lines.push(event.message);
  };

  ffmpeg.on('log', onLog);

  try {
    // No output file is requested on purpose: ffmpeg exits non-zero, which is expected, and
    // the input description has already been printed by then.
    await ffmpeg.exec(['-hide_banner', '-i', path]);
  } finally {
    ffmpeg.off('log', onLog);
  }

  return parseProbeLog(lines);
}

/** Reads the finished proxy out of the virtual filesystem and hands ownership to the caller. */
async function readProxy(
  ffmpeg: FFmpeg,
  outputPath: string,
  outputName: string,
  plan: ConversionPlan,
): Promise<File> {
  const data = await ffmpeg.readFile(outputPath);

  if (!(data instanceof Uint8Array)) {
    throw new ConversionFailure('The output file could not be read');
  }

  // `readFile` returns a plain ArrayBuffer in a worker; the narrow view keeps the File exact
  // when the bytes arrive as a slice of a larger buffer.
  const buffer =
    data.byteOffset === 0 && data.byteLength === data.buffer.byteLength
      ? (data.buffer as ArrayBuffer)
      : (data.slice().buffer as ArrayBuffer);

  return new File([buffer], outputName, {
    type: plan.container === 'mp4' ? 'video/mp4' : 'video/webm',
  });
}

/**
 * Builds the converter controller.
 *
 * Nothing here runs until `convert()` is called, and this module is itself imported
 * dynamically, so the 32 MB core is fetched only when a file actually needs converting.
 * One instance is kept alive between jobs (the browser caches the core) and thrown away
 * after a cancellation or a failure, because a terminated worker cannot be reused.
 */
export function createTranscoder(): Transcoder {
  let instance: FFmpeg | null = null;
  /** The worker that owns a running job; null when idle. */
  let running: FFmpeg | null = null;
  let cancelled = false;

  function instanceOrCreate(): FFmpeg {
    instance ??= new FFmpeg();
    return instance;
  }

  function cancel(): void {
    if (running === null) {
      return;
    }

    cancelled = true;
    const worker = running;
    running = null;
    instance = null;
    worker.terminate();
  }

  async function convert(
    request: TranscodeRequest,
    callbacks: TranscodeCallbacks = {},
  ): Promise<TranscodeOutcome> {
    if (running !== null) {
      return {
        status: 'error',
        message:
          'Another file is already being converted. Wait for it to finish, or cancel it first.',
      };
    }

    if (request.file.size > MAX_CONVERSION_BYTES) {
      return {
        status: 'error',
        message: conversionLimitMessage(request.file.name, request.file.size),
      };
    }

    const ffmpeg = instanceOrCreate();
    running = ffmpeg;
    cancelled = false;

    const lines: string[] = [];
    const onLog = (event: LogEvent): void => {
      lines.push(event.message);
    };
    const onProgress = (event: ProgressEvent): void => {
      const ratio = normaliseRatio(event.progress);

      if (ratio !== null) {
        callbacks.onRatio?.(ratio);
      }
    };

    ffmpeg.on('log', onLog);
    ffmpeg.on('progress', onProgress);

    let input: AttachedInput | null = null;
    let outputPath: string | null = null;

    try {
      // The core is loaded once per worker; a second conversion reuses it.
      if (!ffmpeg.loaded) {
        callbacks.onStage?.('loading');
        await ffmpeg.load({ coreURL: CORE_URL, wasmURL: WASM_URL });
      }

      if (cancelled) {
        return { status: 'cancelled' };
      }

      input = await attachInput(ffmpeg, request.file);

      callbacks.onStage?.('probing');
      const probe = await probeInput(ffmpeg, input.path);

      if (cancelled) {
        return { status: 'cancelled' };
      }

      const blocker = conversionBlocker(probe);

      if (blocker !== null) {
        throw new ConversionFailure(blocker);
      }

      const plan = chooseConversionPlan(probe);
      const outputName = proxyFilename(request.file.name, plan.extension);

      await ensureDir(ffmpeg, OUTPUT_DIR);
      outputPath = `${OUTPUT_DIR}/${outputName}`;

      callbacks.onStage?.('converting');
      const exitCode = await ffmpeg.exec(
        buildProxyArgs(plan, input.path, outputPath, probe, request.fastProxy),
      );

      if (exitCode !== 0) {
        throw new ConversionFailure(lastErrorLine(lines));
      }

      const file = await readProxy(ffmpeg, outputPath, outputName, plan);
      callbacks.onRatio?.(1);

      return { status: 'converted', file, probe, plan };
    } catch (error) {
      if (cancelled) {
        return { status: 'cancelled' };
      }

      const reason =
        error instanceof ConversionFailure
          ? error.message
          : (lastErrorLine(lines) ?? (error instanceof Error ? error.message : null));

      return {
        status: 'error',
        message: conversionErrorMessage(
          request.file.name,
          reason === null ? null : reason.slice(0, 200),
        ),
      };
    } finally {
      ffmpeg.off('log', onLog);
      ffmpeg.off('progress', onProgress);

      // A cancelled worker has already dropped its filesystem, so every release call is
      // allowed to fail there.
      try {
        if (input?.mounted === true) {
          await ffmpeg.unmount(MOUNT_POINT);
        } else if (input !== null) {
          await ffmpeg.deleteFile(input.path);
        }

        if (outputPath !== null) {
          await ffmpeg.deleteFile(outputPath);
        }
      } catch {
        // Nothing to release once the worker is gone.
      }

      if (cancelled) {
        instance = null;
      }

      running = null;
    }
  }

  return {
    convert,
    cancel,
    isBusy: () => running !== null,
    destroy: () => {
      cancel();
      instance?.terminate();
      instance = null;
    },
  };
}

