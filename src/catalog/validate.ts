/**
 * The hard gate.
 *
 * Validates against the *committed* JSON Schema rather than the Zod source, so
 * what is checked is the artifact a consumer would check against. A draft that
 * does not validate never reaches `actions/`.
 */

import { readFileSync } from 'node:fs';
import Ajv2020, { type ValidateFunction } from 'ajv/dist/2020.js';
import addFormats from 'ajv-formats';
import type { Action } from '../types.js';

export type ValidationResult =
  | { ok: true; action: Action }
  | { ok: false; errors: string[] };

const SCHEMA_PATH = 'schema/action.schema.json';

let compiled: ValidateFunction | null = null;

function validator(): ValidateFunction {
  if (compiled !== null) return compiled;
  const schema = JSON.parse(readFileSync(SCHEMA_PATH, 'utf8')) as object;
  const ajv = new Ajv2020({ strict: false, allErrors: true });
  addFormats(ajv);
  compiled = ajv.compile(schema);
  return compiled;
}

export function validateAction(value: unknown): ValidationResult {
  const validate = validator();

  if (validate(value)) return { ok: true, action: value as Action };

  const errors = (validate.errors ?? []).map(
    (error) => `${error.instancePath || '(root)'}: ${error.message ?? 'invalid'}`,
  );

  return { ok: false, errors: errors.length > 0 ? errors : ['failed schema validation'] };
}
