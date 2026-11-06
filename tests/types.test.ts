import { describe, expect, it } from 'vitest';
import { ActionSchema } from '../src/types.js';
import { validAction } from './fixtures/valid-action.js';

const valid: Record<string, unknown> = { ...validAction };

describe('ActionSchema', () => {
  it('accepts the representative valid action', () => {
    expect(ActionSchema.safeParse(valid).success).toBe(true);
  });

  it('rejects an id that is not module.verb_object snake_case', () => {
    expect(ActionSchema.safeParse({ ...valid, id: 'Contacts.CreateContact' }).success).toBe(false);
    expect(ActionSchema.safeParse({ ...valid, id: 'createcontact' }).success).toBe(false);
    expect(ActionSchema.safeParse({ ...valid, id: 'contacts.create_contact' }).success).toBe(true);
  });

  it('rejects a verification status outside the three allowed values', () => {
    expect(
      ActionSchema.safeParse({
        ...valid,
        verification: { status: 'probably', evidence: ['x'], verified_at: null },
      }).success,
    ).toBe(false);
  });

  it('requires verified_at and evidence when status is verified', () => {
    expect(
      ActionSchema.safeParse({
        ...valid,
        verification: { status: 'verified', evidence: [], verified_at: null },
      }).success,
    ).toBe(false);
  });

  it('accepts a verified action with evidence and an ISO timestamp', () => {
    expect(
      ActionSchema.safeParse({
        ...valid,
        verification: {
          status: 'verified',
          evidence: ['captures/clean/contacts.json', 'test-results/trace.zip'],
          verified_at: '2026-11-07T10:00:00.000Z',
        },
      }).success,
    ).toBe(true);
  });

  it('rejects a verified_at that is not an ISO timestamp', () => {
    expect(
      ActionSchema.safeParse({
        ...valid,
        verification: { status: 'verified', evidence: ['x'], verified_at: 'last tuesday' },
      }).success,
    ).toBe(false);
  });

  it('accepts a null verified_at when status is inferred', () => {
    expect(
      ActionSchema.safeParse({
        ...valid,
        verification: {
          status: 'inferred',
          evidence: ['derived from UI affordance'],
          verified_at: null,
        },
      }).success,
    ).toBe(true);
  });

  it('accepts a null internal_endpoint, so a UI-only action is expressible', () => {
    expect(ActionSchema.safeParse({ ...valid, internal_endpoint: null }).success).toBe(true);
  });

  it('accepts a null operationId when the public API has no matching operation', () => {
    expect(
      ActionSchema.safeParse({ ...valid, public_api: { exists: false, operationId: null } }).success,
    ).toBe(true);
  });

  it('rejects an empty description, which would be useless to an agent', () => {
    expect(ActionSchema.safeParse({ ...valid, description: '' }).success).toBe(false);
  });

  it('rejects unknown top-level fields', () => {
    expect(ActionSchema.safeParse({ ...valid, confidence: 'high' }).success).toBe(false);
  });

  it('rejects a non-boolean destructive flag', () => {
    expect(ActionSchema.safeParse({ ...valid, destructive: 'yes' }).success).toBe(false);
  });
});
