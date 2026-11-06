import { describe, expect, it } from 'vitest';
import { buildIndex } from '../../src/catalog/index-build.js';
import { ActionSchema, type Action } from '../../src/types.js';
import { validAction } from '../fixtures/valid-action.js';

const base: Action = ActionSchema.parse(validAction);

const verifiedA: Action = {
  ...base,
  id: 'contacts.create_contact',
  verification: {
    status: 'verified',
    evidence: ['captures/clean/contacts.json'],
    verified_at: '2026-11-07T10:00:00.000Z',
  },
};

const inferredB: Action = {
  ...base,
  id: 'automation.create_workflow',
  module: 'automation',
  name: 'Create workflow',
  verification: { status: 'inferred', evidence: ['UI affordance only'], verified_at: null },
};

describe('buildIndex', () => {
  it('counts actions by verification status', () => {
    expect(buildIndex([verifiedA, inferredB]).by_status).toEqual({
      verified: 1,
      observed: 0,
      inferred: 1,
    });
  });

  it('reports the total count', () => {
    expect(buildIndex([verifiedA, inferredB]).count).toBe(2);
  });

  it('throws naming the duplicated id when two actions share one', () => {
    expect(() => buildIndex([verifiedA, { ...verifiedA, name: 'Other' }])).toThrow(
      /contacts\.create_contact/,
    );
  });

  it('sorts entries by id so the file is diff-stable', () => {
    expect(buildIndex([verifiedA, inferredB]).actions.map((a) => a.id)).toEqual([
      'automation.create_workflow',
      'contacts.create_contact',
    ]);
  });

  it('carries description and destructive into the index', () => {
    const entry = buildIndex([verifiedA]).actions[0];
    expect(entry?.description).toBe(base.description);
    expect(entry?.destructive).toBe(base.destructive);
  });

  it('carries module, name and status into the index', () => {
    const entry = buildIndex([inferredB]).actions[0];
    expect(entry?.module).toBe('automation');
    expect(entry?.name).toBe('Create workflow');
    expect(entry?.status).toBe('inferred');
  });

  it('stamps an ISO generated_at', () => {
    expect(Number.isNaN(Date.parse(buildIndex([verifiedA]).generated_at))).toBe(false);
  });

  it('handles an empty catalog', () => {
    const index = buildIndex([]);
    expect(index.count).toBe(0);
    expect(index.by_status).toEqual({ verified: 0, observed: 0, inferred: 0 });
  });

  it('does not leak the full inputs schema into the index', () => {
    expect(buildIndex([verifiedA]).actions[0]).not.toHaveProperty('inputs');
  });
});
