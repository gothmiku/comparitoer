/** Visual tone of the duration status region. */
export type StatusTone = 'neutral' | 'ok' | 'warn' | 'danger';

/** Optional button rendered next to the message ("Compare anyway"). */
export interface StatusAction {
  readonly label: string;
  readonly onClick: () => void;
}

/** Everything the status region renders; produced by the composition root. */
export interface DurationStatusView {
  readonly tone: StatusTone;
  /** Headline text; announced by the live region. */
  readonly message: string;
  /** Secondary line with the numbers; null when there is nothing to add. */
  readonly detail: string | null;
  readonly action: StatusAction | null;
}

export interface DurationStatusOptions {
  readonly host: HTMLElement;
}

/**
 * The app's single `aria-live` region. The action button sits *outside* the live area so
 * announcing a message never reads out the button label as part of the status.
 */
export interface DurationStatus {
  readonly element: HTMLElement;
  render(view: DurationStatusView): void;
  destroy(): void;
}

export function createDurationStatus(options: DurationStatusOptions): DurationStatus {
  const section = document.createElement('section');
  section.className = 'status';
  section.dataset.tone = 'neutral';

  const live = document.createElement('div');
  live.className = 'status__live';
  live.setAttribute('role', 'status');
  live.setAttribute('aria-live', 'polite');
  live.setAttribute('aria-atomic', 'true');

  const message = document.createElement('p');
  message.className = 'status__message';

  const detail = document.createElement('p');
  detail.className = 'status__detail';
  detail.hidden = true;

  live.append(message, detail);

  const actionButton = document.createElement('button');
  actionButton.className = 'status__action';
  actionButton.type = 'button';
  actionButton.hidden = true;

  section.append(live, actionButton);
  options.host.append(section);

  let actionHandler: (() => void) | null = null;
  /** Last rendered signature; an unchanged status must not touch the live region again. */
  let lastSignature: string | null = null;

  const onActionClick = (): void => {
    actionHandler?.();
  };

  actionButton.addEventListener('click', onActionClick);

  return {
    element: section,
    render: (view) => {
      const signature = [
        view.tone,
        view.message,
        view.detail ?? '',
        view.action?.label ?? '',
      ].join('\u0000');

      // `syncStatus()` runs more than once per change (selection, tolerance, swap), and
      // re-writing identical nodes makes a polite live region announce the same text again.
      // Only the handler is refreshed; the DOM is left alone when nothing is new.
      if (signature === lastSignature) {
        actionHandler = view.action?.onClick ?? null;
        return;
      }

      lastSignature = signature;
      section.dataset.tone = view.tone;
      message.textContent = view.message;

      const detailText = view.detail ?? '';
      detail.textContent = detailText;
      detail.hidden = detailText.length === 0;

      actionHandler = view.action?.onClick ?? null;
      actionButton.hidden = view.action === null;
      actionButton.textContent = view.action?.label ?? '';
    },
    destroy: () => {
      actionButton.removeEventListener('click', onActionClick);
      section.remove();
    },
  };
}
