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
 * eval that dies on one bad response measures nothing. But a non-answer has
 * three distinct shapes, and counting them together makes the number lie:
 *
 * - **Prose instead of JSON** is the model answering badly. It is scored, and
 *   it is a real defect in the catalog or the prompt.
 * - **The provider never answering** — quota exhausted, timeout, crash — says
 *   nothing about any description. A run hit a usage limit mid-way and reported
 *   1 of 3 with two "misses" whose token counts were zero; read as a quality
 *   signal, that is noise presented as regression.
 * - **Well-formed JSON carrying `action_id: null`** is the model taking the
 *   escape hatch the prompt offers it: *no action in this catalog does that*.
 *   That is a judgement about coverage, and the loudest signal this eval can
 *   produce — an agent that believes a capability is absent does not attempt it.
 *
 * The third shape was invisible for seven runs. The report stored a null
 * `chosenActionId` for it, and the runner printed `(nothing parseable)`, which
 * is what an extraction failure prints. One label over two causes had it read
 * as harness noise. It is scored as a miss, correctly, and it is now named.
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
  /**
   * The model answered, in valid JSON, that no catalog action fits.
   *
   * A miss like any other, and the most informative kind: the catalog being
   * judged incomplete rather than a description being misread.
   */
  declinedNoAction?: boolean;
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

export type ScoreOptions = {
  /**
   * Whether the rendered catalog marks destructive entries.
   *
   * True in every published run: an agent reading this catalog sees the flag,
   * so the eval scores what an agent would actually read.
   *
   * It is a switch because the flag became a suspect. Of 19 tasks, the 4 whose
   * answer is destructive scored 1, while the other 15 scored 13. If dropping
   * the label recovers those tasks, the label is suppressing selection, and
   * risk has to be carried somewhere an agent does not read as permission
   * withheld. If they stay missed, the model is declining the request itself
   * and no wording fixes that. Either way it is one run — and either cause,
   * guessed, would have been published as fact.
   */
  riskLabels?: boolean;
};

function renderCatalog(index: CatalogIndex, riskLabels: boolean): string {
  return index.actions
    .map(
      (entry) =>
        `- ${entry.id} — ${entry.name}${entry.destructive && riskLabels ? ' [destructive]' : ''}\n  ${entry.description}`,
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
  options: ScoreOptions = {},
): Promise<EvalReport> {
  const riskLabels = options.riskLabels ?? true;
  const catalog = renderCatalog(index, riskLabels);
  const cases: EvalCase[] = [];

  for (const task of tasks) {
    let chosenActionId: string | null = null;
    let actualInputs: Record<string, unknown> = {};
    let note: string | undefined;
    let providerFailed = false;
    let declinedNoAction = false;

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
        else {
          // The prompt offers null for "not in the catalog". Taking that offer
          // is an answer. Conflating it with a parse failure is how it hid:
          // both end up with a null chosenActionId and nothing else recorded.
          declinedNoAction = true;
          note = 'the model answered that no catalog action fits (action_id: null)';
        }
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
      ...(declinedNoAction ? { declinedNoAction: true } : {}),
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
