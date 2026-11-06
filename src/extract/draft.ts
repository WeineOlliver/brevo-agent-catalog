/**
 * Drafting a catalog entry.
 *
 * The model is asked only for what cannot be derived — the semantics. Every
 * mechanical field is filled here from evidence: `internal_endpoint` from the
 * capture, `public_api` from the spec match, `verification` from the fact that
 * traffic was observed and nothing was executed.
 *
 * Two invariants hold whatever the model returns:
 *
 * - Nothing leaves this function unless it satisfies ActionSchema.
 * - The fail-safe flags are enforced in code, not merely requested in the
 *   prompt. A model that quietly claims `destructive: false` on a delete is the
 *   most expensive error the catalog can ship.
 */

import { ActionSchema, type Action } from '../types.js';
import { extractJsonObject } from '../providers/json.js';
import type { LlmProvider } from '../providers/types.js';
import type { PublicApiOperation } from '../openapi/index.js';
import type { ActionCandidate } from './cluster.js';
import { buildDraftPrompt, withRepairFeedback } from './prompt.js';

export type DraftResult =
  | { ok: true; action: Action }
  | { ok: false; errors: string[]; raw: string };

/** The fields the model supplies; everything else is derived from evidence. */
const MODEL_FIELDS = [
  'id',
  'module',
  'name',
  'description',
  'preconditions',
  'inputs',
  'outputs',
  'side_effects',
  'destructive',
  'idempotent',
  'ui_path',
  'plan_tier',
] as const;

const READ_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

function pickModelFields(value: unknown): Record<string, unknown> {
  if (value === null || typeof value !== 'object') return {};
  const source = value as Record<string, unknown>;
  const picked: Record<string, unknown> = {};
  for (const field of MODEL_FIELDS) {
    if (field in source) picked[field] = source[field];
  }
  return picked;
}

/**
 * Evidence must be something a reviewer can open. A route label is not, so the
 * capture file is cited whenever provenance is available, and the route label
 * is only a fallback for records that never came off disk.
 */
function evidencePaths(candidate: ActionCandidate): string[] {
  const files = new Set(
    candidate.samples
      .map((sample) => sample.sourceFile)
      .filter((file): file is string => file !== undefined && file.length > 0),
  );
  if (files.size > 0) return [...files];

  const routes = new Set(candidate.samples.map((sample) => sample.route));
  return [...routes].map((route) => `observed on ${route}`);
}

/**
 * Merges the model's semantics with the fields we can state from evidence,
 * then clamps the risk flags.
 */
function assemble(
  modelFields: Record<string, unknown>,
  candidate: ActionCandidate,
  operation: PublicApiOperation | null,
): Record<string, unknown> {
  const sample = candidate.samples[0];
  const isRead = READ_METHODS.has(candidate.method);

  return {
    ...modelFields,
    // Fail-safe: unverified writes are treated as destructive and unsafe to retry.
    destructive: isRead ? modelFields.destructive === true : true,
    idempotent: isRead ? modelFields.idempotent === true : false,
    internal_endpoint:
      sample === undefined
        ? null
        : {
            method: candidate.method,
            path: candidate.pathTemplate,
            body_example: sample.requestBody,
          },
    public_api: {
      exists: operation !== null,
      operationId: operation?.operationId ?? null,
    },
    verification: {
      status: 'observed',
      evidence: evidencePaths(candidate),
      verified_at: null,
    },
  };
}

export async function draftAction(
  candidate: ActionCandidate,
  operation: PublicApiOperation | null,
  provider: LlmProvider,
  attempts = 2,
): Promise<DraftResult> {
  let request = buildDraftPrompt(candidate, operation);
  let errors: string[] = [];
  let raw = '';

  for (let attempt = 0; attempt < attempts; attempt += 1) {
    raw = await provider.complete(request);

    const extracted = extractJsonObject(raw);
    if (!extracted.ok) {
      errors = [extracted.reason];
      request = withRepairFeedback(buildDraftPrompt(candidate, operation), errors);
      continue;
    }

    const assembled = assemble(pickModelFields(extracted.value), candidate, operation);
    const parsed = ActionSchema.safeParse(assembled);

    if (parsed.success) return { ok: true, action: parsed.data };

    errors = parsed.error.issues.map(
      (issue) => `${issue.path.join('.') || '(root)'}: ${issue.message}`,
    );
    request = withRepairFeedback(buildDraftPrompt(candidate, operation), errors);
  }

  return { ok: false, errors, raw };
}
