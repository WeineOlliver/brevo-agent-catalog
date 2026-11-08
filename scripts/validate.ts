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
import { findDanglingRefs, textOf } from '../src/catalog/crossrefs.js';

/**
 * Dangling cross-references the catalog is allowed to carry: none.
 *
 * This started at 42 and is a ratchet -- it may only ever go DOWN, so a defect
 * that has been measured cannot grow back while nobody is looking. It is now at
 * zero, which makes it an ordinary gate rather than a tolerance: any entry that
 * names an action the catalog does not have fails the build.
 *
 * The schema cannot catch these, because an invented id is a well-formed string
 * in a field allowed to hold any text. The cause was the extraction prompt
 * asking each description to name the neighbouring action by id while drafting
 * that entry in isolation, with no way to know which ids exist. Two changes
 * closed it: the prompt now asks for the neighbour by what it does, and
 * `pnpm fix:crossrefs` rewrote the 39 entries already written down.
 */
const KNOWN_DANGLING_CITATIONS = 0;

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

// Cross-references, which the schema cannot see. Reported every run, because a
// description that sends an agent to an id with nothing behind it is a
// Reliability defect whether or not it trips the ratchet.
const texts = files.map((file) => {
  const action = JSON.parse(readFileSync(join(dir, file), 'utf8')) as Record<string, unknown>;
  return { id: String(action.id), module: String(action.module), text: textOf(action) };
});

const dangling = findDanglingRefs(texts);
const citations = [...dangling.values()].reduce((n, from) => n + from.length, 0);

if (dangling.size === 0) {
  console.log('no dangling action cross-references');
} else {
  console.log('');
  console.log(
    `${dangling.size} invented action id(s) cited ${citations} time(s) in descriptions` +
      ' — an agent that follows one finds nothing:',
  );
  const worst = [...dangling].sort((a, b) => b[1].length - a[1].length).slice(0, 10);
  for (const [citation, from] of worst) {
    console.log(`  ${citation}  cited by ${from.length}: ${from.slice(0, 3).join(', ')}`);
  }
  if (dangling.size > 10) console.log(`  … and ${dangling.size - 10} more`);
}

if (citations > KNOWN_DANGLING_CITATIONS) {
  console.error('');
  console.error(
    `FAIL: dangling citations went up, ${KNOWN_DANGLING_CITATIONS} -> ${citations}.` +
      ' Refer to a neighbouring action by what it does, not by an id.',
  );
  process.exit(1);
}

if (citations < KNOWN_DANGLING_CITATIONS) {
  console.log(
    `ratchet: citations are down to ${citations} from ${KNOWN_DANGLING_CITATIONS} —` +
      ' lower KNOWN_DANGLING_CITATIONS in scripts/validate.ts to hold the gain.',
  );
}
