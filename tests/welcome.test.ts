import { describe, expect, it } from 'vitest';

import {
  isWelcomeDismissed,
  isWelcomeDismissedIn,
  WELCOME_DISMISSED_VALUE,
  WELCOME_MESSAGE,
  WELCOME_STORAGE_KEY,
} from '../src/logic/welcome';
import type { WelcomeStorage } from '../src/logic/welcome';

function storageWith(value: string | null): WelcomeStorage {
  return { getItem: () => value };
}

describe('welcome storage key', () => {
  it('namespaces the flag under the app name and version', () => {
    expect(WELCOME_STORAGE_KEY).toBe('comparitoer.welcome.v1');
    expect(WELCOME_DISMISSED_VALUE).toBe('1');
  });
});

describe('isWelcomeDismissed', () => {
  it('is false before anything was stored', () => {
    expect(isWelcomeDismissed(null)).toBe(false);
  });

  it('is true for the dismissal value', () => {
    expect(isWelcomeDismissed('1')).toBe(true);
  });

  it('is false for anything that is not exactly the dismissal value', () => {
    expect(isWelcomeDismissed('')).toBe(false);
    expect(isWelcomeDismissed('0')).toBe(false);
    expect(isWelcomeDismissed('true')).toBe(false);
    expect(isWelcomeDismissed(' false ')).toBe(false);
    expect(isWelcomeDismissed('{"dismissed":true}')).toBe(false);
  });
});

describe('isWelcomeDismissedIn', () => {
  it('is false without a storage object', () => {
    expect(isWelcomeDismissedIn(null)).toBe(false);
  });

  it('follows the stored value', () => {
    expect(isWelcomeDismissedIn(storageWith(null))).toBe(false);
    expect(isWelcomeDismissedIn(storageWith('1'))).toBe(true);
  });

  it('treats storage that throws as not dismissed', () => {
    const blocked: WelcomeStorage = {
      getItem: () => {
        throw new Error('SecurityError');
      },
    };

    expect(isWelcomeDismissedIn(blocked)).toBe(false);
  });
});

describe('WELCOME_MESSAGE', () => {
  it('names the product and explains the local-only promise', () => {
    expect(WELCOME_MESSAGE.title).toContain('Comparitoer');
    expect(WELCOME_MESSAGE.body.length).toBeGreaterThan(40);
    expect(WELCOME_MESSAGE.body).toContain('this device');
  });
});
