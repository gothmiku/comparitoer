import {
  isWelcomeDismissedIn,
  WELCOME_DISMISSED_VALUE,
  WELCOME_STORAGE_KEY,
} from '../logic/welcome';
import type { WelcomeMessage } from '../logic/welcome';

export interface WelcomeOptions {
  readonly message: WelcomeMessage;
}

/**
 * The floating first-visit card. `element` is already detached when the visitor dismissed the
 * card on an earlier visit, so mounting it is always safe.
 */
export interface Welcome {
  readonly element: HTMLElement;
  /** Persists the dismissal and removes the card; a no-op once it is gone. */
  dismiss(): void;
  /** Removes the card and its listeners without touching the stored flag. */
  destroy(): void;
}

let welcomeCounter = 0;

/**
 * Storage access is wrapped because `localStorage` throws when storage is disabled. A blocked
 * store costs the visitor the memory of the dismissal, never the card itself.
 */
function readStorage(): Storage | null {
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

function persistDismissal(storage: Storage | null): void {
  if (storage === null) {
    return;
  }

  try {
    storage.setItem(WELCOME_STORAGE_KEY, WELCOME_DISMISSED_VALUE);
  } catch {
    // Quota or a blocked store: the card still closes for this visit.
  }
}

/**
 * Builds the welcome card and shows it unless this browser dismissed it before.
 *
 * The card is a `note`, not an `alert`: it is informational, it may appear at any time and it
 * must not steal focus or interrupt a screen reader mid-sentence. Escape closes it as well as
 * the button, and only that explicit dismissal is remembered.
 */
export function createWelcome(options: WelcomeOptions): Welcome {
  welcomeCounter += 1;
  const idPrefix = `welcome-${welcomeCounter}`;

  const element = document.createElement('aside');
  element.className = 'welcome';
  element.setAttribute('role', 'note');
  element.setAttribute('aria-labelledby', `${idPrefix}-title`);

  const text = document.createElement('div');
  text.className = 'welcome__text';

  const title = document.createElement('h2');
  title.className = 'welcome__title';
  title.id = `${idPrefix}-title`;
  title.textContent = options.message.title;

  const body = document.createElement('p');
  body.className = 'welcome__body';
  body.textContent = options.message.body;

  const close = document.createElement('button');
  close.className = 'welcome__close';
  close.type = 'button';
  close.textContent = '×';
  close.setAttribute('aria-label', 'Dismiss welcome message');

  text.append(title, body);
  element.append(text, close);

  const storage = readStorage();
  const dismissed = isWelcomeDismissedIn(storage);

  /** False once the card left the document, so a second Escape cannot act on it. */
  let mounted = !dismissed;

  const remove = (): void => {
    document.removeEventListener('keydown', onDocumentKeyDown);
    element.remove();
    mounted = false;
  };

  function onDocumentKeyDown(event: KeyboardEvent): void {
    if (event.key !== 'Escape' || !mounted) {
      return;
    }

    // Escape only closes the card: other listeners keep the key, so an open popover can
    // still close itself in the same press.
    dismiss();
  }

  function dismiss(): void {
    if (!mounted) {
      return;
    }

    persistDismissal(storage);
    remove();
  }

  close.addEventListener('click', dismiss);

  if (mounted) {
    document.addEventListener('keydown', onDocumentKeyDown);
    document.body.append(element);
  }

  return {
    element,
    dismiss,
    destroy: () => {
      close.removeEventListener('click', dismiss);

      if (mounted) {
        remove();
      }
    },
  };
}
