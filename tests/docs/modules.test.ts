import { describe, expect, it } from 'vitest';
import { buildModulesDoc } from '../../src/docs/modules.js';
import { buildIndex } from '../../src/catalog/index-build.js';
import { ActionSchema, type Action } from '../../src/types.js';
import { validAction } from '../fixtures/valid-action.js';

const createContact: Action = ActionSchema.parse({
  ...validAction,
  verification: {
    status: 'verified',
    evidence: ['executed POST /contact/add -> 200'],
    verified_at: '2026-11-07T10:00:00.000Z',
  },
});

const createWorkflow: Action = ActionSchema.parse({
  ...validAction,
  id: 'automation.create_workflow',
  module: 'automation',
  name: 'Create workflow',
  verification: { status: 'inferred', evidence: ['UI affordance only'], verified_at: null },
});

const index = buildIndex([createContact, createWorkflow]);
const routes = ['/contacts', '/automation'];

describe('buildModulesDoc', () => {
  it('groups actions under a heading per module', () => {
    const doc = buildModulesDoc(index, routes);
    expect(doc).toMatch(/## contacts/);
    expect(doc).toMatch(/## automation/);
  });

  it("shows each action's verification status", () => {
    expect(buildModulesDoc(index, routes)).toContain('verified');
    expect(buildModulesDoc(index, routes)).toContain('inferred');
  });

  it('lists discovered routes that produced no action', () => {
    expect(buildModulesDoc(index, ['/unmapped'])).toContain('/unmapped');
  });

  it('does not list a route that an action already covers', () => {
    const doc = buildModulesDoc(index, ['/contacts']);
    const unmappedSection = doc.slice(doc.indexOf('Routes with no catalogued action'));
    expect(unmappedSection).not.toContain('/contacts');
  });

  it('reports the status totals', () => {
    expect(buildModulesDoc(index, routes)).toMatch(/2 action/);
  });

  it('marks a destructive action so the table is scannable', () => {
    const destructive = ActionSchema.parse({ ...validAction, id: 'contacts.delete_contact', destructive: true });
    expect(buildModulesDoc(buildIndex([destructive]), [])).toMatch(/destructive/i);
  });

  it('includes each action id so an agent-facing file can be cross-referenced', () => {
    expect(buildModulesDoc(index, routes)).toContain('contacts.create_contact');
  });

  it('handles an empty catalog without crashing', () => {
    expect(() => buildModulesDoc(buildIndex([]), [])).not.toThrow();
    expect(buildModulesDoc(buildIndex([]), [])).toContain('0 action');
  });

  it('sorts modules alphabetically so the file is diff-stable', () => {
    const doc = buildModulesDoc(index, routes);
    expect(doc.indexOf('## automation')).toBeLessThan(doc.indexOf('## contacts'));
  });
});
