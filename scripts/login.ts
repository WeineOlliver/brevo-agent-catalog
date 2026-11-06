/**
 * Stage 1 — capture an authenticated session.
 *
 * Opens a real browser and waits for you to log in by hand. Nothing is
 * automated here on purpose: 2FA, captchas and device checks are the operator's
 * to satisfy, and the saved session is all the rest of the pipeline needs.
 *
 * The saved state is a live credential. `.auth/` is gitignored and must stay so.
 */

import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { createInterface } from 'node:readline/promises';
import { chromium } from 'playwright';
import 'dotenv/config';
import { loadConfig } from '../src/config.js';

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
  3. Come back here and press Enter.
`);

const readline = createInterface({ input: process.stdin, output: process.stdout });
await readline.question('Press Enter once you are logged in... ');
readline.close();

const url = page.url();
await context.storageState({ path: statePath });
await browser.close();

console.log(`saved session to ${statePath} (last page: ${url})`);
console.log('This file is a live credential. It is gitignored — keep it that way.');
