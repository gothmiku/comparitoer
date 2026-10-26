import { formatTime } from '../logic/format';
import { formatFps, formatResolution } from '../logic/info';
import type { InfoBarWarning } from '../logic/info';
import type { SlotId } from '../state';

export type { InfoBarWarning, InfoBarWarningKind } from '../logic/info';

/** Per-video facts shown under the stage. */
export interface VideoInfo {
  readonly label: string;
  readonly width: number;
  readonly height: number;
  readonly fps: number | null;
  readonly durationSeconds: number;
}

/** Two info rows (resolution, FPS, duration) plus the warning chip area. */
export interface InfoBar {
  update(slot: SlotId, info: VideoInfo): void;
  /** Replaces the warning chips for the current pair of videos. */
  setWarnings(warnings: readonly InfoBarWarning[]): void;
  destroy(): void;
}

export type InfoBarFactory = (host: HTMLElement) => InfoBar;

interface InfoRow {
  readonly root: HTMLElement;
  readonly name: HTMLSpanElement;
  readonly resolution: HTMLSpanElement;
  readonly fps: HTMLSpanElement;
  readonly duration: HTMLSpanElement;
}

function createValue(title: string): HTMLSpanElement {
  const value = document.createElement('span');
  value.className = 'infobar__value';
  value.title = title;

  return value;
}

function createRow(slot: SlotId): InfoRow {
  const letter = slot.toUpperCase();

  const root = document.createElement('div');
  root.className = 'infobar__row';
  root.dataset.slot = slot;

  const badge = document.createElement('span');
  badge.className = 'infobar__badge';
  badge.textContent = letter;
  badge.setAttribute('aria-hidden', 'true');

  const name = document.createElement('span');
  name.className = 'infobar__name';

  const resolution = createValue('Resolution');
  const fps = createValue('Estimated frame rate');
  const duration = createValue('Duration');

  root.append(badge, name, resolution, fps, duration);

  return { root, name, resolution, fps, duration };
}

/**
 * Resolution, estimated frame rate and duration for each video, plus informational chips.
 * Nothing here is an `aria-live` region: the duration status stays the app's only live
 * region, so a metadata refresh is not read out twice.
 */
export function createInfoBar(host: HTMLElement): InfoBar {
  const bar = document.createElement('div');
  bar.className = 'infobar';

  const rows = document.createElement('div');
  rows.className = 'infobar__rows';

  const rowA = createRow('a');
  const rowB = createRow('b');
  rows.append(rowA.root, rowB.root);

  const warningArea = document.createElement('div');
  warningArea.className = 'infobar__warnings';
  warningArea.hidden = true;

  const chips = document.createElement('ul');
  chips.className = 'infobar__chips';
  chips.setAttribute('aria-label', 'Differences between the two videos');

  const note = document.createElement('p');
  note.className = 'infobar__note';
  note.textContent = 'Informational only: playback is synced by time, not frames.';

  warningArea.append(chips, note);
  bar.append(rows, warningArea);
  host.append(bar);

  const rowsBySlot: Record<SlotId, InfoRow> = { a: rowA, b: rowB };

  return {
    update: (slot, info) => {
      const row = rowsBySlot[slot];
      const name = info.label.length > 0 ? info.label : `Video ${slot.toUpperCase()}`;

      row.name.textContent = name;
      row.name.title = name;

      row.resolution.textContent = formatResolution(info.width, info.height);
      row.fps.textContent = formatFps(info.fps);
      row.duration.textContent = formatTime(info.durationSeconds);

      row.root.setAttribute(
        'aria-label',
        `${slot.toUpperCase()}: ${name}, ${row.resolution.textContent}, ${
          row.fps.textContent
        }, ${row.duration.textContent}`,
      );
    },
    setWarnings: (warnings) => {
      chips.replaceChildren(
        ...warnings.map((warning) => {
          const item = document.createElement('li');
          item.className = `info-chip info-chip--${warning.kind}`;
          item.textContent = warning.message;

          return item;
        }),
      );

      warningArea.hidden = warnings.length === 0;
    },
    destroy: () => {
      bar.remove();
    },
  };
}

