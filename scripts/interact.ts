/**
 * Stage 2b — sanctioned write passes.
 *
 * Mutation bounds, from the design: the harness may create throwaway data and
 * send test emails; it may delete only fixtures it created itself; it never
 * touches anything that was already in the account. Every fixture is prefixed
 * `catalog-test-`, which is how that line is enforced rather than hoped for.
 */

import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { chromium } from 'playwright';
import 'dotenv/config';
import { loadConfig } from '../src/config.js';
import { writeCaptureFile } from '../src/capture/store.js';
import { attachRecorder } from '../src/crawl/recorder.js';
import { createFixtureBag, type InteractionPass } from '../src/interact/types.js';
import { contactsPass } from '../src/interact/contacts.js';

const PASSES: InteractionPass[] = [contactsPass];

function argValue(name: string, fallback: string): string {
  const index = process.argv.indexOf(`--${name}`);
  return index === -1 ? fallback : (process.argv[index + 1] ?? fallback);
}

const config = loadConfig();
const requested = argValue('modules', PASSES.map((p) => p.module).join(','))
  .split(',')
  .map((m) => m.trim())
  .filter((m) => m.length > 0);

const statePath = join(config.paths.auth, 'state.json');
if (!existsSync(statePath)) {
  console.error(`No saved session at ${statePath}. Run "pnpm brevo:login" first.`);
  process.exit(1);
}

const selected = PASSES.filter((pass) => requested.includes(pass.module));
if (selected.length === 0) {
  console.error(
    `No matching passes. Available: ${PASSES.map((p) => p.module).join(', ')}`,
  );
  process.exit(1);
}

const browser = await chromium.launch({ headless: false });
const context = await browser.newContext({ storageState: statePath });
const page = await context.newPage();

let written = 0;

for (const pass of selected) {
  const fx = createFixtureBag();
  const recorder = attachRecorder(page, () => `interact:${pass.module}`);

  console.log(`\n${pass.module}: running write pass`);
  try {
    await pass.run(page, fx);
  } catch (error) {
    console.warn(`  ! ${pass.module}: ${String(error).split('\n')[0]}`);
  }

  const records = await recorder.drain();
  const writes = records.filter((r) => !['GET', 'HEAD', 'OPTIONS'].includes(r.method));

  writeCaptureFile(join(config.paths.raw, 'interact', `${pass.module}.json`), records);
  written += records.length;

  console.log(
    `  ${records.length} request(s), ${writes.length} write(s); fixtures created: ${fx.created.join(', ') || 'none'}`,
  );
}

await browser.close();

console.log(
  `\nrecorded ${written} request(s) -> ${join(config.paths.raw, 'interact')}\n` +
    'Fixtures left in the account are all prefixed "catalog-test-" and safe to delete.',
);
