/**
 * The catalog contract.
 *
 * Zod is the single source of truth; `schema/action.schema.json` is generated
 * from it and the two are held together by tests/schema-sync.test.ts.
 */

import { z } from 'zod';
import { zodToJsonSchema } from 'zod-to-json-schema';

export const VERIFICATION_STATUSES = ['verified', 'observed', 'inferred'] as const;
export type VerificationStatus = (typeof VERIFICATION_STATUSES)[number];

export const PLAN_TIERS = ['free', 'starter', 'business', 'enterprise', 'unknown'] as const;

export const HTTP_METHODS = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'] as const;

/** Holds an arbitrary JSON Schema document; deliberately not modelled further. */
const JsonSchemaDocument = z.record(z.unknown());

const NonEmptyString = z.string().min(1);

const InternalEndpoint = z
  .object({
    method: z.enum(HTTP_METHODS),
    path: NonEmptyString,
    /** Sanitized request body, placeholders substituted. Null for endpoints that take none. */
    body_example: z.string().nullable(),
  })
  .strict();

const PublicApi = z
  .object({
    exists: z.boolean(),
    operationId: z.string().nullable(),
  })
  .strict();

/**
 * Confidence, as a discriminated union rather than a free-standing status plus
 * optional fields: a `verified` entry cannot exist without evidence and a
 * timestamp, and an unverified one cannot carry a timestamp it never earned.
 */
const Verification = z.discriminatedUnion('status', [
  z
    .object({
      status: z.literal('verified'),
      evidence: z.array(NonEmptyString).min(1),
      verified_at: z.string().datetime(),
    })
    .strict(),
  z
    .object({
      status: z.literal('observed'),
      evidence: z.array(NonEmptyString),
      verified_at: z.null(),
    })
    .strict(),
  z
    .object({
      status: z.literal('inferred'),
      evidence: z.array(NonEmptyString),
      verified_at: z.null(),
    })
    .strict(),
]);

export const ActionSchema = z
  .object({
    /** snake_case, `module.verb_object`. */
    id: z.string().regex(/^[a-z][a-z0-9_]*\.[a-z][a-z0-9_]*$/),
    module: NonEmptyString,
    name: NonEmptyString,
    /**
     * Written for an agent: when to call this action, and which neighbouring
     * action to reach for instead.
     */
    description: NonEmptyString,
    preconditions: z.array(NonEmptyString),
    inputs: JsonSchemaDocument,
    outputs: JsonSchemaDocument,
    side_effects: z.array(NonEmptyString),
    /** The harness's signal to gate behind confirmation. Fail-safe when unproven. */
    destructive: z.boolean(),
    /** Whether a retry is safe. Fail-safe when unproven. */
    idempotent: z.boolean(),
    ui_path: z.array(NonEmptyString),
    /** Null for an action observed only in the UI, with no captured request. */
    internal_endpoint: InternalEndpoint.nullable(),
    public_api: PublicApi,
    plan_tier: z.enum(PLAN_TIERS),
    verification: Verification,
  })
  .strict();

export type Action = z.infer<typeof ActionSchema>;

export const SCHEMA_ID = 'https://github.com/brevo-agent-catalog/schema/action.schema.json';
const DRAFT_2020_12 = 'https://json-schema.org/draft/2020-12/schema';

/**
 * Renders the Zod contract as a standalone JSON Schema document.
 *
 * zod-to-json-schema has no 2020-12 target, so the closest one (2019-09) is
 * used and `$schema` is set to 2020-12. The constructs emitted here — objects,
 * arrays, enums, anyOf, format — are identical across the two drafts, and
 * tests/schema-sync.test.ts compiles the result with Ajv's 2020 build, which
 * is what actually proves the claim.
 */
export function generateJsonSchema(): Record<string, unknown> {
  const generated = zodToJsonSchema(ActionSchema, {
    target: 'jsonSchema2019-09',
    $refStrategy: 'none',
  }) as Record<string, unknown>;

  return {
    ...generated,
    $schema: DRAFT_2020_12,
    $id: SCHEMA_ID,
    title: 'Brevo business action',
  };
}
