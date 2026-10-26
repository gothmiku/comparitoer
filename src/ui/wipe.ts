import {
  applyWipeKey,
  clampWipePosition,
  positionFromRatio,
  WIPE_DEFAULT_PERCENT,
  WIPE_MAX_PERCENT,
  WIPE_MIN_PERCENT,
} from '../logic/wipe';

/** Vertical divider plus round handle; A shows left of it, B right of it. */
export interface WipeController {
  /** Moves the divider, clamped to 0-100, and updates clip-path and aria-valuenow. */
  setPosition(position: number): void;
  getPosition(): number;
  /** The focusable slider element, so a caller can focus it when needed. */
  readonly element: HTMLElement;
  destroy(): void;
}

export interface WipeOptions {
  /** Stage frame: the wipe is appended here and its box is the drag coordinate space. */
  readonly host: HTMLElement;
  /** Applied to B: `inset(0 0 0 X%)`. */
  readonly clipTarget: HTMLElement;
  /** Initial position in percent; defaults to DEFAULT_WIPE_POSITION. */
  readonly initialPosition?: number;
  /** Fired for pointer drags and keyboard adjustments, not for `setPosition`. */
  onPositionChange?: (position: number) => void;
}

/** Pointer Events + setPointerCapture; role="slider" with arrow/Home/End support. */
export type WipeFactory = (options: WipeOptions) => WipeController;

/**
 * One full-height hit strip centred on the divider: a 2 px line and a round handle.
 * The strip is 44 px wide so touch dragging has a real target; the divider itself is
 * still drawn as a hairline.
 */
export function createWipe(options: WipeOptions): WipeController {
  const strip = document.createElement('div');
  strip.className = 'wipe';
  strip.tabIndex = 0;
  strip.setAttribute('role', 'slider');
  strip.setAttribute('aria-label', 'Wipe divider between video A and video B');
  strip.setAttribute('aria-orientation', 'horizontal');
  strip.setAttribute('aria-valuemin', String(WIPE_MIN_PERCENT));
  strip.setAttribute('aria-valuemax', String(WIPE_MAX_PERCENT));

  const line = document.createElement('span');
  line.className = 'wipe__line';
  line.setAttribute('aria-hidden', 'true');

  const handle = document.createElement('span');
  handle.className = 'wipe__handle';
  handle.setAttribute('aria-hidden', 'true');

  strip.append(line, handle);
  options.host.append(strip);

  let position = clampWipePosition(options.initialPosition ?? WIPE_DEFAULT_PERCENT);
  let activePointerId: number | null = null;

  /** Paints a position without telling the caller; used for external syncing. */
  function paint(next: number): void {
    position = next;
    strip.style.left = `${position}%`;
    options.clipTarget.style.clipPath = `inset(0 0 0 ${position}%)`;

    const announced = String(Math.round(position));
    strip.setAttribute('aria-valuenow', announced);
    strip.setAttribute('aria-valuetext', `${announced} percent`);
  }

  /** Paints a user-initiated position and reports it; identical positions stay silent. */
  function commit(next: number): void {
    const clamped = clampWipePosition(next);

    if (clamped === position) {
      return;
    }

    paint(clamped);
    options.onPositionChange?.(clamped);
  }

  function ratioAt(clientX: number): number {
    const rect = options.host.getBoundingClientRect();

    if (rect.width <= 0) {
      return position / WIPE_MAX_PERCENT;
    }

    return (clientX - rect.left) / rect.width;
  }

  const onPointerDown = (event: PointerEvent): void => {
    // Left button only for a mouse; touch and pen report button 0 as well.
    if (event.pointerType === 'mouse' && event.button !== 0) {
      return;
    }

    event.preventDefault();
    strip.focus();
    activePointerId = event.pointerId;
    strip.setPointerCapture(event.pointerId);
    commit(positionFromRatio(ratioAt(event.clientX)));
  };

  const onPointerMove = (event: PointerEvent): void => {
    if (activePointerId === null || event.pointerId !== activePointerId) {
      return;
    }

    commit(positionFromRatio(ratioAt(event.clientX)));
  };

  const onPointerEnd = (event: PointerEvent): void => {
    if (activePointerId !== event.pointerId) {
      return;
    }

    if (strip.hasPointerCapture(event.pointerId)) {
      strip.releasePointerCapture(event.pointerId);
    }

    activePointerId = null;
  };

  const onLostPointerCapture = (): void => {
    activePointerId = null;
  };

  const onKeyDown = (event: KeyboardEvent): void => {
    const next = applyWipeKey(position, event.key, event.shiftKey);

    if (next === null) {
      return;
    }

    event.preventDefault();
    commit(next);
  };

  strip.addEventListener('pointerdown', onPointerDown);
  strip.addEventListener('pointermove', onPointerMove);
  strip.addEventListener('pointerup', onPointerEnd);
  strip.addEventListener('pointercancel', onPointerEnd);
  strip.addEventListener('lostpointercapture', onLostPointerCapture);
  strip.addEventListener('keydown', onKeyDown);

  paint(position);

  return {
    element: strip,
    setPosition: (next) => {
      paint(clampWipePosition(next));
    },
    getPosition: () => position,
    destroy: () => {
      strip.removeEventListener('pointerdown', onPointerDown);
      strip.removeEventListener('pointermove', onPointerMove);
      strip.removeEventListener('pointerup', onPointerEnd);
      strip.removeEventListener('pointercancel', onPointerEnd);
      strip.removeEventListener('lostpointercapture', onLostPointerCapture);
      strip.removeEventListener('keydown', onKeyDown);
      strip.remove();
    },
  };
}

