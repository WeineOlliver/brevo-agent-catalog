/**
 * Stage 3 — captures/raw -> captures/clean.
 *
 * `captures/raw/` is never committed. `captures/clean/` is, and is what
 * `verification.evidence` points at, so everything here must be publishable.
 */

import { join } from 'node:path';
import 'dotenv/config';
import { loadConfig } from '../src/config.js';
import { listCaptureFiles, readCaptureFile, writeCaptureFile } from '../src/capture/store.js';
import { redactCapture } from '../src/sanitize/redact.js';
import { scanForLeaks } from '../src/sanitize/scan.js';

const config = loadConfig();
const files = listCaptureFiles(config.paths.raw);

if (files.length === 0) {
  console.log(`no capture files under ${config.paths.raw} — nothing to sanitize`);
  process.exit(0);
}

let records = 0;
let residual = 0;

for (const file of files) {
  const cleaned = readCaptureFile(join(config.paths.raw, file)).map((record) =>
    redactCapture(record, config.redact),
  );

  const leaks = scanForLeaks(JSON.stringify(cleaned), config.redact);
  if (leaks.length > 0) {
    // Do not write a file we have just proved leaks. The push gate would catch
    // it, but leaving it in the committed tree makes the next clean run lie.
    residual += leaks.length;
    const kinds = [...new Set(leaks.map((l) => l.kind))].join(', ');
    console.error(
      `  ! ${file}: ${leaks.length} residual leak(s) after redaction [${kinds}] — not written`,
    );
    continue;
  }

  writeCaptureFile(join(config.paths.clean, file), cleaned);
  records += cleaned.length;
}

console.log(`sanitized ${records} record(s) across ${files.length} file(s) -> ${config.paths.clean}`);

if (residual > 0) {
  console.error(
    `\n${residual} residual leak(s) remain. The redactor missed a shape; fix src/sanitize/patterns.ts before committing captures/clean.`,
  );
  process.exit(1);
}
