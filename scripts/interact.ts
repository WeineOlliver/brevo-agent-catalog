/**
 * Stage 2b — sanctioned write passes.
 *
 * This is the coverage mechanism, not an extra. The navigation-only crawl
 * produced 118 actions of which exactly one was a write; the business actions
 * the brief asks for only exist in traffic that a form submission causes.
 *
 * Mutation bounds, from the design: create throwaway data and send test mail;
 * delete only fixtures the harness created; never touch anything already in the
 * account. Every fixture is prefixed `catalog-test-`, which is how that line is
 * enforced rather than hoped for. Nothing here deletes.
 *
 * Signs in and works in ONE browser context: Brevo's session does not survive
 * `storageState` (Playwright omits sessionStorage), so a restored session lands
 * back on the login page.
 */

import { join } from 'node:path';
import { chromium } from 'playwright';
import 'dotenv/config';
import { loadConfig } from '../src/config.js';
import { writeCaptureFile } from '../src/capture/store.js';
import { isWriteTraffic } from '../src/util/hosts.js';
import { attachRecorder } from '../src/crawl/recorder.js';
import { waitForSignIn } from '../src/crawl/session.js';
import { createFixtureBag, type InteractionPass } from '../src/interact/types.js';
import { contactsPass, listsPass, segmentsPass } from '../src/interact/contacts.js';
import { campaignsPass, sendersPass, templatesPass } from '../src/interact/campaigns.js';
import {
  HEADED_VIEWPORT,
  describePlacement,
} from '../src/browser/window.js';
import { appContextOptions, appLaunchArgs } from '../src/browser/context.js';

const PASSES: InteractionPass[] = [
  contactsPass,
  listsPass,
  segmentsPass,
  campaignsPass,
  templatesPass,
  sendersPass,
];

function argValue(name: string, fallback: string): string {
  const index = process.argv.indexOf(`--${name}`);
  return index === -1 ? fallback : (process.argv[index + 1] ?? fallback);
}

const config = loadConfig();
const requested = argValue('modules', PASSES.map((p) => p.module).join(','))
  .split(',')
  .map((m) => m.trim())
  .filter((m) => m.length > 0);

const selected = PASSES.filter((pass) => requested.includes(pass.module));
if (selected.length === 0) {
  console.error(`No matching passes. Available: ${PASSES.map((p) => p.module).join(', ')}`);
  process.exit(1);
}

const launchArgs = appLaunchArgs(HEADED_VIEWPORT);
console.log(describePlacement(launchArgs));

const browser = await chromium.launch({ headless: false, args: launchArgs });
const context = await browser.newContext(appContextOptions({ viewport: HEADED_VIEWPORT }));
const page = await context.newPage();

await page.goto(config.appOrigin, { waitUntil: 'domcontentloaded' });
console.log(`
A browser window is open at ${config.appOrigin}.
Log in by hand. The write passes start by themselves in the same session.

They create throwaway records in your account, all named "catalog-test-*".
Nothing is deleted — remove them by hand afterwards.
`);

const signedIn = await waitForSignIn(page, context, {
  timeoutMs: 25 * 60 * 1000,
  pollIntervalMs: 2000,
});

if (signedIn === 'timeout') {
  console.error('\nNo sign-in detected. Nothing done.');
  await browser.close();
  process.exit(1);
}

console.log(`signed in at ${page.url()} — running ${selected.length} write pass(es)\n`);

const fixtures: string[] = [];
let written = 0;
let writes = 0;

for (const pass of selected) {
  const fx = createFixtureBag();
  const recorder = attachRecorder(page, () => `interact:${pass.module}`);

  console.log(`${pass.module}: running`);
  try {
    await pass.run(page, fx);
  } catch (error) {
    console.warn(`  ! ${pass.module}: ${String(error).split('\n')[0]}`);
  }

  const records = await recorder.drain();
  // Brevo's product surface only: a non-GET to Clarity or Amplitude is not a
  // write, and counting one is how two empty runs looked like progress.
  const writeRecords = records.filter((r) => isWriteTraffic(r.url, r.method));

  writeCaptureFile(join(config.paths.raw, 'interact', `${pass.module}.json`), records);
  written += records.length;
  writes += writeRecords.length;
  fixtures.push(...fx.names);

  console.log(
    `  ${records.length} request(s), ${writeRecords.length} write(s)` +
      (fx.names.length > 0 ? `; used ${fx.names.join(', ')}` : ''),
  );
  // What was actually created is on the wire, not in the fixture bag. Printed
  // per pass because it is the only trustworthy success signal a run has.
  for (const record of writeRecords) {
    const path = (() => {
      try {
        return new URL(record.url).pathname;
      } catch {
        return record.url;
      }
    })();
    console.log(`      ${record.method} ${record.status} ${path}`);
  }
}

await browser.close();

console.log(
  `\nrecorded ${written} request(s) including ${writes} write(s) -> ${join(config.paths.raw, 'interact')}`,
);
if (fixtures.length > 0) {
  console.log(
    `\nFixture names used (delete by hand; a name may have been typed into a form that never submitted, so some will not exist):\n  ${fixtures.join('\n  ')}`,
  );
}
console.log('\nNext: pnpm sanitize && pnpm extract --provider groq && pnpm normalize');
