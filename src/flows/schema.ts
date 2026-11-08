/**
 * The flow contract.
 *
 * A catalog of 197 separate actions answers "what can this app do" and says
 * nothing about "in what order". That gap is measurable: two of the selection
 * eval's remaining misses are tasks whose answer takes more than one call, and
 * on both the model reached for the listing action that would have been step
 * one — `campaigns.list_campaigns` when asked to send a campaign, and again
 * when asked for its stats. It was not choosing badly. The catalog had no way
 * to say "this is step 8 of 8".
 *
 * A flow is therefore not a grouping for readability. It is the missing half of
 * the answer, and it is derived rather than written: each one names a capture
 * file and a time window, and its steps are the write calls Brevo's own UI made
 * inside that window, in the order it made them. `pnpm validate` re-derives the
 * steps from the capture and fails if a flow has drifted from its evidence, so
 * a flow cannot become a story someone remembers about the product.
 *
 * Modules are the wrong axis for this. They come from URL prefixes, so sending
 * one campaign crosses `email_campaigns`, `editor-api` and `marketing-campaign`
 * — three modules for one user intent, which is why 62 modules hold 197 actions
 * and 34 of them hold exactly one.
 */

import { z } from 'zod';
import zodToJsonSchema from 'zod-to-json-schema';

const ACTION_ID = /^[a-z0-9_]+\.[a-z0-9_]+$/;

export const FlowStepSchema = z
  .object({
    /** An id that must exist in the catalog. Enforced in validateFlows. */
    action_id: z.string().regex(ACTION_ID),
    /** What this step accomplishes, in the user's terms, not the endpoint's. */
    why: z.string().min(10),
    /**
     * True when the capture shows the UI making this call but the goal is
     * reachable without it — a recipient count, a preview, a test send.
     */
    optional: z.boolean().default(false),
  })
  .strict();

export const FlowSchema = z
  .object({
    id: z.string().regex(/^[a-z0-9_]+$/),
    name: z.string().min(3),
    /** The user intent this flow serves, phrased as a person would ask for it. */
    goal: z.string().min(10),
    /**
     * How an agent decides this flow is the right one. The selection eval
     * showed that an agent's failure mode is picking a plausible neighbour, so
     * a flow has to say what it is *not* for.
     */
    when_to_use: z.string().min(10),
    evidence: z
      .object({
        /** Capture file the steps were derived from, relative to the repo. */
        capture: z.string().min(1),
        /** Inclusive HH:MM:SS window inside that capture. */
        from: z.string().regex(/^\d{2}:\d{2}:\d{2}$/),
        to: z.string().regex(/^\d{2}:\d{2}:\d{2}$/),
      })
      .strict(),
    steps: z.array(FlowStepSchema).min(2),
    /** Anything an agent would get wrong without being told. */
    notes: z.array(z.string()).default([]),
  })
  .strict();

export const FlowIndexSchema = z
  .object({
    generated_at: z.string().min(1),
    count: z.number().int().nonnegative(),
    flows: z.array(FlowSchema),
  })
  .strict();

export type Flow = z.infer<typeof FlowSchema>;
export type FlowStep = z.infer<typeof FlowStepSchema>;
export type FlowIndex = z.infer<typeof FlowIndexSchema>;

export const FLOW_SCHEMA_ID =
  'https://github.com/brevo-agent-catalog/schema/flow.schema.json';
const DRAFT_2020_12 = 'https://json-schema.org/draft/2020-12/schema';

/** Renders the flow contract as a standalone JSON Schema document. */
export function generateFlowJsonSchema(): Record<string, unknown> {
  const generated = zodToJsonSchema(FlowIndexSchema, {
    target: 'jsonSchema2019-09',
    $refStrategy: 'none',
  }) as Record<string, unknown>;

  return {
    ...generated,
    $schema: DRAFT_2020_12,
    $id: FLOW_SCHEMA_ID,
    title: 'Brevo business flows',
  };
}
