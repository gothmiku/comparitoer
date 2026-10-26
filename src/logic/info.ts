/**
 * Facts and warning copy for the per-video info bar. Pure and DOM-free so the chip
 * thresholds and every string the user reads are unit-tested.
 */

import { fpsDiffer } from './fps';

/** Relative aspect-ratio difference above which the info bar shows its chip. */
export const ASPECT_RATIO_WARNING_RATIO = 0.01;

/** Shown in place of a fact the browser has not reported yet. */
export const UNKNOWN_FACT_TEXT = '—';

/** Largest reduced ratio still written as `16:9`; anything bigger uses `1.78:1`. */
const MAX_REDUCED_TERM = 32;

/** The metadata the info bar needs from one video. */
export interface VideoFacts {
  readonly width: number;
  readonly height: number;
  readonly fps: number | null;
}

/** Informational chips only; mismatches never block comparison. */
export type InfoBarWarningKind = 'aspect-ratio' | 'fps' | 'proxy';

export interface InfoBarWarning {
  readonly kind: InfoBarWarningKind;
  readonly message: string;
}

function hasDimensions(width: number, height: number): boolean {
  return Number.isFinite(width) && width > 0 && Number.isFinite(height) && height > 0;
}

function greatestCommonDivisor(a: number, b: number): number {
  let left = Math.abs(a);
  let right = Math.abs(b);

  while (right > 0) {
    const remainder = left % right;
    left = right;
    right = remainder;
  }

  return left === 0 ? 1 : left;
}

/** `1920 × 1080`, or {@link UNKNOWN_FACT_TEXT} while the dimensions are unknown. */
export function formatResolution(width: number, height: number): string {
  if (!hasDimensions(width, height)) {
    return UNKNOWN_FACT_TEXT;
  }

  return `${Math.round(width)} × ${Math.round(height)}`;
}

/**
 * Reduced integer ratio when both terms stay small (`16:9`, `4:3`), otherwise two
 * decimals relative to the width (`1.78:1`) — an odd source size still reads honestly.
 */
export function formatAspectRatio(width: number, height: number): string {
  if (!hasDimensions(width, height)) {
    return UNKNOWN_FACT_TEXT;
  }

  const wholeWidth = Math.round(width);
  const wholeHeight = Math.round(height);
  const divisor = greatestCommonDivisor(wholeWidth, wholeHeight);
  const widthTerm = wholeWidth / divisor;
  const heightTerm = wholeHeight / divisor;

  if (widthTerm <= MAX_REDUCED_TERM && heightTerm <= MAX_REDUCED_TERM) {
    return `${widthTerm}:${heightTerm}`;
  }

  return `${(wholeWidth / wholeHeight).toFixed(2)}:1`;
}

/** `30 fps` / `23.98 fps`, or {@link UNKNOWN_FACT_TEXT} while there is no estimate. */
export function formatFps(fps: number | null): string {
  if (fps === null || !Number.isFinite(fps) || fps <= 0) {
    return UNKNOWN_FACT_TEXT;
  }

  return `${Number(fps.toFixed(2))} fps`;
}

/**
 * Compares aspect ratios relative to the wider one, with the same 1 % idea as the FPS
 * chip: 1920×1080 and 1280×720 are the same picture shape and must not warn, while
 * 1920×1080 and 640×480 must.
 */
export function aspectRatioDiffer(
  widthA: number,
  heightA: number,
  widthB: number,
  heightB: number,
): boolean {
  if (!hasDimensions(widthA, heightA) || !hasDimensions(widthB, heightB)) {
    return false;
  }

  const ratioA = widthA / heightA;
  const ratioB = widthB / heightB;
  const widest = Math.max(ratioA, ratioB);

  return Math.abs(ratioA - ratioB) > widest * ASPECT_RATIO_WARNING_RATIO;
}

/** Chips for the current pair, in a fixed order: aspect ratio first, then frame rate. */
export function infoWarnings(a: VideoFacts, b: VideoFacts): InfoBarWarning[] {
  const warnings: InfoBarWarning[] = [];

  if (aspectRatioDiffer(a.width, a.height, b.width, b.height)) {
    warnings.push({
      kind: 'aspect-ratio',
      message: `Aspect ratios differ: A ${formatAspectRatio(a.width, a.height)}, B ${formatAspectRatio(
        b.width,
        b.height,
      )}.`,
    });
  }

  if (fpsDiffer(a.fps, b.fps)) {
    warnings.push({
      kind: 'fps',
      message: `Frame rates differ: A ${formatFps(a.fps)}, B ${formatFps(b.fps)}.`,
    });
  }

  return warnings;
}
