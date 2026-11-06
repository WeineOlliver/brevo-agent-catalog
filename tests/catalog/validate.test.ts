import { describe, expect, it } from 'vitest';
import { validateAction } from '../../src/catalog/validate.js';
import { validAction } from '../fixtures/valid-action.js';

describe('validateAction', () => {
  it('accepts a valid action', () => {
    const result = validateAction(validAction);
    expect(result.ok).toBe(true);
    expect(result.ok && result.action.id).toBe('contacts.create_contact');
  });

  it('returns readable ajv errors for a malformed action', () => {
    const result = validateAction({ id: 'bad id' });
    expect(result.ok).toBe(false);
    expect(result.ok === false && result.errors.join(' ')).toMatch(/id/);
  });

  it('rejects a null verified_at on a verified action', () => {
    const result = validateAction({
      ...validAction,
      verification: { status: 'verified', evidence: ['x'], verified_at: null },
    });
    expect(result.ok).toBe(false);
  });

  it('rejects an unknown top-level field', () => {
    expect(validateAction({ ...validAction, confidence: 'high' }).ok).toBe(false);
  });

  it('reports every error, not just the first', () => {
    const result = validateAction({ id: 'bad id', module: 42, destructive: 'yes' });
    expect(result.ok === false && result.errors.length).toBeGreaterThan(1);
  });

  it('does not throw on a non-object input', () => {
    expect(() => validateAction('nope')).not.toThrow();
    expect(validateAction('nope').ok).toBe(false);
  });
});
