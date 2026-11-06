/**
 * Stage 1 — capture an authenticated session.
 *
 * Opens a real browser and waits for you to log in by hand. Nothing is
 * automated here on purpose: 2FA, captchas and device checks are the operator's
 * to satisfy, and the saved session is all the rest of the pipeline needs.
 *
 * Waiting is done by watching the page rather than by reading stdin, so this
 * works the same whether it is launched from a terminal or by a tool with no
 * tty. If a terminal is attached, pressing Enter short-circuits the wait.
 *
 * The saved state is a live credential. `.auth/` is gitignored and must stay so.
 */

import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { chromium } from 'playwright';
import 'dotenv/config';
import { loadConfig } from '../src/config.js';

const WAIT_TIMEOUT_MS = 25 * 60 * 1000;
const POLL_INTERVAL_MS = 2000;

/** A sign-in screen, as opposed to the application itself. */
const SIGNIN_PATH = /(?:login|signin|sign-in|password|otp|two-factor|2fa|verify)/i;

const config = loadConfig();
const statePath = join(config.paths.auth, 'state.json');

mkdirSync(config.paths.auth, { recursive: true });

const browser = await chromium.launch({ headless: false });
const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
const page = await context.newPage();

await page.goto(config.appOrigin, { waitUntil: 'domcontentloaded' });

console.log(`
A browser window is open at ${config.appOrigin}.

  1. Log in by hand, including any 2FA step.
  2. Wait until you can see the Brevo dashboard.

This will notice by itself and save the session — you do not have to come back
here. (If you are in a terminal, pressing Enter saves immediately.)
`);

/** Resolves when a terminal is attached and the operator presses Enter. */
function enterPressed(): Promise<'enter'> {
  return new Promise((resolve) => {
    if (process.stdin.isTTY !== true) return;
    process.stdin.once('data', () => resolve('enter'));
    process.stdin.resume();
  });
}

/** Resolves once the browser is sitting on the app rather than a sign-in page. */
async function signedIn(): Promise<'detected' | 'timeout'> {
  const deadline = Date.now() + WAIT_TIMEOUT_MS;

  while (Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL_MS));

    let url: URL;
    try {
      url = new URL(page.url());
    } catch {
      continue;
    }

    const onSignIn = SIGNIN_PATH.test(url.pathname) || SIGNIN_PATH.test(url.hostname);
    if (onSignIn) continue;

    // A session cookie for the app's domain is what the rest of the pipeline
    // actually needs, so require one before claiming success.
    const cookies = await context.cookies();
    if (cookies.length > 0 && url.hostname.endsWith('brevo.com')) return 'detected';
  }

  return 'timeout';
}

const outcome = await Promise.race([signedIn(), enterPressed()]);

if (outcome === 'timeout') {
  console.error(
    `\nStill on a sign-in page after ${WAIT_TIMEOUT_MS / 60000} minutes. Nothing saved.\n` +
      'Run "pnpm brevo:login" again, or export a HAR by hand from DevTools and feed it\n' +
      'through parseHar (src/capture/har.ts) — the rest of the pipeline is unchanged.',
  );
  await browser.close();
  process.exit(1);
}

const url = page.url();
await context.storageState({ path: statePath });
await browser.close();

console.log(`\nsaved session to ${statePath}`);
console.log(`  detected via: ${outcome === 'enter' ? 'Enter pressed' : `logged-in page at ${url}`}`);
console.log('This file is a live credential. It is gitignored — keep it that way.');
