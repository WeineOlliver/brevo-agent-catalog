/**
 * Stage 6 — execute chosen actions for real and stamp their verification.
 *
 * Verification is not only a stamp: it measures the extraction pipeline's error
 * rate. Each run prints what the drafted entry claimed against what actually
 * happened, which is the material for the AI-usage write-up.
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { chromium } from 'playwright';
import 'dotenv/config';
import { loadConfig } from '../src/config.js';
import { validateAction } from '../src/catalog/validate.js';
import { writeCaptureFile } from '../src/capture/store.js';
import { attachRecorder } from '../src/crawl/recorder.js';
import { createFixtureBag } from '../src/interact/types.js';
import { applyOutcome, assessOutcome, type VerifyRecipe } from '../src/verify/harness.js';
import { contactsRecipes } from '../src/verify/recipes/contacts.js';
import { listsRecipes } from '../src/verify/recipes/lists.js';
import {
  HEADED_VIEWPORT,
  describePlacement,
} from '../src/browser/window.js';
import { appContextOptions, appLaunchArgs } from '../src/browser/context.js';
import { waitForSignIn } from '../src/crawl/session.js';

const RECIPES: VerifyRecipe[] = [...contactsRecipes, ...listsRecipes];

function argValue(name: string, fallback: string): string {
  const index = process.argv.indexOf(`--${name}`);
  return index === -1 ? fallback : (process.argv[index + 1] ?? fallback);
}

const config = loadConfig();
const requested = argValue('actions', RECIPES.map((r) => r.actionId).join(','))
  .split(',')
  .map((id) => id.trim())
  .filter((id) => id.length > 0);

/**
 * `--login` signs in inside the context the recipes then run in.
 *
 * The saved-session path below is kept for the case where it works, but it
 * mostly does not, and decision #10 says why: `storageState` carries cookies
 * and localStorage and **not sessionStorage**, so a restored context lands on
 * login.brevo.com. Measured again on 2026-11-08, headed and headless, with a
 * state file twenty minutes old: rejected both times.
 *
 * Without this flag that failure arrives disguised. The first recipe's `goto`
 * lands on the login page and reports "could not load", which reads as a broken
 * selector, and the run ends having learned nothing about the catalog.
 */
const liveLogin = process.argv.includes('--login');

const statePath = join(config.paths.auth, 'state.json');
// `--login` brings its own session, so a missing state file is not its problem.
if (!liveLogin && !existsSync(statePath)) {
  // Not "run pnpm brevo:login": that writes a state file Brevo rejects, which
  // is decision #10 and was measured again today. Sending a newcomer there
  // costs them a login and leaves them exactly where they started.
  console.error(
    `No saved session at ${statePath}, and a saved session mostly does not work\n` +
      'anyway: storageState does not carry sessionStorage (decision #10).' +
      '\n\nRun this instead, and sign in inside the window that opens:\n' +
      '  pnpm verify --login --actions <action id>',
  );
  process.exit(1);
}

const selected = RECIPES.filter((recipe) => requested.includes(recipe.actionId));
if (selected.length === 0) {
  console.error(`No matching recipes. Registered: ${RECIPES.map((r) => r.actionId).join(', ')}`);
  process.exit(1);
}

const launchArgs = appLaunchArgs(HEADED_VIEWPORT);
console.log(describePlacement(launchArgs));

const browser = await chromium.launch({ headless: false, args: launchArgs });
const context = liveLogin
  ? await browser.newContext(appContextOptions({ viewport: HEADED_VIEWPORT }))
  : await browser.newContext(appContextOptions({ storageState: statePath }));
const page = await context.newPage();

if (liveLogin) {
  await page.goto(config.appOrigin, { waitUntil: 'domcontentloaded' });
  console.log(`
A browser window is open at ${config.appOrigin}.
Log in by hand, including any 2FA step. The recipes start by themselves in this
same session the moment the dashboard appears.
`);

  const outcome = await waitForSignIn(page, context, {
    timeoutMs: 25 * 60 * 1000,
    pollIntervalMs: 2000,
  });

  if (outcome === 'timeout') {
    console.error('\nNo sign-in detected. Nothing verified.');
    await browser.close();
    process.exit(1);
  }

  console.log(`signed in at ${page.url()}`);
} else {
  /**
   * Fail here rather than inside a recipe, where a dead session looks like a
   * moved button.
   *
   * The check has to be made against a page that requires authentication and
   * after the redirect has had time to happen. Checking the app origin right
   * after `domcontentloaded` passes with a dead session — the shell loads, the
   * bounce to login.brevo.com arrives a moment later, and the run proceeds to
   * report "could not open the create-list dialog" on a login page. Measured:
   * that is exactly what it did.
   */
  await page.goto(`${config.appOrigin}/contact/list-listing`, {
    waitUntil: 'domcontentloaded',
  });
  await page.waitForTimeout(6000);
  if (/login\.brevo\.com|\/login/.test(page.url())) {
    console.error(
      `\nThe saved session at ${statePath} was not accepted: landed on ${page.url()}.` +
        '\nstorageState does not carry sessionStorage, which is decision #10.\n\n' +
        'Re-run and sign in inside the window that opens:\n' +
        '  pnpm verify --login --actions <action id>',
    );
    await browser.close();
    process.exit(1);
  }
}

mkdirSync('test-results', { recursive: true });

const fixtures: string[] = [];
let verified = 0;
let stayedObserved = 0;

for (const recipe of selected) {
  const actionPath = join(config.paths.actions, `${recipe.actionId}.json`);
  if (!existsSync(actionPath)) {
    console.error(`  ! ${recipe.actionId}: no entry at ${actionPath} — run "pnpm extract" first`);
    continue;
  }

  const loaded = validateAction(JSON.parse(readFileSync(actionPath, 'utf8')));
  if (!loaded.ok) {
    console.error(`  ! ${recipe.actionId}: entry is invalid — ${loaded.errors[0] ?? ''}`);
    continue;
  }

  const fx = createFixtureBag();
  const recorder = attachRecorder(page, () => `verify:${recipe.actionId}`);
  const tracePath = join('test-results', `${recipe.actionId}.trace.zip`);

  console.log(`\n${recipe.actionId}: executing`);
  await context.tracing.start({ screenshots: true, snapshots: true });
  try {
    await recipe.run(page, fx);
  } catch (error) {
    console.warn(`  ! run failed: ${String(error).split('\n')[0]}`);
  }
  await context.tracing.stop({ path: tracePath });

  const observed = await recorder.drain();
  writeCaptureFile(join(config.paths.raw, 'verify', `${recipe.actionId}.json`), observed);

  // Evidence is written into a committed artifact, so it is redacted here —
  // the sanitizer only ever touches captures/.
  const outcome = assessOutcome(loaded.action, observed, config.redact);
  if (outcome.status === 'verified') {
    // Named as local on purpose. `test-results/` is gitignored -- a Playwright
    // trace holds screenshots of a signed-in account -- so a reader who clones
    // this repository cannot open the file. An evidence line that points at
    // something the reader has no way to reach is the same defect as a
    // description citing an action id that does not exist.
    outcome.evidence.push(
      `playwright trace (local, not committed; reproduce with "pnpm verify"): ${tracePath}`,
    );
  }
  const updated = applyOutcome(loaded.action, outcome);

  const revalidated = validateAction(updated);
  if (!revalidated.ok) {
    console.error(`  ! refusing to write an invalid entry: ${revalidated.errors.join('; ')}`);
    continue;
  }

  writeFileSync(actionPath, `${JSON.stringify(updated, null, 2)}\n`, 'utf8');
  fixtures.push(...fx.names);

  if (outcome.status === 'verified') {
    verified += 1;
    console.log(`  ✓ verified — ${outcome.evidence[0] ?? ''}`);
  } else {
    stayedObserved += 1;
    console.log(`  · observed — ${outcome.reason}`);
  }

  // The pipeline's error rate: what the draft claimed against what happened.
  console.log(
    `  draft claimed: ${loaded.action.internal_endpoint?.method ?? '(none)'} ` +
      `${loaded.action.internal_endpoint?.path ?? ''}; requests seen: ${observed.length}`,
  );
}

await browser.close();

console.log(
  `\n${verified} verified, ${stayedObserved} left observed.\n` +
    (fixtures.length > 0
      ? `Fixtures created (delete these by hand; nothing here deletes account data):\n  ${fixtures.join('\n  ')}\n`
      : '') +
    `Run "pnpm sanitize" to publish the verification evidence, then "pnpm build:index".`,
);
