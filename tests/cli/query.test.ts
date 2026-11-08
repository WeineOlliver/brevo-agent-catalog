import { describe, expect, it } from 'vitest';
import {
  findFlow,
  flowsContaining,
  listArea,
  search,
  summariseAreas,
  type CatalogIndexFile,
  type FlowFile,
} from '../../src/cli/query.js';

const index: CatalogIndexFile = {
  count: 4,
  by_status: { verified: 1, observed: 3, inferred: 0 },
  by_area: { contacts: 3, campaigns: 1 },
  actions: [
    {
      id: 'contacts.create_contact',
      module: 'contacts',
      area: 'contacts',
      name: 'Create contact',
      description: 'Adds a person to the account so campaigns can reach them.',
      status: 'verified',
      destructive: false,
    },
    {
      id: 'contacts.delete_contact',
      module: 'contacts',
      area: 'contacts',
      name: 'Delete contact',
      description: 'Destroys the contact record. Irreversible.',
      status: 'verified',
      destructive: true,
    },
    {
      id: 'lists.create_list',
      module: 'lists',
      area: 'contacts',
      name: 'Create list',
      description: 'Creates an audience a campaign can be sent to.',
      status: 'verified',
      destructive: false,
    },
    {
      id: 'campaigns.send_now',
      module: 'campaigns',
      area: 'campaigns',
      name: 'Send campaign now',
      description: 'Sends the campaign immediately to its recipients.',
      status: 'observed',
      destructive: true,
    },
  ],
};

const flows: FlowFile = {
  count: 1,
  flows: [
    {
      id: 'erase_contact',
      name: 'Honour a deletion request',
      goal: 'Remove a person entirely.',
      when_to_use: 'Only when the person must be gone.',
      evidence: { capture: 'captures/clean/har/block-a.json', from: '06:29:23', to: '06:29:49' },
      steps: [
        { action_id: 'contacts.delete_contact', why: 'Destroys the record.', optional: false },
        { action_id: 'contacts.create_contact', why: 'Only here to test ordering.', optional: true },
      ],
      notes: [],
    },
  ],
};

const areas = [
  { id: 'contacts', name: 'Contacts', does: 'Hold the people you market to.' },
  { id: 'campaigns', name: 'Campaigns', does: 'Send marketing messages.' },
];

describe('summariseAreas', () => {
  it('counts the entries and the destructive ones per area', () => {
    const [contacts, campaigns] = summariseAreas(index, areas, flows);
    expect(contacts?.count).toBe(3);
    expect(contacts?.destructive).toBe(1);
    expect(campaigns?.count).toBe(1);
    expect(campaigns?.destructive).toBe(1);
  });

  it('names the flows that touch an area, so the next hop is visible', () => {
    const [contacts, campaigns] = summariseAreas(index, areas, flows);
    expect(contacts?.flows).toEqual(['erase_contact']);
    expect(campaigns?.flows).toEqual([]);
  });
});

describe('listArea', () => {
  it('lists an area without the descriptions', () => {
    // The listing is the cheap hop: 64 names cost 787 tokens where 64
    // descriptions cost 5 773. Adding descriptions here would delete the
    // reason the command exists.
    const listing = listArea(index, 'contacts');
    expect(listing?.count).toBe(3);
    expect(Object.keys(listing?.entries[0] ?? {})).toEqual([
      'id',
      'name',
      'destructive',
      'status',
    ]);
  });

  it('returns null for an unknown area instead of an empty listing', () => {
    // An empty list reads as "this area has nothing in it", which is a
    // different and wrong answer.
    expect(listArea(index, 'nonsense')).toBeNull();
  });
});

describe('search', () => {
  it('finds an entry by a word from its id', () => {
    expect(search(index, 'delete contact')[0]?.id).toBe('contacts.delete_contact');
  });

  it('matches an inflected word, which substring matching did not', () => {
    // "deleted" contains neither "delete_contact" nor the reverse, so the one
    // entry a deletion request needs used to score zero while an unrelated
    // entry won on a stopword.
    expect(search(index, 'deleted')[0]?.id).toBe('contacts.delete_contact');
  });

  it('ignores filler words in a task phrased by a person', () => {
    const hits = search(index, 'someone asked to be deleted');
    expect(hits[0]?.id).toBe('contacts.delete_contact');
  });

  it('ranks an id or name hit above a description-only hit', () => {
    const hits = search(index, 'campaign');
    expect(hits[0]?.id).toBe('campaigns.send_now');
  });

  it('returns nothing for a query made only of filler', () => {
    expect(search(index, 'the and for')).toEqual([]);
  });

  it('respects the limit', () => {
    expect(search(index, 'contact campaign list', 2)).toHaveLength(2);
  });

  it('carries the area on every hit, so the agent can widen the browse', () => {
    for (const hit of search(index, 'contact')) {
      expect(['contacts', 'campaigns']).toContain(hit.area);
    }
  });
});

describe('flows', () => {
  it('finds a flow by id', () => {
    expect(findFlow(flows, 'erase_contact')?.steps).toHaveLength(2);
  });

  it('returns null for an unknown flow', () => {
    expect(findFlow(flows, 'nope')).toBeNull();
  });

  it('reports which flows contain an action', () => {
    expect(flowsContaining(flows, 'contacts.delete_contact')).toEqual(['erase_contact']);
    expect(flowsContaining(flows, 'campaigns.send_now')).toEqual([]);
  });
});
