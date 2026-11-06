/**
 * Waiting for a human to sign in.
 *
 * Saving a session to disk and restoring it into a fresh context does not work
 * against Brevo: `storageState` carries cookies and localStorage but not
 * `sessionStorage`, and a restored context lands straight back on
 * `login.brevo.com`. So the crawl can run in the *same* context the operator
 * signed into, and this is the shared wait both paths use.
 *
 * Typed against the narrowest slice of Playwright needed, so it is tested with
 * a fake rather than a browser.
 */

import { isSignInUrl } from './links.js';

export type SessionPage = { url(): string };
export type SessionContext = { cookies(): Promise<unknown[]> };

export type SignInWaitOptions = {
  timeoutMs: number;
  pollIntervalMs: number;
  /** Injected so tests do not actually wait. */
  sleep?: (ms: number) => Promise<void>;
  now?: () => number;
  onPoll?: (url: string) => void;
};

export type SignInResult = 'detected' | 'timeout';

const defaultSleep = (ms: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Resolves once the page is on the application rather than a sign-in screen and
 * the context holds at least one cookie.
 */
export async function waitForSignIn(
  page: SessionPage,
  context: SessionContext,
  options: SignInWaitOptions,
): Promise<SignInResult> {
  const sleep = options.sleep ?? defaultSleep;
  const now = options.now ?? Date.now;
  const deadline = now() + options.timeoutMs;

  while (now() < deadline) {
    await sleep(options.pollIntervalMs);

    const url = page.url();
    options.onPoll?.(url);

    if (isSignInUrl(url)) continue;

    let host: string;
    try {
      host = new URL(url).hostname;
    } catch {
      continue;
    }
    if (!host.endsWith('brevo.com')) continue;

    const cookies = await context.cookies();
    if (cookies.length > 0) return 'detected';
  }

  return 'timeout';
}
