/**
 * Brevo renders its UI in the browser's language, so the locale is part of the
 * harness contract: every selector in `src/interact` matches English
 * accessible names. A context that forgets it gets a Portuguese app on this
 * machine and every pass reports "UI has changed" while doing nothing.
 */

import { describe, expect, it } from 'vitest';
import { APP_LOCALE, appContextOptions, appLaunchArgs } from '../../src/browser/context.js';

describe('appContextOptions', () => {
  it('pins the locale with no options given', () => {
    expect(appContextOptions()).toEqual({ locale: APP_LOCALE });
  });

  it('keeps the caller’s options', () => {
    const options = appContextOptions({ viewport: { width: 1440, height: 900 } });
    expect(options.viewport).toEqual({ width: 1440, height: 900 });
    expect(options.locale).toBe(APP_LOCALE);
  });

  it('pins the locale even when a caller passes its own', () => {
    // The selectors cannot be renegotiated per call site, so this is deliberate.
    expect(appContextOptions({ locale: 'pt-BR' }).locale).toBe(APP_LOCALE);
  });

  it('is English — the language every selector is written in', () => {
    expect(APP_LOCALE).toBe('en-US');
  });
});

describe('appLaunchArgs', () => {
  it('asks Chromium for the same language as the context', () => {
    expect(appLaunchArgs({ width: 800, height: 600 }, {})).toContain(`--lang=${APP_LOCALE}`);
  });

  it('keeps the window placement arguments', () => {
    const args = appLaunchArgs({ width: 800, height: 600 }, { BROWSER_WINDOW: '100,200' });
    expect(args).toContain('--window-position=100,200');
    expect(args).toContain('--window-size=800,600');
  });
});
