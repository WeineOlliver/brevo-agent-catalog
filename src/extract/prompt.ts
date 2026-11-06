/**
 * The extraction prompt.
 *
 * Two things make or break this stage. The description must be written as
 * trigger conditions and disambiguation, because that is the single largest
 * lever on an agent picking the right action. And the spec's own types, when
 * one matched, are authoritative over anything inferable from the samples —
 * a captured example shows one valid call, not the contract.
 */

import { PLAN_TIERS } from '../types.js';
import type { CompletionRequest } from '../providers/types.js';
import type { PublicApiOperation } from '../openapi/index.js';
import type { ActionCandidate } from './cluster.js';

const SYSTEM = `You document a web application's business actions for AI agents to act on.

You will be given one HTTP endpoint observed in Brevo's web app, with up to three
sanitized examples, and — when one exists — the matching operation from Brevo's
published OpenAPI specification.

Reply with a single JSON object and nothing else. No prose, no markdown fence.

Fields, all required:

- id: snake_case "module.verb_object", e.g. "contacts.create_contact".
- module: the product area, lower case, e.g. "contacts", "campaigns", "lists".
- name: a short human label, e.g. "Create contact".
- description: WRITTEN FOR AN AGENT. State when to call this action, and name the
  neighbouring action to use instead when it would be the better fit. Begin with
  "Call this when...". Never restate what the HTTP request does.
- preconditions: array of strings. What must already be true for the call to
  succeed, e.g. "The list must already exist." Say nothing you cannot support
  from the evidence. An empty array is better than an invented precondition.
- inputs: a JSON Schema object with "type": "object", "properties", "required".
  Give every property a "description". Use "enum" wherever the set is fixed.
- outputs: a JSON Schema object describing the response.
- side_effects: array of strings. Observable consequences, e.g. "An email is
  sent to every contact on the list."
- destructive: boolean. True if the action deletes, overwrites, sends, or is
  otherwise hard to undo.
- idempotent: boolean. True only if repeating the call is safe.
- ui_path: array of navigation steps a UI-driving agent would follow, e.g.
  ["Contacts", "Add a contact", "Save"].
- plan_tier: one of ${PLAN_TIERS.join(' | ')}. Use "unknown" unless the evidence
  shows which plan reaches it. "unknown" is the honest default.

Rules you must not break:

- FAIL-SAFE FLAGS. Nothing here has been executed and verified. For any method
  other than GET/HEAD/OPTIONS, set destructive: true and idempotent: false. A
  wrong destructive flag is the most expensive error this catalog can carry,
  because a harness uses it to decide whether to stop and ask a human.
- Do not invent fields, endpoints, or limits. Where the OpenAPI operation is
  supplied, its required fields and enums override anything you infer.
- Describe ONE action. If the endpoint plainly serves several, document the
  primary one.`;

function describeOperation(operation: PublicApiOperation | null): string {
  if (operation === null) {
    return `There is no matching public API operation for this endpoint. It exists only in
the web app, so the catalog entry is the only description of it that exists.`;
  }

  const lines = [
    `Matching public API operation (AUTHORITATIVE — prefer this over the samples):`,
    `  operationId: ${operation.operationId ?? '(none declared)'}`,
    `  ${operation.method} ${operation.pathTemplate}`,
  ];

  if (operation.required.length > 0) {
    lines.push(`  required fields: ${operation.required.join(', ')}`);
  }
  for (const [name, values] of Object.entries(operation.enums)) {
    lines.push(`  enum ${name}: ${values.join(' | ')}`);
  }
  if (operation.tags.length > 0) lines.push(`  tags: ${operation.tags.join(', ')}`);

  return lines.join('\n');
}

function describeSamples(candidate: ActionCandidate): string {
  return candidate.samples
    .map((sample, i) => {
      const parts = [
        `Example ${i + 1}: ${sample.method} ${sample.url} -> ${sample.status}`,
        `  seen on app route: ${sample.route}`,
      ];
      if (sample.requestBody !== null) parts.push(`  request body: ${sample.requestBody}`);
      if (sample.responseBody !== null) parts.push(`  response body: ${sample.responseBody}`);
      if (sample.truncated) parts.push(`  (bodies above are truncated)`);
      return parts.join('\n');
    })
    .join('\n\n');
}

export function buildDraftPrompt(
  candidate: ActionCandidate,
  operation: PublicApiOperation | null,
): CompletionRequest {
  return {
    system: SYSTEM,
    user: `Endpoint: ${candidate.method} ${candidate.pathTemplate}
Observed on application route: ${candidate.route}

${describeOperation(operation)}

${describeSamples(candidate)}

Return the JSON object now.`,
    maxTokens: 2048,
  };
}

/** Appends validation failures so a retry can repair its own output. */
export function withRepairFeedback(
  request: CompletionRequest,
  errors: string[],
): CompletionRequest {
  return {
    ...request,
    user: `${request.user}

Your previous answer was rejected by the schema validator:

${errors.map((error) => `  - ${error}`).join('\n')}

Return a corrected JSON object. Fix only what the errors name.`,
  };
}
