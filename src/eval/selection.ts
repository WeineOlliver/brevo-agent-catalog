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
 * A provider that errors or answers in prose is a scored failure, never a
 * thrown exception — an eval that dies on one bad response measures nothing.
 */

import { extractJsonObject } from '../providers/json.js';
import type { CatalogIndex } from '../catalog/index-build.js';
import type { LlmProvider } from '../providers/types.js';

export type EvalTask = {
  prompt: string;
  expectedActionId: string;
  expectedInputs?: Record<string, unknown>;
};

export type EvalCase = {
  task: EvalTask;
  chosenActionId: string | null;
  correct: boolean;
  /** Null when the task declares no expected inputs. */
  inputsCorrect: boolean | null;
  note?: string;
};

export type EvalReport = {
  total: number;
  correct: number;
  inputsCorrect: number;
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
      note = `provider error: ${String(error)}`;
    }

    const correct = chosenActionId === task.expectedActionId;
    const inputsCorrect =
      task.expectedInputs === undefined
        ? null
        : correct && inputsMatch(task.expectedInputs, actualInputs);

    cases.push({ task, chosenActionId, correct, inputsCorrect, ...(note ? { note } : {}) });
  }

  return {
    total: cases.length,
    correct: cases.filter((c) => c.correct).length,
    inputsCorrect: cases.filter((c) => c.inputsCorrect === true).length,
    cases,
  };
}
