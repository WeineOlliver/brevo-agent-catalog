/**
 * Writes actions/index.json — the one file an agent loads first.
 */

import { existsSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import 'dotenv/config';
import { loadConfig } from '../src/config.js';
import { validateAction } from '../src/catalog/validate.js';
import { buildIndex } from '../src/catalog/index-build.js';
import type { Action } from '../src/types.js';

const config = loadConfig();
const dir = config.paths.actions;

if (!existsSync(dir)) {
  console.error(`No ${dir}/ directory. Run "pnpm extract" first.`);
  process.exit(1);
}

const actions: Action[] = [];

for (const file of readdirSync(dir).filter((f) => f.endsWith('.json') && f !== 'index.json')) {
  const result = validateAction(JSON.parse(readFileSync(join(dir, file), 'utf8')));
  if (!result.ok) {
    console.error(`${file} is invalid — run "pnpm validate" and fix it before indexing.`);
    process.exit(1);
  }
  actions.push(result.action);
}

const index = buildIndex(actions);
writeFileSync(join(dir, 'index.json'), `${JSON.stringify(index, null, 2)}\n`, 'utf8');

console.log(
  `indexed ${index.count} action(s) -> ${join(dir, 'index.json')}\n` +
    `  verified: ${index.by_status.verified}  observed: ${index.by_status.observed}  inferred: ${index.by_status.inferred}`,
);
