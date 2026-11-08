/**
 * Stage 3 — captures/raw -> captures/clean.
 *
 * `captures/raw/` is never committed. `captures/clean/` is, and is what
 * `verification.evidence` points at, so everything here must be publishable.
 *
 * Only Brevo's own traffic crosses over. A fifteen-minute DevTools recording is
 * mostly not Brevo: of 35 035 records in the four HAR sessions, 1 324 were app
 * traffic and 33 711 were analytics, CDN assets and trackers — 2.8 MB against
 * 67.8 MB. Committing all of it would have put 77 MB in a public repository's
 * permanent history, 96% of it traffic this pipeline already discards, since
 * every extraction and coverage measurement runs through `isAppTraffic`.
 *
 * Dropping it before redaction rather than after is deliberate. Third-party
 * requests are the worst PII surface in a capture and the least useful: Brevo's
 * marketing-automation tracker posts the signed-in address to a third party, and
 * the safest thing to do with a record nothing will ever cite is to not write it.
 *
 * No evidence pointer is weakened by this. Every action cites a capture *file*,
 * the record each one derives from is app traffic by construction, and filtering
 * empties no file — measured before the filter was added, not assumed.
 */

import { join } from 'node:path';
import 'dotenv/config';
import { loadConfig } from '../src/config.js';
import { listCaptureFiles, readCaptureFile, writeCaptureFile } from '../src/capture/store.js';
import { redactCapture } from '../src/sanitize/redact.js';
import { scanForLeaks } from '../src/sanitize/scan.js';
import { isAppTraffic } from '../src/util/hosts.js';

const config = loadConfig();
const files = listCaptureFiles(config.paths.raw);

if (files.length === 0) {
  console.log(`no capture files under ${config.paths.raw} — nothing to sanitize`);
  process.exit(0);
}

let records = 0;
let dropped = 0;
let residual = 0;

for (const file of files) {
  const all = readCaptureFile(join(config.paths.raw, file));
  const mine = all.filter((record) => isAppTraffic(record.url));
  dropped += all.length - mine.length;

  const cleaned = mine.map((record) => redactCapture(record, config.redact));

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

console.log(
  `sanitized ${records} record(s) across ${files.length} file(s) -> ${config.paths.clean}`,
);
console.log(`dropped ${dropped} record(s) that were not Brevo's own traffic`);

if (residual > 0) {
  console.error(
    `\n${residual} residual leak(s) remain. The redactor missed a shape; fix src/sanitize/patterns.ts before committing captures/clean.`,
  );
  process.exit(1);
}
