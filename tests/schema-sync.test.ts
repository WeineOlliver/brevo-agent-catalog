import { readFileSync } from 'node:fs';
import Ajv2020 from 'ajv/dist/2020.js';
import addFormats from 'ajv-formats';
import { describe, expect, it } from 'vitest';
import { generateJsonSchema } from '../src/types.js';
import { validAction } from './fixtures/valid-action.js';

const committed = JSON.parse(readFileSync('schema/action.schema.json', 'utf8')) as object;

describe('schema/action.schema.json', () => {
  it('matches what Zod generates, so the two cannot drift', () => {
    expect(committed).toEqual(generateJsonSchema());
  });

  it('declares JSON Schema draft 2020-12', () => {
    expect(committed).toHaveProperty('$schema', 'https://json-schema.org/draft/2020-12/schema');
  });

  it('is accepted by ajv and validates the representative action', () => {
    const ajv = new Ajv2020({ strict: false });
    addFormats(ajv);
    const validate = ajv.compile(committed);
    expect(validate(validAction)).toBe(true);
  });

  it('rejects a malformed action through ajv, not only through Zod', () => {
    const ajv = new Ajv2020({ strict: false });
    addFormats(ajv);
    const validate = ajv.compile(committed);
    expect(validate({ ...validAction, id: 'Not Snake Case' })).toBe(false);
  });
});
