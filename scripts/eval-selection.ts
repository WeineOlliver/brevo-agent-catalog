/**
 * Stage 7 — can a model actually find the right action?
 *
 * Reports a score and every failure. Each failure is a description that needs
 * fixing; re-run after fixing and record both numbers in docs/eval.md. The
 * before/after pair is the most informative line in the whole write-up.
 *
 * Defaults to Claude, unlike extraction, which defaults to Groq. Decision #3
 * splits the two providers by job — throughput against judgment — and choosing
 * the right action from a hundred-odd descriptions is the judgment half. It is
 * also twenty calls rather than a hundred and thirty-six, so the cost argument
 * that governs extraction does not apply.
 *
 * The sharper reason is measurement: this stage exists to grade descriptions,
 * and a rate-limited provider contributes failures that say nothing about any
 * description. Those are now excluded from the denominator rather than counted
 * as misses, but the cleanest version of the number comes from a provider that
 * answers every time. `--provider groq` stays available for when quota is out.
 */

import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import 'dotenv/config';
import { loadConfig } from '../src/config.js';
import { scoreSelection, type EvalTask } from '../src/eval/selection.js';
import { createGroqProvider } from '../src/providers/groq.js';
import { createClaudeCliProvider } from '../src/providers/claude-cli.js';
import type { CatalogIndex } from '../src/catalog/index-build.js';
import type { LlmProvider } from '../src/providers/types.js';

function argValue(name: string, fallback: string): string {
  const index = process.argv.indexOf(`--${name}`);
  return index === -1 ? fallback : (process.argv[index + 1] ?? fallback);
}

const config = loadConfig();
const providerName = argValue('provider', 'claude');

const indexPath = join(config.paths.actions, 'index.json');
if (!existsSync(indexPath)) {
  console.error(`No catalog index at ${indexPath}. Run "pnpm build:index" first.`);
  process.exit(1);
}

const index = JSON.parse(readFileSync(indexPath, 'utf8')) as CatalogIndex;
const tasksFile = JSON.parse(
  readFileSync(join(config.paths.data, 'eval-tasks.json'), 'utf8'),
) as { tasks: EvalTask[] };

const knownIds = new Set(index.actions.map((a) => a.id));
const scoreable = tasksFile.tasks.filter((task) => knownIds.has(task.expectedActionId));
const unscoreable = tasksFile.tasks.filter((task) => !knownIds.has(task.expectedActionId));

function selectProvider(): LlmProvider {
  if (providerName === 'claude') return createClaudeCliProvider({ bin: config.claudeBin });
  if (config.groqApiKey === null) {
    console.error('GROQ_API_KEY is not set. Put it in .env, or run with --provider claude.');
    process.exit(1);
  }
  return createGroqProvider({ apiKey: config.groqApiKey, model: config.groqModel });
}

const provider = selectProvider();

if (unscoreable.length > 0) {
  console.log(
    `${unscoreable.length} task(s) expect an action id that is not in the catalog — not scored:\n` +
      unscoreable.map((t) => `  ${t.expectedActionId}  ("${t.prompt}")`).join('\n') +
      '\nEither the catalog is missing that action (a coverage gap worth recording in docs/gaps.md),\n' +
      'or the expected id in data/eval-tasks.json needs correcting to match the real catalog.\n',
  );
}

if (scoreable.length === 0) {
  console.error('No scoreable tasks. Reconcile data/eval-tasks.json against the catalog.');
  process.exit(1);
}

console.log(`scoring ${scoreable.length} task(s) against ${index.count} action(s) with ${provider.name}\n`);

const report = await scoreSelection(scoreable, index, provider);

for (const result of report.cases) {
  if (result.correct && result.inputsCorrect !== false) {
    console.log(`  ✓ ${result.task.expectedActionId}`);
    continue;
  }
  if (result.providerFailed === true) {
    console.log(`  ! "${result.task.prompt}"`);
    console.log(`      ${result.note ?? 'provider never answered'}`);
    console.log('      not scored — this says nothing about the description');
    continue;
  }

  console.log(`  × "${result.task.prompt}"`);
  console.log(`      expected ${result.task.expectedActionId}, chose ${result.chosenActionId ?? '(nothing parseable)'}`);
  if (result.inputsCorrect === false && result.correct) {
    console.log('      right action, wrong inputs');
  }
  if (result.note !== undefined) console.log(`      ${result.note}`);
}

const withInputs = report.cases.filter((c) => c.inputsCorrect !== null).length;

writeFileSync(
  join(config.paths.data, 'eval-report.json'),
  `${JSON.stringify({ generated_at: new Date().toISOString(), provider: provider.name, unscoreable, ...report }, null, 2)}\n`,
  'utf8',
);

console.log(
  `\nselection: ${report.correct}/${report.scored} scored` +
    (withInputs > 0 ? `   inputs: ${report.inputsCorrect}/${withInputs}` : '') +
    (report.providerFailures > 0
      ? `\n${report.providerFailures} task(s) excluded: the provider never answered, which measures nothing about the catalog. Re-run those.`
      : '') +
    `\nEvery miss above is a description an agent could not resolve. Fix the description, re-run, record both numbers.`,
);
