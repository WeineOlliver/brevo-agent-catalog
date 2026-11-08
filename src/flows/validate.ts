/**
 * The flow gate.
 *
 * Four things are checked, and the third is the one that matters:
 *
 * 1. The index parses against FlowIndexSchema.
 * 2. Every step names an action the catalog actually has — the same defect
 *    class as the 41 invented cross-references, which a JSON schema cannot see
 *    because an invented id is a well-formed string.
 * 3. **The declared steps match what the capture window yields when re-derived.**
 *    Without this, a flow is a claim about memory. With it, editing
 *    flows/index.json by hand fails the build.
 * 4. The capture file a flow cites exists, so evidence cannot rot silently.
 */

import { deriveFlowSteps, type CaptureRecord, type EndpointRef } from './derive.js';
import { FlowIndexSchema } from './schema.js';

export type FlowValidationInput = {
  raw: unknown;
  actionIds: Set<string>;
  endpoints: EndpointRef[];
  loadCapture: (path: string) => unknown[];
  captureExists: (path: string) => boolean;
};

export function validateFlowIndex(input: FlowValidationInput): string[] {
  const parsed = FlowIndexSchema.safeParse(input.raw);
  if (!parsed.success) {
    return parsed.error.issues.map(
      (issue) => `flows/index.json: ${issue.path.join('.') || '(root)'} — ${issue.message}`,
    );
  }

  const problems: string[] = [];
  const index = parsed.data;

  if (index.count !== index.flows.length) {
    problems.push(`count says ${index.count} but the file holds ${index.flows.length} flow(s)`);
  }

  const seen = new Set<string>();
  for (const flow of index.flows) {
    if (seen.has(flow.id)) problems.push(`${flow.id}: duplicated flow id`);
    seen.add(flow.id);

    for (const step of flow.steps) {
      if (!input.actionIds.has(step.action_id)) {
        problems.push(`${flow.id}: step "${step.action_id}" is not an action in the catalog`);
      }
    }

    if (!input.captureExists(flow.evidence.capture)) {
      problems.push(`${flow.id}: evidence file ${flow.evidence.capture} does not exist`);
      continue;
    }

    if (flow.evidence.to < flow.evidence.from) {
      problems.push(
        `${flow.id}: window ends before it starts (${flow.evidence.from} -> ${flow.evidence.to})`,
      );
      continue;
    }

    const records = input.loadCapture(flow.evidence.capture) as CaptureRecord[];
    const derived = deriveFlowSteps(records, flow.evidence, input.endpoints);

    for (const miss of derived.unmatched) {
      problems.push(
        `${flow.id}: ${miss.method} ${miss.route} is in the window but no catalog entry claims it`,
      );
    }

    const declared = flow.steps.map((step) => step.action_id);
    if (declared.join(' > ') !== derived.actionIds.join(' > ')) {
      problems.push(
        `${flow.id}: steps do not match the capture.\n` +
          `      declared: ${declared.join(' > ') || '(none)'}\n` +
          `      capture:  ${derived.actionIds.join(' > ') || '(none)'}\n` +
          '      Run "pnpm build:flows" rather than editing flows/index.json.',
      );
    }
  }

  return problems;
}
