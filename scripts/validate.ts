/**
 * Stage 5 — validate every catalog entry against the committed schema.
 *
 * Exits non-zero on any failure, and names every one. Nothing is silently
 * dropped: an entry that cannot validate is a bug in the extraction prompt,
 * not a file to quietly delete.
 */

import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import 'dotenv/config';
import { loadConfig } from '../src/config.js';
import { validateAction } from '../src/catalog/validate.js';

const config = loadConfig();
const dir = config.paths.actions;

if (!existsSync(dir)) {
  console.error(`No ${dir}/ directory. Run "pnpm extract" first.`);
  process.exit(1);
}

const files = readdirSync(dir).filter((f) => f.endsWith('.json') && f !== 'index.json');

if (files.length === 0) {
  console.error(`No action files in ${dir}/. Run "pnpm extract" first.`);
  process.exit(1);
}

let failed = 0;

for (const file of files) {
  const path = join(dir, file);
  let parsed: unknown;
  try {
    parsed = JSON.parse(readFileSync(path, 'utf8'));
  } catch (error) {
    failed += 1;
    console.error(`${file}: not valid JSON — ${String(error)}`);
    continue;
  }

  const result = validateAction(parsed);
  if (result.ok) {
    // The filename must match the id, or an agent cannot find an entry by id.
    if (`${result.action.id}.json` !== file) {
      failed += 1;
      console.error(`${file}: filename does not match id "${result.action.id}"`);
    }
    continue;
  }

  failed += 1;
  console.error(`${file}:`);
  for (const error of result.errors) console.error(`  ${error}`);
}

if (failed > 0) {
  console.error(`\nFAIL: ${failed} of ${files.length} action file(s) invalid.`);
  process.exit(1);
}

console.log(`${files.length} action file(s) valid against ${'schema/action.schema.json'}`);
