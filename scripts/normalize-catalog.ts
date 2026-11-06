/**
 * Normalises the drafted catalog in place: one entry per endpoint, one name per
 * module. Report what changed, then rewrite `actions/`.
 */

import { readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import 'dotenv/config';
import { loadConfig } from '../src/config.js';
import { validateAction } from '../src/catalog/validate.js';
import { normalizeCatalog } from '../src/catalog/normalize.js';
import type { Action } from '../src/types.js';

const config = loadConfig();
const dir = config.paths.actions;
const dryRun = process.argv.includes('--dry-run');

const files = readdirSync(dir).filter((f) => f.endsWith('.json') && f !== 'index.json');
const actions: Action[] = [];

for (const file of files) {
  const result = validateAction(JSON.parse(readFileSync(join(dir, file), 'utf8')));
  if (!result.ok) {
    console.error(`${file} is invalid — run "pnpm validate" first: ${result.errors[0] ?? ''}`);
    process.exit(1);
  }
  actions.push(result.action);
}

const { actions: normalized, merged, renamed } = normalizeCatalog(actions);

console.log(`${actions.length} entr(ies) in -> ${normalized.length} out`);

if (merged.length > 0) {
  console.log(`\nmerged ${merged.length} duplicate endpoint(s):`);
  for (const m of merged) console.log(`  ${m.endpoint}\n    kept ${m.kept}, dropped ${m.dropped}`);
}

if (renamed.length > 0) {
  console.log(`\nrenamed ${renamed.length} id(s) to a canonical module:`);
  for (const r of renamed) console.log(`  ${r.from} -> ${r.to}`);
}

if (merged.length === 0 && renamed.length === 0) console.log('\nnothing to normalise.');

if (dryRun) {
  console.log('\n--dry-run: no files written.');
  process.exit(0);
}

// Rewrite the directory wholesale, so a dropped or renamed entry cannot linger.
for (const file of files) rmSync(join(dir, file));
for (const action of normalized) {
  writeFileSync(join(dir, `${action.id}.json`), `${JSON.stringify(action, null, 2)}\n`, 'utf8');
}

const modules = new Set(normalized.map((a) => a.module));
console.log(`\nwrote ${normalized.length} file(s) across ${modules.size} module(s) -> ${dir}`);
