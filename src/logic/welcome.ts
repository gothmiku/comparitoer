/**
 * First-visit welcome card: the message itself and the "already dismissed" rule.
 *
 * Pure and DOM-free, so the storage contract can be unit-tested. The card is not a cookie
 * banner; it is a one-off note, and only an explicit dismissal is remembered.
 */

/**
 * Storage key holding the dismissal flag.
 *
 * The `.v1` suffix is deliberate: bump it when the message changes enough that returning
 * visitors should see the card once more.
 */
export const WELCOME_STORAGE_KEY = 'comparitoer.welcome.v1';

/** Value written to {@link WELCOME_STORAGE_KEY} when the card is dismissed. */
export const WELCOME_DISMISSED_VALUE = '1';

/** Copy of the welcome card. Edit this object to change what first visitors read. */
export interface WelcomeMessage {
  readonly title: string;
  readonly body: string;
}

/**
 * The message shown once per browser.
 *
 * Kept here rather than in the UI module so the wording can be replaced without touching any
 * markup or styling.
 */
export const WELCOME_MESSAGE: WelcomeMessage = {
  title: 'Welcome to Comparitoer',
  body: 'Drop two videos to check that their durations match, drag the divider to compare them frame by frame, and play both in sync on one timeline. Everything stays on this device.',
};

/** The two members of `Storage` this module needs; keeps the helpers testable outside a browser. */
export interface WelcomeStorage {
  getItem(key: string): string | null;
}

/**
 * True only for the exact dismissal value.
 *
 * Anything else — a missing key, another app's value, a half-written flag — means the card has
 * not been dismissed yet, so a corrupt entry can never hide the message for good.
 */
export function isWelcomeDismissed(stored: string | null): boolean {
  return stored === WELCOME_DISMISSED_VALUE;
}

/**
 * Reads the dismissal flag, treating unreadable storage as "not dismissed".
 *
 * `localStorage` throws when storage is disabled (Safari private mode, blocked cookies), and a
 * first visitor must still see the card in that case.
 */
export function isWelcomeDismissedIn(storage: WelcomeStorage | null): boolean {
  if (storage === null) {
    return false;
  }

  try {
    return isWelcomeDismissed(storage.getItem(WELCOME_STORAGE_KEY));
  } catch {
    return false;
  }
}
