import { VIDEO_ACCEPT_ATTRIBUTE } from '../logic/file';
import type { SlotConversion, SlotId } from '../state';

export { VIDEO_ACCEPT_ATTRIBUTE } from '../logic/file';

/** The user dropped or picked a file; the composition root validates and wires it up. */
export type FileSelectedHandler = (slot: SlotId, file: File) => void;

/** Where the zone is in the load lifecycle; mirrors `VideoSlot['status']`. */
export type DropzoneState = 'empty' | 'loading' | 'ready' | 'error';

/** Everything a zone renders. Produced by the composition root from `AppState`. */
export interface DropzoneView {
  readonly state: DropzoneState;
  /** Full file name to show; null while the slot has no file. */
  readonly filename: string | null;
  /** Inline error text; null when there is nothing to report. */
  readonly error: string | null;
  /** Progress of a local conversion for this slot; null when none is running. */
  readonly conversion: SlotConversion | null;
}

export interface DropzoneOptions {
  readonly host: HTMLElement;
  readonly slot: SlotId;
  /** Primary text while the slot is empty, e.g. "Drop video A here". */
  readonly prompt: string;
  /** Zone name used in the loading text, e.g. "Video A". */
  readonly slotLabel: string;
  onFileSelected: FileSelectedHandler;
}

/**
 * One drop zone: click, keyboard activation and drag-and-drop, all pointing at the same
 * input. Stays usable in every state, so a file can always be replaced.
 */
export interface Dropzone {
  readonly element: HTMLElement;
  readonly input: HTMLInputElement;
  render(view: DropzoneView): void;
  /** Inline error line inside the zone; empty string clears it. */
  setError(message: string): void;
  destroy(): void;
}

let dropzoneCounter = 0;

function fileFrom(dataTransfer: DataTransfer | null): File | null {
  return dataTransfer?.files[0] ?? null;
}

function hasFileDrag(dataTransfer: DataTransfer | null): boolean {
  return dataTransfer !== null && Array.from(dataTransfer.types).includes('Files');
}

export function createDropzone(options: DropzoneOptions): Dropzone {
  dropzoneCounter += 1;
  const idPrefix = `dropzone-${dropzoneCounter}-${options.slot}`;

  const section = document.createElement('section');
  section.className = 'dropzone';
  section.dataset.slot = options.slot;

  const input = document.createElement('input');
  input.className = 'dropzone__input';
  input.type = 'file';
  input.accept = VIDEO_ACCEPT_ATTRIBUTE;
  input.id = `${idPrefix}-input`;
  input.hidden = true;

  const button = document.createElement('button');
  button.className = 'dropzone__button';
  button.type = 'button';
  button.setAttribute('aria-describedby', `${idPrefix}-hint ${idPrefix}-error`);

  const slotName = document.createElement('span');
  slotName.className = 'dropzone__slot';
  slotName.textContent = options.slotLabel;

  const primary = document.createElement('span');
  primary.className = 'dropzone__primary';

  const hint = document.createElement('span');
  hint.className = 'dropzone__hint';
  hint.id = `${idPrefix}-hint`;

  const errorLine = document.createElement('p');
  errorLine.className = 'dropzone__error';
  errorLine.id = `${idPrefix}-error`;
  errorLine.hidden = true;

  button.append(slotName, primary, hint);
  section.append(input, button, errorLine);
  options.host.append(section);

  let dragDepth = 0;

  const setDragging = (dragging: boolean): void => {
    section.classList.toggle('dropzone--dragging', dragging);
  };

  const openPicker = (): void => {
    input.click();
  };

  const onInputChange = (): void => {
    const file = input.files?.[0] ?? null;
    // Reset immediately so picking the same file again still fires `change`.
    input.value = '';

    if (file !== null) {
      options.onFileSelected(options.slot, file);
    }
  };

  const onDragEnter = (event: DragEvent): void => {
    if (!hasFileDrag(event.dataTransfer)) {
      return;
    }

    event.preventDefault();
    dragDepth += 1;
    setDragging(true);
  };

  const onDragOver = (event: DragEvent): void => {
    // Safari exposes `types` reliably on `dragenter` but not always on `dragover`, so an
    // already-entered file drag stays droppable even when the type list is empty here.
    if (!hasFileDrag(event.dataTransfer) && dragDepth === 0) {
      return;
    }

    event.preventDefault();

    if (event.dataTransfer !== null) {
      event.dataTransfer.dropEffect = 'copy';
    }
  };

  const onDragLeave = (): void => {
    dragDepth = Math.max(0, dragDepth - 1);

    if (dragDepth === 0) {
      setDragging(false);
    }
  };

  const onDrop = (event: DragEvent): void => {
    event.preventDefault();
    dragDepth = 0;
    setDragging(false);

    const file = fileFrom(event.dataTransfer);

    if (file !== null) {
      options.onFileSelected(options.slot, file);
    }
  };

  button.addEventListener('click', openPicker);
  input.addEventListener('change', onInputChange);
  section.addEventListener('dragenter', onDragEnter);
  section.addEventListener('dragover', onDragOver);
  section.addEventListener('dragleave', onDragLeave);
  section.addEventListener('drop', onDrop);

  const setError = (message: string): void => {
    const text = message.trim();
    errorLine.textContent = text;
    errorLine.hidden = text.length === 0;
    button.setAttribute('aria-invalid', text.length === 0 ? 'false' : 'true');
  };

  /** Text that explains the running conversion, with the percentage when it is measurable. */
  const conversionText = (conversion: SlotConversion): string => {
    switch (conversion.stage) {
      case 'loading':
        return 'Loading the local converter…';
      case 'probing':
        return 'Reading the file…';
      case 'converting': {
        if (conversion.ratio === null) {
          return 'Converting locally…';
        }

        const percent = Math.min(100, Math.max(0, Math.round(conversion.ratio * 100)));

        return `Converting locally… ${percent} %`;
      }
    }
  };

  const render = (view: DropzoneView): void => {
    const converting = view.conversion !== null;

    // A conversion is a busy state even while the slot's own status is still `error`.
    section.dataset.state = converting ? 'loading' : view.state;
    section.classList.toggle('dropzone--converting', converting);
    button.setAttribute(
      'aria-busy',
      converting || view.state === 'loading' ? 'true' : 'false',
    );

    const filename = view.filename ?? '';
    const hasFilename = filename.length > 0;

    if (view.conversion !== null) {
      primary.textContent = hasFilename ? filename : options.prompt;
      hint.textContent = conversionText(view.conversion);
    } else {
      switch (view.state) {
        case 'empty':
          primary.textContent = options.prompt;
          hint.textContent = 'or click to choose a file';
          break;
        case 'loading':
          primary.textContent = `Reading ${options.slotLabel}…`;
          hint.textContent = hasFilename ? filename : 'This only takes a moment';
          break;
        case 'ready':
          primary.textContent = hasFilename ? filename : options.prompt;
          hint.textContent = 'Click or drop to replace';
          break;
        case 'error':
          primary.textContent = hasFilename ? filename : options.prompt;
          hint.textContent = 'Click or drop to try another file';
          break;
      }
    }

    if (hasFilename) {
      primary.title = filename;
    } else {
      primary.removeAttribute('title');
    }

    setError(view.error ?? '');
  };

  render({ state: 'empty', filename: null, error: null, conversion: null });

  return {
    element: section,
    input,
    render,
    setError,
    destroy: () => {
      button.removeEventListener('click', openPicker);
      input.removeEventListener('change', onInputChange);
      section.removeEventListener('dragenter', onDragEnter);
      section.removeEventListener('dragover', onDragOver);
      section.removeEventListener('dragleave', onDragLeave);
      section.removeEventListener('drop', onDrop);
      section.remove();
    },
  };
}

