/**
 * Stage 2c — a HAR exported by hand, into the same capture store.
 *
 * `parseHar` has been tested since the first week and nothing ever called it.
 * It is the missing stage, and on this app it is the strongest one available:
 *
 * The write passes drive Brevo's UI with selectors, which works for a dialog
 * with a name field and fails for everything shaped like a wizard — creating a
 * campaign, building a segment, designing a template. Reconnaissance measured
 * that: of six target routes, two were flat forms and four were multi-step
 * flows or dead URLs. Automating those is hours of selector work per flow, and
 * a human does each one in about thirty seconds.
 *
 * So the human performs them, in their own browser, already signed in, and
 * exports the network log. No Playwright, no selectors, no locale, no login
 * timeout. This is the `demonstrate` step of demonstrate-generate-validate,
 * with a person as the demonstrator; the generate and validate stages downstream
 * are unchanged and do not care which stage produced a record.
 *
 * How to produce the input:
 *
 *   1. In Chrome, open DevTools -> Network, tick **Preserve log**.
 *   2. Perform the actions you want catalogued, one after another.
 *   3. Right-click the request list -> **Save all as HAR with content**.
 *   4. `pnpm import:har <file.har>`
 *
 * A HAR holds cookies and `authorization` headers verbatim, so it lands in
 * `captures/raw/` (gitignored) and only reaches `captures/clean/` through
 * `pnpm sanitize`. Run `pnpm scan` before pushing, as with every other stage.
 */

import { existsSync, readFileSync } from 'node:fs';
import { basename, join } from 'node:path';
import 'dotenv/config';
import { loadConfig } from '../src/config.js';
import { parseHar } from '../src/capture/har.js';
import { writeCaptureFile } from '../src/capture/store.js';
import { isWriteTraffic } from '../src/util/hosts.js';

function argValue(name: string): string | null {
  const index = process.argv.indexOf(`--${name}`);
  if (index === -1) return null;
  return process.argv[index + 1] ?? null;
}

const positional = process.argv.slice(2).filter((arg) => !arg.startsWith('--'));
const harPath = positional[0];

if (harPath === undefined) {
  console.error(
    'usage: pnpm import:har <file.har> [--route /a/route]\n\n' +
      'In Chrome: DevTools -> Network -> tick "Preserve log", do the actions,\n' +
      'then right-click the list -> "Save all as HAR with content".',
  );
  process.exit(1);
}

if (!existsSync(harPath)) {
  console.error(`No file at ${harPath}`);
  process.exit(1);
}

const config = loadConfig();

// A route label is optional: `parseHar` reads each entry's own page when the
// HAR records one, which a DevTools export does.
const route = argValue('route') ?? undefined;

let records;
try {
  records = parseHar(readFileSync(harPath, 'utf8'), route);
} catch (error) {
  console.error(`${harPath} is not a HAR this can read: ${String(error).split('\n')[0]}`);
  process.exit(1);
}

if (records.length === 0) {
  console.error(`${harPath} parsed, but held no entries.`);
  process.exit(1);
}

const name = basename(harPath).replace(/\.har$/i, '');
const outPath = join(config.paths.raw, 'har', `${name}.json`);
writeCaptureFile(outPath, records);

// The same predicate the interactive runs report on, so a HAR's usefulness is
// judged by the same measure: Brevo's product surface, writes only.
const writes = records.filter((record) => isWriteTraffic(record.url, record.method));

console.log(`${records.length} record(s) from ${basename(harPath)} -> ${outPath}`);
console.log(`${writes.length} write(s) to Brevo's product surface:`);
for (const record of writes) {
  const path = (() => {
    try {
      return new URL(record.url).pathname;
    } catch {
      return record.url;
    }
  })();
  console.log(`  ${record.method} ${record.status} ${path}`);
}

if (writes.length === 0) {
  console.log(
    '  (none — if you expected writes, check that "Preserve log" was on\n' +
      '   before you started, since a navigation clears the list otherwise)',
  );
}

console.log('\nNext: pnpm sanitize && pnpm extract --provider groq && pnpm normalize');
