/**
 * The gate that stands between this repository and being public.
 *
 * Scans **every file git tracks**, not a list of directories. The realistic
 * leak for a project like this is not a capture — the sanitizer handles those —
 * it is a real key pasted into a document, a prompt example or a test while
 * debugging. A directory allowlist is blind to exactly that.
 *
 * Exits non-zero on any finding.
 */

import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, statSync } from 'node:fs';
import 'dotenv/config';
import { loadConfig } from '../src/config.js';
import { scanForLeaks } from '../src/sanitize/scan.js';

const config = loadConfig();

/**
 * Paths exempt for a stated reason, each narrow and deliberate. Every addition
 * here weakens the gate, so each one needs to be defensible out loud.
 */
const EXEMPT: ReadonlyArray<{ pattern: RegExp; why: string }> = [
  {
    pattern: /^data\/brevo-openapi\.yml$/,
    why: "Brevo's own published specification, committed verbatim; carries their example addresses and nothing of ours",
  },
  {
    pattern: /^tests\//,
    why: 'test fixtures contain deliberate credential shapes — that is what they are testing',
  },
  {
    pattern: /^src\/sanitize\/patterns\.ts$/,
    why: 'the pattern definitions themselves, which necessarily look like what they match',
  },
  {
    pattern: /^pnpm-lock\.yaml$/,
    why: 'integrity hashes, machine-generated',
  },
  {
    pattern: /^docs\/superpowers\/plans\//,
    why: 'the implementation plan embeds the test code verbatim, including the deliberate credential shapes tests/ is exempt for',
  },
];

function exemption(path: string): string | null {
  return EXEMPT.find((entry) => entry.pattern.test(path))?.why ?? null;
}

function trackedFiles(): string[] {
  const output = execFileSync('git', ['ls-files', '-z'], { encoding: 'utf8' });
  return output.split('\0').filter((path) => path.length > 0);
}

function isProbablyText(path: string): boolean {
  if (!existsSync(path) || !statSync(path).isFile()) return false;
  const buffer = readFileSync(path);
  // A NUL byte in the first chunk means binary; nothing to scan.
  return !buffer.subarray(0, 4096).includes(0);
}

let total = 0;
let scanned = 0;
let skipped = 0;

for (const path of trackedFiles()) {
  if (exemption(path) !== null) {
    skipped += 1;
    continue;
  }
  if (!isProbablyText(path)) continue;

  scanned += 1;
  const leaks = scanForLeaks(readFileSync(path, 'utf8'), config.redact);
  if (leaks.length === 0) continue;

  total += leaks.length;
  console.error(`${path}:`);
  for (const leak of leaks.slice(0, 5)) {
    console.error(`  ${leak.kind}: ${leak.match.slice(0, 64)}`);
  }
  if (leaks.length > 5) console.error(`  ... and ${leaks.length - 5} more`);
}

if (total > 0) {
  console.error(
    `\nFAIL: ${total} leak(s) found across ${scanned} tracked file(s). Do not push.\n` +
      'If a finding is a deliberate example, redact it — do not add an exemption without a reason\n' +
      'you would defend out loud. A gate with a growing exemption list is a gate nobody reads.',
  );
  process.exit(1);
}

console.log(
  `scan clean: ${scanned} tracked file(s) checked, ${skipped} exempt (see EXEMPT in this script).`,
);
