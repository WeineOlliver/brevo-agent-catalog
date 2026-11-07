/**
 * Stage 4 — clean captures -> drafted catalog entries.
 *
 * Deterministic where it can be (the OpenAPI join), model-driven only where it
 * must be (semantics). Every draft passes the schema or lands in the failure
 * report; nothing half-valid reaches `actions/`.
 */

import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
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
import { createBreaker } from '../src/util/circuit.js';
import { withDeadline } from '../src/util/deadline.js';
import type { LlmProvider } from '../src/providers/types.js';

function argValue(name: string, fallback: string): string {
  const index = process.argv.indexOf(`--${name}`);
  return index === -1 ? fallback : (process.argv[index + 1] ?? fallback);
}

/**
 * Three bounds, because one is never enough for a loop over a rate-limited
 * provider. The adapter already caps a single HTTP attempt; these cap the rest:
 *
 * - `CANDIDATE_BUDGET_MS` caps one candidate. Five retries honouring a
 *   `Retry-After` of a minute is five minutes on one entry, with nothing
 *   technically hung.
 * - `--budget` caps the whole stage. A free-tier run that would take hours
 *   stops and says what is left, instead of being discovered hours later.
 * - `--break-after` stops a run whose provider has stopped answering at all.
 *   Grinding through 130 more candidates to relearn that is pure waste.
 *
 * Defaults are generous: they exist to make the worst case finite, not to cut
 * a working run short. Nothing here changes what gets drafted.
 */
const CANDIDATE_BUDGET_MS = 150_000;

const config = loadConfig();
const providerName = argValue('provider', 'groq');
const stageBudgetMs = Math.max(1, Number(argValue('budget', '25'))) * 60_000;
const breakAfter = Math.max(1, Math.trunc(Number(argValue('break-after', '6'))));
const limit = Number(argValue('limit', '0'));
const force = process.argv.includes('--force');

function selectProvider(): { provider: LlmProvider; intervalMs: number } {
  if (providerName === 'claude') {
    return {
      provider: createClaudeCliProvider({ bin: config.claudeBin }),
      intervalMs: 0,
    };
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
    provider: createGroqProvider({
      apiKey: config.groqApiKey,
      model: config.groqModel,
    }),
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

/**
 * Endpoints already drafted, read off the catalog on disk.
 *
 * The id is the model's to choose, so the output path is unknown until after
 * the draft — which is why the collision check further down happens late. That
 * cost a provider call for every entry that already existed: a re-run over 136
 * candidates made 136 calls to write 18 files, and the other 118 drafts went
 * straight in the bin. Each action records its own endpoint, and that is
 * exactly the candidate key, so the skip can happen before the call instead.
 *
 * The late check stays: this is a fast path, not a correctness guarantee, and
 * a model that picks a different id for a new endpoint must still not clobber
 * an existing file.
 */
function draftedEndpoints(): Set<string> {
  const keys = new Set<string>();
  for (const file of readdirSync(config.paths.actions)) {
    if (!file.endsWith('.json') || file === 'index.json') continue;
    try {
      const action = JSON.parse(readFileSync(join(config.paths.actions, file), 'utf8'));
      const endpoint = action?.internal_endpoint;
      if (endpoint?.method && endpoint?.path) keys.add(`${endpoint.method} ${endpoint.path}`);
    } catch {
      // An unreadable or half-written file is not evidence of anything; the
      // late check will catch the collision if there is one.
      continue;
    }
  }
  return keys;
}

const alreadyDrafted = force ? new Set<string>() : draftedEndpoints();
let skipped = 0;

const breaker = createBreaker(breakAfter);
const startedAt = Date.now();
let stoppedEarly: string | null = null;
let remaining = 0;

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

  // Already in the catalog: no provider call, no failure record. This is a
  // re-run of an endpoint we have, not a problem worth reporting.
  if (alreadyDrafted.has(candidate.key)) {
    skipped += 1;
    continue;
  }

  if (stoppedEarly !== null) {
    remaining += 1;
    continue;
  }

  if (Date.now() - startedAt > stageBudgetMs) {
    stoppedEarly = `the ${stageBudgetMs / 60_000}m stage budget ran out (raise it with --budget)`;
    remaining += 1;
    continue;
  }

  const operation = publicApi.lookup(candidate.method, candidate.pathTemplate);
  if (operation !== null) matched += 1;

  // `withDeadline` does not cancel the work it gives up on — the adapter's own
  // per-attempt signal ends the request. This bounds the wait, not the socket.
  const result = await withDeadline(
    limiter(() => draftAction(candidate, operation, provider)),
    CANDIDATE_BUDGET_MS,
    null,
    () => note(`  ! ${candidate.key} — gave up after ${CANDIDATE_BUDGET_MS / 1000}s`),
  );

  if (result === null) {
    failures.push({
      key: candidate.key,
      errors: [`no draft within ${CANDIDATE_BUDGET_MS / 1000}s, or the provider failed`],
      raw: '',
    });
    if (breaker.fail()) {
      stoppedEarly = `${breaker.consecutive} candidates in a row failed — the provider is not answering (raise the threshold with --break-after)`;
    }
    continue;
  }

  if (!result.ok) {
    failures.push({
      key: candidate.key,
      errors: result.errors,
      raw: result.raw,
    });
    note(`  ! ${candidate.key} — ${result.errors[0] ?? 'rejected'}`);
    if (breaker.fail()) {
      stoppedEarly = `${breaker.consecutive} candidates in a row failed — the provider is not answering (raise the threshold with --break-after)`;
    }
    continue;
  }

  // A draft that passed the schema proves the provider is answering.
  breaker.succeed();

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
  writeFileSync(outPath, `${JSON.stringify(result.action, null, 2)}\n`, 'utf8');
}

progress.finish();

writeFileSync(
  join(config.paths.data, 'extract-failures.json'),
  `${JSON.stringify({ generated_at: new Date().toISOString(), failures }, null, 2)}\n`,
  'utf8',
);

if (stoppedEarly !== null) {
  console.log(
    `\nstopped early: ${stoppedEarly}` +
      `\n${remaining} candidate(s) left undrafted. Re-running continues where this` +
      ` left off: endpoints already in the catalog are skipped without a provider call.`,
  );
}

if (skipped > 0) {
  console.log(`skipped ${skipped} candidate(s) already in the catalog — no provider call made`);
}

console.log(
  `\ndrafted ${writtenIds.size}/${candidates.length} (${matched} matched a public operation), ` +
    `${failures.length} failure(s) -> ${join(config.paths.data, 'extract-failures.json')}`,
);
