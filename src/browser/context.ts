/**
 * The browser context every run opens.
 *
 * Brevo renders its UI in the *browser's* language, not the account's: a
 * context that inherits a pt-BR desktop gets a Portuguese app however the
 * account is configured. That is measurable on the public login page —
 * `navigator.language` of `pt-BR` yields "Ao clicar em...", `en-US` yields
 * "By clicking..." for the same markup.
 *
 * Every selector in `src/interact` and `src/verify` matches English accessible
 * names, so the locale is part of the harness contract rather than an operator
 * step: setting it in Brevo's own settings is undone by the next launch, and a
 * pass that opens a second context would revert silently. Pinning it here is
 * the only place that holds for every context, run and screen.
 */

import { HEADED_VIEWPORT, headedLaunchArgs, type WindowSize } from './window.js';

/** The locale the catalog is built against. Selectors assume it. */
export const APP_LOCALE = 'en-US';

/**
 * Context options with the locale pinned.
 *
 * `locale` sets both `Accept-Language` and `navigator.language`, which is why
 * it is preferred over an `extraHTTPHeaders` override: Brevo's front end reads
 * the latter, its back end the former, and they must not disagree.
 */
export function appContextOptions<T extends Record<string, unknown>>(
  extra: T = {} as T,
): T & { locale: string } {
  return { ...extra, locale: APP_LOCALE };
}

/**
 * Launch arguments for a headed run: placement, plus the locale.
 *
 * Chromium's own `--lang` governs the browser chrome and the locale some
 * renderer paths report; the context option governs the page. Both are set so
 * nothing in the stack sees a different language than the selectors expect.
 */
export function appLaunchArgs(
  size: WindowSize = HEADED_VIEWPORT,
  env: NodeJS.ProcessEnv = process.env,
): string[] {
  return [...headedLaunchArgs(size, env), `--lang=${APP_LOCALE}`];
}
