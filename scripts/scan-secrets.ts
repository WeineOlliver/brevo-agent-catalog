/**
 * The gate that stands between this repository and being public.
 *
 * Scans every committed artifact directory for credential shapes and for the
 * capture account's own identifiers. Exits non-zero on any finding.
 */

import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import 'dotenv/config';
import { loadConfig } from '../src/config.js';
import { scanForLeaks } from '../src/sanitize/scan.js';

const config = loadConfig();
const targets = [config.paths.clean, config.paths.actions, config.paths.data, 'schema'];

function filesUnder(dir: string): string[] {
  if (!existsSync(dir)) return [];
  if (!statSync(dir).isDirectory()) return [dir];

  const found: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) found.push(...filesUnder(full));
    else found.push(full);
  }
  return found;
}

let total = 0;

for (const target of targets) {
  for (const file of filesUnder(target)) {
    // The downloaded public OpenAPI spec is Brevo's own document, not ours;
    // it carries example emails and nothing belonging to this account.
    if (file.endsWith('brevo-openapi.yml')) continue;

    const leaks = scanForLeaks(readFileSync(file, 'utf8'), config.redact);
    if (leaks.length === 0) continue;

    total += leaks.length;
    console.error(`${file}:`);
    for (const leak of leaks.slice(0, 5)) {
      console.error(`  ${leak.kind}: ${leak.match.slice(0, 48)}`);
    }
    if (leaks.length > 5) console.error(`  ... and ${leaks.length - 5} more`);
  }
}

if (total > 0) {
  console.error(`\nFAIL: ${total} leak(s) found. Do not push.`);
  process.exit(1);
}

console.log(`scan clean: no credential shapes or account identifiers in ${targets.join(', ')}`);
