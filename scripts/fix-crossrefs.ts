/**
 * Rewrites the prose fields that cite action ids the catalog does not have.
 *
 * The extraction prompt asked each description to name the neighbouring action
 * to use instead, while drafting every candidate in isolation with no list of
 * which ids exist. Guessing was the only behaviour available, and the first
 * full run produced 41 invented ids cited 42 times. An agent that reads
 * "Use `contacts.import_contacts` instead" and looks it up finds nothing.
 *
 * ## Why this is not `pnpm extract --force`
 *
 * A re-draft asks the model for the whole entry, including the id. A model that
 * picks a different id leaves the old file in place beside the new one, so
 * re-drafting 39 entries risks 39 orphan duplicates — and it would overwrite
 * `verification`, which would quietly un-verify an action that had been
 * executed against the live account. Neither is a price worth paying to fix
 * prose.
 *
 * So this is surgical. It replaces three fields and never the object:
 * `description`, `preconditions` and `side_effects`. The id, the module, the
 * endpoint, the risk flags and the verification block cannot change here,
 * because nothing in this file assigns to them.
 *
 * ## What the model gets that it did not have the first time
 *
 * The real ids in the same module, and the instruction that anything outside
 * that set must be described in words rather than named. The original draft
 * failed for lack of this information, not for lack of care, so handing it over
 * is the actual fix; the prompt change in `src/extract/prompt.ts` stops new
 * ones appearing, and this clears the ones already written down.
 *
 * ## What it refuses to do
 *
 * Write a rewrite that still cites something imaginary, or that fails
 * ActionSchema, or that made the count worse. A run that cannot improve an
 * entry leaves it exactly as it was and says so.
 */

import { readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import 'dotenv/config';
import { loadConfig } from '../src/config.js';
import { ActionSchema } from '../src/types.js';
import { validateAction } from '../src/catalog/validate.js';
import { findDanglingRefs, rewriteProse, textOf } from '../src/catalog/crossrefs.js';
import { extractJsonObject } from '../src/providers/json.js';
import { createGroqProvider } from '../src/providers/groq.js';
import { createClaudeCliProvider } from '../src/providers/claude-cli.js';
import type { LlmProvider } from '../src/providers/types.js';
import { createLimiter } from '../src/util/rate-limit.js';
import { withDeadline } from '../src/util/deadline.js';

function argValue(name: string, fallback: string): string {
  const index = process.argv.indexOf(`--${name}`);
  return index === -1 ? fallback : (process.argv[index + 1] ?? fallback);
}

const config = loadConfig();
const dir = config.paths.actions;
const providerName = argValue('provider', 'groq');
const intervalMs = Math.max(0, Number(argValue('interval', '3'))) * 1_000;
const budgetMs = Math.max(1, Number(argValue('candidate-budget', '180'))) * 1_000;
const dryRun = process.argv.includes('--dry-run');
/** Process only the first N entries, so a prompt change can be tried cheaply. */
const limit = Math.max(0, Number(argValue('limit', '0')));

function selectProvider(): LlmProvider {
  if (providerName === 'claude') return createClaudeCliProvider({ bin: config.claudeBin });
  if (providerName !== 'groq') {
    console.error(`Unknown provider "${providerName}". Use --provider groq or --provider claude.`);
    process.exit(1);
  }
  if (config.groqApiKey === null) {
    console.error('GROQ_API_KEY is not set. Put it in .env, or run with --provider claude.');
    process.exit(1);
  }
  return createGroqProvider({ apiKey: config.groqApiKey, model: config.groqModel });
}

type Entry = { file: string; action: Record<string, unknown> };

const files = readdirSync(dir).filter((f) => f.endsWith('.json') && f !== 'index.json');
const entries: Entry[] = files.map((file) => ({
  file,
  action: JSON.parse(readFileSync(join(dir, file), 'utf8')) as Record<string, unknown>,
}));

const asRows = (list: Entry[]): Array<{ id: string; module: string; text: string }> =>
  list.map((e) => ({ id: String(e.action.id), module: String(e.action.module), text: textOf(e.action) }));

const before = findDanglingRefs(asRows(entries));
const citedBy = new Map<string, string[]>();
for (const [citation, from] of before) {
  for (const id of from) {
    const list = citedBy.get(id);
    if (list === undefined) citedBy.set(id, [citation]);
    else list.push(citation);
  }
}

const countCitations = (map: Map<string, string[]>): number =>
  [...map.values()].reduce((n, from) => n + from.length, 0);

console.log(
  `${citedBy.size} entr(ies) cite ${before.size} invented id(s), ${countCitations(before)} citation(s) in all`,
);

if (citedBy.size === 0) {
  console.log('nothing to fix');
  process.exit(0);
}

const realIds = new Set(entries.map((e) => String(e.action.id)));
const byModule = new Map<string, string[]>();
for (const id of realIds) {
  const moduleName = id.split('.')[0] ?? '';
  const list = byModule.get(moduleName);
  if (list === undefined) byModule.set(moduleName, [id]);
  else list.push(id);
}

const SYSTEM =
  'You rewrite the prose of an API action catalog entry. You reply with a single JSON object and nothing else: no prose, no markdown fence.';

function buildPrompt(action: Record<string, unknown>, invented: string[]): string {
  const moduleName = String(action.module);
  const siblings = (byModule.get(moduleName) ?? []).filter((id) => id !== String(action.id));

  return [
    `This entry is \`${String(action.id)}\` in module \`${moduleName}\`.`,
    '',
    'Its prose cites action ids that DO NOT EXIST in the catalog:',
    ...invented.map((id) => `  - ${id}`),
    '',
    'An agent that reads one of those and looks it up finds nothing.',
    '',
    `Real ids in the \`${moduleName}\` module, and the only ones you may name:`,
    ...(siblings.length > 0 ? siblings.map((id) => `  - ${id}`) : ['  (none — this module has one entry)']),
    '',
    'Rewrite the three prose fields so that every cross-reference either names',
    'one of the real ids above, or describes the neighbouring capability in words',
    'instead ("the action that creates a contact"). Prefer words when no real id',
    'fits: a phrase an agent can search the index for beats an id it cannot',
    'resolve. Do not invent an id under any circumstance.',
    '',
    'Keep the meaning, the register and roughly the length. The description must',
    'still begin with "Call this when". Say nothing you cannot support from the',
    'text below — this is a rewrite, not new research.',
    '',
    'Current fields:',
    JSON.stringify(
      {
        description: action.description,
        preconditions: action.preconditions,
        side_effects: action.side_effects,
      },
      null,
      2,
    ),
    '',
    'Reply with exactly: {"description": string, "preconditions": string[], "side_effects": string[]}',
  ].join('\n');
}

const provider = selectProvider();
const limiter = createLimiter(intervalMs);
console.log(`rewriting with ${provider.name}, ${intervalMs / 1000}s apart\n`);

let fixed = 0;
let refused = 0;
let failed = 0;

const queue = [...citedBy].sort();
for (const [id, invented] of limit > 0 ? queue.slice(0, limit) : queue) {
  const entry = entries.find((e) => String(e.action.id) === id);
  if (entry === undefined) continue;

  let error: string | null = null;
  const raw = await withDeadline(
    limiter(() =>
      provider.complete({
        system: SYSTEM,
        user: buildPrompt(entry.action, invented),
        maxTokens: 1600,
      }),
    ),
    budgetMs,
    null,
    () => {
      error = `no answer within ${budgetMs / 1000}s`;
    },
    (thrown) => {
      error = String(thrown).split(/\r?\n/)[0] ?? 'unknown error';
    },
  );

  if (raw === null) {
    failed += 1;
    console.log(`  ! ${id} — ${error ?? 'no answer'}`);
    continue;
  }

  const parsed = extractJsonObject(raw);
  if (!parsed.ok) {
    failed += 1;
    console.log(`  ! ${id} — ${parsed.reason}`);
    continue;
  }

  // Only the three prose fields. Everything else on the entry is out of reach
  // by construction -- `rewriteProse` is where that property lives, and
  // tests/catalog/crossrefs.test.ts is what holds it, because a safety property
  // stated in a comment is one nothing checks.
  const candidate = rewriteProse(entry.action, parsed.value as Record<string, unknown>);

  const schema = ActionSchema.safeParse(candidate);
  if (!schema.success) {
    refused += 1;
    console.log(`  · ${id} — rewrite fails the schema, left as it was`);
    continue;
  }

  // Did it actually stop citing imaginary ids? Checked against the whole
  // catalog, with this entry's new text swapped in, because a citation is only
  // dangling relative to the ids that exist.
  const trial = entries.map((e) =>
    String(e.action.id) === id
      ? { id, module: String(e.action.module), text: textOf(candidate) }
      : { id: String(e.action.id), module: String(e.action.module), text: textOf(e.action) },
  );
  const stillDangling = findDanglingRefs(trial);
  const mine = [...stillDangling].filter(([, from]) => from.includes(id));

  if (mine.length > 0) {
    refused += 1;
    console.log(
      `  · ${id} — still cites ${mine.map(([citation]) => citation).join(', ')}, left as it was`,
    );
    continue;
  }

  if (!dryRun) {
    writeFileSync(join(dir, entry.file), `${JSON.stringify(candidate, null, 2)}\n`, 'utf8');
  }
  entry.action = candidate;
  fixed += 1;
  console.log(`  ✓ ${id} — ${invented.length} citation(s) cleared`);
}

const after = findDanglingRefs(asRows(entries));
console.log(
  `\n${fixed} rewritten, ${refused} refused, ${failed} failed` +
    `${dryRun ? '  (dry run: nothing written)' : ''}`,
);
console.log(
  `citations: ${countCitations(before)} -> ${countCitations(after)}` +
    `  (invented ids: ${before.size} -> ${after.size})`,
);

// A last guard: every file on disk must still validate.
if (!dryRun) {
  let invalid = 0;
  for (const file of files) {
    const result = validateAction(JSON.parse(readFileSync(join(dir, file), 'utf8')));
    if (!result.ok) {
      invalid += 1;
      console.error(`  ! ${file} no longer validates: ${result.errors[0] ?? ''}`);
    }
  }
  if (invalid > 0) process.exit(1);
  console.log(`all ${files.length} entries still validate`);
  console.log('lower KNOWN_DANGLING_CITATIONS in scripts/validate.ts to the new count.');
}
