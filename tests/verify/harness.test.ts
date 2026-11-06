import { describe, expect, it } from 'vitest';
import { applyOutcome, assessOutcome } from '../../src/verify/harness.js';
import { validateAction } from '../../src/catalog/validate.js';
import { ActionSchema, type Action } from '../../src/types.js';
import type { CaptureRecord } from '../../src/capture/types.js';
import { validAction } from '../fixtures/valid-action.js';

const action: Action = ActionSchema.parse({ ...validAction, destructive: true, idempotent: false });

const readAction: Action = ActionSchema.parse({
  ...validAction,
  id: 'contacts.list_contacts',
  destructive: false,
  internal_endpoint: { method: 'GET', path: '/contact/list', body_example: null },
});

function capture(overrides: Partial<CaptureRecord> = {}): CaptureRecord {
  return {
    id: 'id',
    source: 'playwright',
    route: 'verify:contacts.create_contact',
    method: 'POST',
    url: 'https://app.brevo.com/contact/add',
    status: 200,
    requestHeaders: {},
    responseHeaders: {},
    requestBody: '{"email":"{{EMAIL}}"}',
    responseBody: '{"id":1}',
    truncated: false,
    capturedAt: '2026-11-07T10:00:00.000Z',
    ...overrides,
  };
}

describe('assessOutcome', () => {
  it('returns verified when the observed request matches the claimed method and path', () => {
    expect(assessOutcome(action, [capture()]).status).toBe('verified');
  });

  it('returns observed with a reason when nothing matching was executed', () => {
    const outcome = assessOutcome(action, []);
    expect(outcome.status).toBe('observed');
    expect(outcome.status === 'observed' && outcome.reason).toBeTruthy();
  });

  it('returns observed when the request ran but responded 4xx', () => {
    expect(assessOutcome(action, [capture({ status: 422 })]).status).toBe('observed');
  });

  it('returns observed when only a different endpoint was called', () => {
    expect(
      assessOutcome(action, [capture({ url: 'https://app.brevo.com/something/else' })]).status,
    ).toBe('observed');
  });

  it('returns observed when the method differs', () => {
    expect(assessOutcome(action, [capture({ method: 'PUT' })]).status).toBe('observed');
  });

  it('matches a path whose id segments differ from the claimed template', () => {
    const withId = ActionSchema.parse({
      ...validAction,
      internal_endpoint: { method: 'GET', path: '/contact/:id', body_example: null },
    });
    expect(
      assessOutcome(withId, [capture({ method: 'GET', url: 'https://app.brevo.com/contact/77' })])
        .status,
    ).toBe('verified');
  });

  it('returns observed with a reason when the action claims no endpoint at all', () => {
    const uiOnly = ActionSchema.parse({ ...validAction, internal_endpoint: null });
    const outcome = assessOutcome(uiOnly, [capture()]);
    expect(outcome.status).toBe('observed');
    expect(outcome.status === 'observed' && outcome.reason).toMatch(/no internal endpoint/i);
  });

  it('stamps an ISO verified_at and non-empty evidence on a verified outcome', () => {
    const outcome = assessOutcome(action, [capture()]);
    expect(outcome.evidence.length).toBeGreaterThan(0);
    expect(outcome.status === 'verified' && Number.isNaN(Date.parse(outcome.verified_at))).toBe(
      false,
    );
  });

  it('names the observed status code in the evidence', () => {
    expect(assessOutcome(action, [capture()]).evidence.join(' ')).toContain('200');
  });
});

describe('applyOutcome', () => {
  it('leaves the action schema-valid after applying a verified outcome', () => {
    const outcome = assessOutcome(action, [capture()]);
    expect(validateAction(applyOutcome(action, outcome)).ok).toBe(true);
  });

  it('leaves the action schema-valid after applying an observed outcome', () => {
    const outcome = assessOutcome(action, []);
    expect(validateAction(applyOutcome(action, outcome)).ok).toBe(true);
  });

  it('writes the verified status, evidence and timestamp onto the action', () => {
    const updated = applyOutcome(action, assessOutcome(action, [capture()]));
    expect(updated.verification.status).toBe('verified');
    expect(updated.verification.verified_at).not.toBeNull();
  });

  it('clears the fail-safe destructive flag only when execution verified it', () => {
    const verified = assessOutcome(action, [capture()]);
    const observed = assessOutcome(action, []);
    expect(applyOutcome(action, verified, { destructive: false }).destructive).toBe(false);
    expect(applyOutcome(action, observed, { destructive: false }).destructive).toBe(true);
  });

  it('accepts a corrected idempotent flag only on a verified outcome', () => {
    const verified = assessOutcome(action, [capture()]);
    const observed = assessOutcome(action, []);
    expect(applyOutcome(action, verified, { idempotent: true }).idempotent).toBe(true);
    expect(applyOutcome(action, observed, { idempotent: true }).idempotent).toBe(false);
  });

  it('does not touch the flags when no correction is supplied', () => {
    const updated = applyOutcome(readAction, assessOutcome(readAction, []));
    expect(updated.destructive).toBe(false);
    expect(updated.idempotent).toBe(readAction.idempotent);
  });

  it('does not mutate the action it was given', () => {
    applyOutcome(action, assessOutcome(action, [capture()]));
    expect(action.verification.status).toBe('observed');
  });
});
