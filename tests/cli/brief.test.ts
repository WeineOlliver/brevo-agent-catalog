import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { briefOf, renderBrief, type FlowFile, type StoredAction } from '../../src/cli/query.js';

const flows = JSON.parse(readFileSync('flows/index.json', 'utf8')) as FlowFile;

const action: StoredAction = {
  id: 'contacts.delete_contact',
  name: 'Delete contact',
  description: 'Removes a contact from the whole account.',
  preconditions: ['The contact must exist.'],
  inputs: {
    properties: { id: { type: 'integer', description: 'Internal numeric id.' } },
    required: ['id'],
  },
  outputs: { properties: { message: {} } },
  side_effects: ['The contact record is removed.'],
  destructive: true,
  idempotent: false,
  internal_endpoint: { method: 'DELETE', path: '/contact/backend/contacts/:id', body_example: null },
  verification: { status: 'verified' },
};

describe('briefOf', () => {
  it('keeps what an agent acts on', () => {
    const brief = briefOf(action, flows);
    expect(brief.call).toEqual({ method: 'DELETE', path: '/contact/backend/contacts/:id' });
    expect(brief.destructive).toBe(true);
    expect(brief.inputs).toEqual([
      { name: 'id', type: 'integer', required: true, description: 'Internal numeric id.' },
    ]);
    expect(brief.before).toEqual(['The contact must exist.']);
  });

  it('drops the provenance an agent cannot act on', () => {
    // ui_path, public_api, plan_tier, evidence and verified_at all earn their
    // place in the stored file. None of them answers "what do I call".
    const brief = briefOf(
      { ...action, ...({ ui_path: ['Contacts'], plan_tier: 'unknown' } as object) },
      flows,
    );
    const keys = Object.keys(brief);
    expect(keys).not.toContain('ui_path');
    expect(keys).not.toContain('plan_tier');
    expect(keys).not.toContain('verification');
    expect(keys).not.toContain('public_api');
  });

  it('translates the status into what it means, not just its name', () => {
    // "observed" is jargon. An agent that is told inputs are a hypothesis can
    // act differently; one that is told "observed" cannot.
    expect(briefOf(action, flows).trust.means).toMatch(/executed against a real account/);
    expect(
      briefOf({ ...action, verification: { status: 'observed' } }, flows).trust.means,
    ).toMatch(/hypothesis/);
  });

  it('says where the action sits in a flow, not just that it is in one', () => {
    // "part of erase_contact" leaves the dangerous question open: which step?
    const brief = briefOf(action, flows);
    expect(brief.flows).toEqual([{ id: 'erase_contact', step: 2, of: 2 }]);
  });

  it('omits an absent body example rather than printing null', () => {
    expect(briefOf(action, flows).call).not.toHaveProperty('body_example');
    const withBody = briefOf(
      { ...action, internal_endpoint: { method: 'POST', path: '/x', body_example: '{"a":1}' } },
      flows,
    );
    expect(withBody.call.body_example).toBe('{"a":1}');
  });

  it('survives an entry with no inputs, outputs or preconditions', () => {
    const bare: StoredAction = { id: 'a.b', name: 'B', description: 'd' };
    const brief = briefOf(bare, flows);
    expect(brief.inputs).toEqual([]);
    expect(brief.returns).toEqual([]);
    expect(brief.call).toEqual({ method: '?', path: '?' });
  });
});

describe('renderBrief', () => {
  it('leads with the risk flag, before anything else can be skimmed', () => {
    const lines = renderBrief(briefOf(action, flows));
    expect(lines[0]).toContain('DESTRUCTIVE');
  });

  it('marks required inputs', () => {
    expect(renderBrief(briefOf(action, flows)).join('\n')).toContain('id*');
  });

  it('is markedly shorter than the stored entry', () => {
    const rendered = renderBrief(briefOf(action, flows)).join('\n');
    const stored = JSON.stringify(action, null, 2);
    expect(rendered.length).toBeLessThan(stored.length);
  });
});
