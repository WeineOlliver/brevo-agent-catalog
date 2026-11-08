import { describe, expect, it } from 'vitest';
import { renderAreas, summariseAreas, type CatalogIndexFile, type FlowFile } from '../../src/cli/query.js';

const index: CatalogIndexFile = {
  count: 5,
  by_status: {},
  by_area: {},
  actions: [
    { id: 'contacts.create_contact', module: 'contacts', area: 'contacts', name: 'Create contact', description: 'd', status: 'verified', destructive: false },
    { id: 'contacts.delete_contact', module: 'contacts', area: 'contacts', name: 'Delete contact', description: 'd', status: 'verified', destructive: true },
    { id: 'contacts.get_lists', module: 'contacts', area: 'contacts', name: 'Get lists', description: 'd', status: 'observed', destructive: false },
    { id: 'automation.get_meta', module: 'automation', area: 'automation', name: 'Get meta', description: 'd', status: 'observed', destructive: false },
    { id: 'automation.list_runs', module: 'automation', area: 'automation', name: 'List runs', description: 'd', status: 'observed', destructive: false },
  ],
};

const flows: FlowFile = {
  count: 1,
  flows: [
    {
      id: 'erase_contact',
      name: 'Erase',
      goal: 'g',
      when_to_use: 'w',
      evidence: { capture: 'c.json', from: '00:00:00', to: '00:00:01' },
      steps: [{ action_id: 'contacts.delete_contact', why: 'because', optional: false }],
      notes: [],
    },
  ],
};

const areas = [
  { id: 'contacts', name: 'Contacts and audiences', does: 'Hold the people you market to.' },
  { id: 'automation', name: 'Automation', does: 'Run workflows that act on contacts.' },
];

describe('summariseAreas', () => {
  it('separates what can be changed from what can only be looked at', () => {
    const [contacts, automation] = summariseAreas(index, areas, flows);
    expect(contacts?.canChange).toBe(2);
    expect(contacts?.canSee).toBe(1);
    // The decisive case: an area that holds only reads.
    expect(automation?.canChange).toBe(0);
    expect(automation?.canSee).toBe(2);
  });

  it('puts flow steps first among the examples, then anything irreversible', () => {
    // Alphabetical order would lead with "Create contact", which is an
    // accident of naming. A flow step is a canonical journey through the area.
    const [contacts] = summariseAreas(index, areas, flows);
    expect(contacts?.examples[0]).toBe('Delete contact');
  });

  it('caps the examples, so the opening answer stays an answer', () => {
    for (const area of summariseAreas(index, areas, flows)) {
      expect(area.examples.length).toBeLessThanOrEqual(3);
    }
  });
});

describe('renderAreas', () => {
  it('opens with the count and the change-versus-look split', () => {
    const lines = renderAreas(summariseAreas(index, areas, flows), 5);
    expect(lines[0]).toContain('5 things');
    expect(lines[1]).toContain('2 of them change something');
    expect(lines[1]).toContain('3 only look');
  });

  it('says plainly when an area changes nothing at all', () => {
    // "6 things" reads as six capabilities. An agent that is told the area is
    // read-only can say "you can see your automations, not build one".
    const text = renderAreas(summariseAreas(index, areas, flows), 5).join('\n');
    expect(text).toContain('all read-only');
  });

  it('warns about what cannot be undone, per area', () => {
    const text = renderAreas(summariseAreas(index, areas, flows), 5).join('\n');
    expect(text).toContain('1 of them cannot be undone');
  });

  it('gives the human name and the command to go deeper', () => {
    const text = renderAreas(summariseAreas(index, areas, flows), 5).join('\n');
    expect(text).toContain('Contacts and audiences');
    expect(text).toContain('pnpm catalog area contacts');
  });

  it('names the multi-step flows an area takes part in', () => {
    const text = renderAreas(summariseAreas(index, areas, flows), 5).join('\n');
    expect(text).toContain('takes more than one step: erase_contact');
  });
});
