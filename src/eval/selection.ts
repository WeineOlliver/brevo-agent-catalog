/**
 * The selection eval.
 *
 * This is what turns "agent-consumable" from a claim into a number. Give a
 * model a task phrased the way a person would phrase it, hand it the catalog
 * index, and see whether it reaches the right entry with the right arguments.
 *
 * Every failure here is a Reliability bug in a description, not a curiosity:
 * if a model cannot find the action, an agent in production will not either.
 *
 * A provider that errors or answers in prose is never a thrown exception — an
 * eval that dies on one bad response measures nothing. But those two are not
 * the same failure, and counting them together makes the number lie:
 *
 * - **Prose instead of JSON** is the model answering badly. It is scored, and
 *   it is a real defect in the catalog or the prompt.
 * - **The provider never answering** — quota exhausted, timeout, crash — says
 *   nothing about any description. A run hit a usage limit mid-way and reported
 *   1 of 3 with two "misses" whose token counts were zero; read as a quality
 *   signal, that is noise presented as regression.
 *
 * So provider failures are recorded, excluded from the denominator, and always
 * printed. Excluding them silently would be the worse error of the two.
 */

import { extractJsonObject } from '../providers/json.js';
import type { CatalogIndex } from '../catalog/index-build.js';
import type { LlmProvider } from '../providers/types.js';

export type EvalTask = {
  prompt: string;
  expectedActionId: string;
  expectedInputs?: Record<string, unknown>;
  /**
   * Other ids that answer the prompt just as well.
   *
   * Not a way to soften a miss. It exists because one task genuinely has two
   * answers in the product: Brevo removes a single contact from a list from the
   * contact form, `PATCH /contact/backend/contacts/update` with `unlinkListIds`,
   * and from the listing row, `POST /contact/backend/actions/list` with
   * `action: DELETE_FROM_LIST` and `ids: [3]`. Both are in the capture, both on
   * one contact. Scoring one of them as wrong measures the fixture, not the
   * catalog.
   *
   * The bar for adding an entry here is evidence that the alternative performs
   * the same user action, and every pass through it is printed, so a fixture
   * cannot get quietly generous.
   */
  acceptableActionIds?: string[];
};

export type EvalCase = {
  task: EvalTask;
  chosenActionId: string | null;
  correct: boolean;
  /** Correct, but via `acceptableActionIds` rather than the expected id. */
  viaAlternative?: boolean;
  /** Null when the task declares no expected inputs. */
  inputsCorrect: boolean | null;
  note?: string;
  /** The provider never answered. Not evidence about any description. */
  providerFailed?: boolean;
};

export type EvalReport = {
  total: number;
  /** Tasks the provider actually answered: the denominator that means something. */
  scored: number;
  correct: number;
  inputsCorrect: number;
  /** Tasks excluded because the provider never answered. Always reported. */
  providerFailures: number;
  cases: EvalCase[];
};

const SYSTEM = `You are an AI agent operating the Brevo marketing platform.

You will be given a catalog of actions you can take, and one task from a user.
Choose the single action that accomplishes the task and fill in its inputs.

Reply with one JSON object and nothing else:

  {"action_id": "<id from the catalog>", "inputs": {...}}

Use an action_id exactly as it appears in the catalog. If the task calls for an
action that is not in the catalog, use null for action_id.`;

function renderCatalog(index: CatalogIndex): string {
  return index.actions
    .map(
      (entry) =>
        `- ${entry.id} — ${entry.name}${entry.destructive ? ' [destructive]' : ''}\n  ${entry.description}`,
    )
    .join('\n');
}

/** Subset comparison: extra inputs are fine, the declared ones must match. */
function inputsMatch(
  expected: Record<string, unknown>,
  actual: Record<string, unknown>,
): boolean {
  return Object.entries(expected).every(
    ([key, value]) => JSON.stringify(actual[key]) === JSON.stringify(value),
  );
}

export async function scoreSelection(
  tasks: EvalTask[],
  index: CatalogIndex,
  provider: LlmProvider,
): Promise<EvalReport> {
  const catalog = renderCatalog(index);
  const cases: EvalCase[] = [];

  for (const task of tasks) {
    let chosenActionId: string | null = null;
    let actualInputs: Record<string, unknown> = {};
    let note: string | undefined;
    let providerFailed = false;

    try {
      const raw = await provider.complete({
        system: SYSTEM,
        user: `Catalog:\n${catalog}\n\nTask: ${task.prompt}\n\nReturn the JSON object now.`,
        maxTokens: 512,
      });

      const extracted = extractJsonObject(raw);
      if (extracted.ok) {
        const value = extracted.value as { action_id?: unknown; inputs?: unknown };
        if (typeof value.action_id === 'string') chosenActionId = value.action_id;
        if (value.inputs !== null && typeof value.inputs === 'object') {
          actualInputs = value.inputs as Record<string, unknown>;
        }
      } else {
        note = extracted.reason;
      }
    } catch (error) {
      // Infrastructure, not comprehension: quota, timeout, a crashed CLI.
      providerFailed = true;
      note = `provider never answered: ${String(error).slice(0, 180)}`;
    }

    const exact = chosenActionId === task.expectedActionId;
    const viaAlternative =
      !exact &&
      chosenActionId !== null &&
      (task.acceptableActionIds ?? []).includes(chosenActionId);
    const correct = exact || viaAlternative;
    const inputsCorrect =
      task.expectedInputs === undefined
        ? null
        : correct && inputsMatch(task.expectedInputs, actualInputs);

    cases.push({
      task,
      chosenActionId,
      correct,
      inputsCorrect,
      ...(viaAlternative ? { viaAlternative: true } : {}),
      ...(note ? { note } : {}),
      ...(providerFailed ? { providerFailed: true } : {}),
    });
  }

  const providerFailures = cases.filter((c) => c.providerFailed === true).length;

  return {
    total: cases.length,
    scored: cases.length - providerFailures,
    correct: cases.filter((c) => c.correct).length,
    inputsCorrect: cases.filter((c) => c.inputsCorrect === true).length,
    providerFailures,
    cases,
  };
}
