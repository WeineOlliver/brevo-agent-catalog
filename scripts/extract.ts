/**
 * Stage 4 — clean captures -> drafted catalog entries.
 *
 * Deterministic where it can be (the OpenAPI join), model-driven only where it
 * must be (semantics). Every draft passes the schema or lands in the failure
 * report; nothing half-valid reaches `actions/`.
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import 'dotenv/config';
import { loadConfig } from '../src/config.js';
import { listCaptureFiles, readCaptureFile } from '../src/capture/store.js';
import { buildPublicApiIndex } from '../src/openapi/index.js';
import { clusterCaptures } from '../src/extract/cluster.js';
import { draftAction } from '../src/extract/draft.js';
import { createProgress } from '../src/util/progress.js';
import { createGroqProvider } from '../src/providers/groq.js';
import { createClaudeCliProvider } from '../src/providers/claude-cli.js';
import { createLimiter } from '../src/util/rate-limit.js';
import type { LlmProvider } from '../src/providers/types.js';

function argValue(name: string, fallback: string): string {
  const index = process.argv.indexOf(`--${name}`);
  return index === -1 ? fallback : (process.argv[index + 1] ?? fallback);
}

const config = loadConfig();
const providerName = argValue('provider', 'groq');
const limit = Number(argValue('limit', '0'));
const force = process.argv.includes('--force');

function selectProvider(): { provider: LlmProvider; intervalMs: number } {
  if (providerName === 'claude') {
    return { provider: createClaudeCliProvider({ bin: config.claudeBin }), intervalMs: 0 };
  }
  if (providerName !== 'groq') {
    console.error(`Unknown provider "${providerName}". Use --provider groq or --provider claude.`);
    process.exit(1);
  }
  if (config.groqApiKey === null) {
    console.error(
      'GROQ_API_KEY is not set. Put it in .env (see .env.example), or run with --provider claude.',
    );
    process.exit(1);
  }
  // Paced for the Groq free tier's per-minute limits.
  return {
    provider: createGroqProvider({ apiKey: config.groqApiKey, model: config.groqModel }),
    intervalMs: 2100,
  };
}

const { provider, intervalMs } = selectProvider();
const limiter = createLimiter(intervalMs);

const specPath = join(config.paths.data, 'brevo-openapi.yml');
if (!existsSync(specPath)) {
  console.error(`No OpenAPI spec at ${specPath}. Run "pnpm fetch:openapi" first.`);
  process.exit(1);
}
const publicApi = buildPublicApiIndex(readFileSync(specPath, 'utf8'));

const captureFiles = listCaptureFiles(config.paths.clean);
if (captureFiles.length === 0) {
  console.error(
    `No clean captures under ${config.paths.clean}. Run "pnpm crawl" then "pnpm sanitize", ` +
      'or import a DevTools HAR through parseHar.',
  );
  process.exit(1);
}

const records = captureFiles.flatMap((file) => readCaptureFile(join(config.paths.clean, file)));
let candidates = clusterCaptures(records);
if (limit > 0) candidates = candidates.slice(0, limit);

console.log(
  `${records.length} record(s) in ${captureFiles.length} file(s) -> ${candidates.length} candidate(s), drafting with ${provider.name}\n`,
);

mkdirSync(config.paths.actions, { recursive: true });

type Failure = { key: string; errors: string[]; raw: string };

const failures: Failure[] = [];
const writtenIds = new Map<string, string>();
let matched = 0;

// One bar instead of a line per candidate: the per-candidate lines said what
// happened but never how much was left, and this stage runs for minutes behind
// a rate limiter. Failures still print, above the bar, because those need reading.
const progress = createProgress(candidates.length);

/** Prints a line above the bar, so a failure is not overwritten by the redraw. */
function note(line: string): void {
  progress.finish(line);
}

for (const candidate of candidates) {
  // Ticked on entry, so every `continue` below is still counted.
  progress.tick(candidate.key);

  const operation = publicApi.lookup(candidate.method, candidate.pathTemplate);
  if (operation !== null) matched += 1;

  let result;
  try {
    result = await limiter(() => draftAction(candidate, operation, provider));
  } catch (error) {
    failures.push({ key: candidate.key, errors: [String(error)], raw: '' });
    note(`  ! ${candidate.key} — provider error`);
    continue;
  }

  if (!result.ok) {
    failures.push({ key: candidate.key, errors: result.errors, raw: result.raw });
    note(`  ! ${candidate.key} — ${result.errors[0] ?? 'rejected'}`);
    continue;
  }

  const existing = writtenIds.get(result.action.id);
  if (existing !== undefined) {
    failures.push({
      key: candidate.key,
      errors: [`id "${result.action.id}" already drafted from ${existing}`],
      raw: '',
    });
    note(`  ! ${candidate.key} — duplicate id ${result.action.id} (from ${existing})`);
    continue;
  }

  // A file already on disk is a collision across runs, and overwriting it would
  // silently discard a verification stamp and its evidence from an earlier pass.
  const outPath = join(config.paths.actions, `${result.action.id}.json`);
  if (existsSync(outPath) && !force) {
    failures.push({
      key: candidate.key,
      errors: [`${outPath} already exists; re-run with --force to overwrite it`],
      raw: '',
    });
    note(`  ! ${candidate.key} — ${result.action.id}.json already exists (use --force)`);
    continue;
  }

  writtenIds.set(result.action.id, candidate.key);
  writeFileSync(
    outPath,
    `${JSON.stringify(result.action, null, 2)}\n`,
    'utf8',
  );
}

progress.finish();

writeFileSync(
  join(config.paths.data, 'extract-failures.json'),
  `${JSON.stringify({ generated_at: new Date().toISOString(), failures }, null, 2)}\n`,
  'utf8',
);

console.log(
  `\ndrafted ${writtenIds.size}/${candidates.length} (${matched} matched a public operation), ` +
    `${failures.length} failure(s) -> ${join(config.paths.data, 'extract-failures.json')}`,
);
