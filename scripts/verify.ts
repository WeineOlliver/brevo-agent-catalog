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

const RECIPES: VerifyRecipe[] = [...contactsRecipes];

function argValue(name: string, fallback: string): string {
  const index = process.argv.indexOf(`--${name}`);
  return index === -1 ? fallback : (process.argv[index + 1] ?? fallback);
}

const config = loadConfig();
const requested = argValue('actions', RECIPES.map((r) => r.actionId).join(','))
  .split(',')
  .map((id) => id.trim())
  .filter((id) => id.length > 0);

const statePath = join(config.paths.auth, 'state.json');
if (!existsSync(statePath)) {
  console.error(`No saved session at ${statePath}. Run "pnpm brevo:login" first.`);
  process.exit(1);
}

const selected = RECIPES.filter((recipe) => requested.includes(recipe.actionId));
if (selected.length === 0) {
  console.error(`No matching recipes. Registered: ${RECIPES.map((r) => r.actionId).join(', ')}`);
  process.exit(1);
}

const browser = await chromium.launch({ headless: false });
const context = await browser.newContext({ storageState: statePath });
const page = await context.newPage();

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
  if (outcome.status === 'verified') outcome.evidence.push(`playwright trace: ${tracePath}`);
  const updated = applyOutcome(loaded.action, outcome);

  const revalidated = validateAction(updated);
  if (!revalidated.ok) {
    console.error(`  ! refusing to write an invalid entry: ${revalidated.errors.join('; ')}`);
    continue;
  }

  writeFileSync(actionPath, `${JSON.stringify(updated, null, 2)}\n`, 'utf8');
  fixtures.push(...fx.created);

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
