import { describe, expect, it } from 'vitest';
import {
  deriveFlowSteps,
  resolveAction,
  templateToRegex,
  type CaptureRecord,
  type EndpointRef,
} from '../../src/flows/derive.js';

const endpoints: EndpointRef[] = [
  { id: 'lists.create_list', method: 'POST', path: '/lists/create' },
  { id: 'contacts.create_contact', method: 'POST', path: '/contact/backend/contacts/add-contact' },
  { id: 'contacts.update_contact', method: 'PATCH', path: '/contact/backend/contacts/update' },
  { id: 'contacts.delete_contact', method: 'DELETE', path: '/contact/backend/contacts/:id' },
  { id: 'segments.get_count', method: 'POST', path: '/segment/count' },
  { id: 'segments.query_contacts', method: 'POST', path: '/segment/query' },
  { id: 'campaigns.send_now', method: 'POST', path: '/marketing-campaign/api/campaign/:id/send-now' },
];

function record(
  time: string,
  method: string,
  route: string,
  host = 'https://app.brevo.com',
): CaptureRecord {
  return {
    method,
    route,
    url: `${host}${route}`,
    capturedAt: `2026-11-07T${time}.000Z`,
  };
}

describe('templateToRegex', () => {
  it('matches a concrete path against a parameterised template', () => {
    expect(templateToRegex('/contact/backend/contacts/:id').test('/contact/backend/contacts/8')).toBe(
      true,
    );
  });

  it('does not let a parameter swallow a path separator', () => {
    // Otherwise /contacts/:id matches /contacts/8/notes, and a flow gains a
    // step that never happened.
    expect(templateToRegex('/contact/backend/contacts/:id').test('/contact/backend/contacts/8/notes')).toBe(
      false,
    );
  });
});

describe('resolveAction', () => {
  it('finds the action a captured write belongs to', () => {
    expect(resolveAction('POST', '/lists/create', endpoints)).toBe('lists.create_list');
  });

  it('returns null when nothing in the catalog claims the route', () => {
    expect(resolveAction('POST', '/something/unknown', endpoints)).toBeNull();
  });

  it('prefers the more specific template when two match', () => {
    // A literal segment is evidence; a parameter is a wildcard. Without this
    // the generic entry wins and every id-bearing call is mislabelled.
    const ambiguous: EndpointRef[] = [
      { id: 'generic.put', method: 'PUT', path: '/editor-api/newsletters/:id' },
      { id: 'specific.put', method: 'PUT', path: '/editor-api/newsletters/draft' },
    ];
    expect(resolveAction('PUT', '/editor-api/newsletters/draft', ambiguous)).toBe('specific.put');
  });
});

describe('deriveFlowSteps', () => {
  const window = { from: '06:20:00', to: '06:30:00' };

  it('returns the writes in the order the capture made them', () => {
    const records = [
      record('06:20:47', 'POST', '/lists/create'),
      record('06:21:55', 'POST', '/contact/backend/contacts/add-contact'),
      record('06:29:49', 'DELETE', '/contact/backend/contacts/3'),
    ];
    expect(deriveFlowSteps(records, window, endpoints).actionIds).toEqual([
      'lists.create_list',
      'contacts.create_contact',
      'contacts.delete_contact',
    ]);
  });

  it('ignores anything outside the window', () => {
    const records = [
      record('06:19:00', 'POST', '/lists/create'),
      record('06:21:00', 'POST', '/contact/backend/contacts/add-contact'),
      record('06:31:00', 'DELETE', '/contact/backend/contacts/3'),
    ];
    expect(deriveFlowSteps(records, window, endpoints).actionIds).toEqual([
      'contacts.create_contact',
    ]);
  });

  it('ignores reads, and third-party hosts', () => {
    const records = [
      record('06:21:00', 'GET', '/lists/create'),
      record('06:21:30', 'POST', '/collect', 'https://analytics.example.com'),
      record('06:22:00', 'POST', '/lists/create'),
    ];
    expect(deriveFlowSteps(records, window, endpoints).actionIds).toEqual(['lists.create_list']);
  });

  it('drops the listing refresh the contacts grid fires after a mutation', () => {
    // Brevo reads over POST, so the grid reloading itself looks like three
    // writes. Counting them turns a six-step flow into fifteen steps of noise.
    const records = [
      record('06:21:00', 'POST', '/contact/backend/contacts/add-contact'),
      record('06:21:01', 'POST', '/segment/count'),
      record('06:21:02', 'POST', '/segment/query'),
      record('06:21:03', 'PATCH', '/contact/backend/contacts/update'),
    ];
    expect(deriveFlowSteps(records, window, endpoints).actionIds).toEqual([
      'contacts.create_contact',
      'contacts.update_contact',
    ]);
  });

  it('collapses consecutive repeats, because that is one form being filled', () => {
    const records = [
      record('06:29:23', 'PATCH', '/contact/backend/contacts/update'),
      record('06:29:27', 'PATCH', '/contact/backend/contacts/update'),
      record('06:29:29', 'PATCH', '/contact/backend/contacts/update'),
      record('06:29:49', 'DELETE', '/contact/backend/contacts/3'),
    ];
    expect(deriveFlowSteps(records, window, endpoints).actionIds).toEqual([
      'contacts.update_contact',
      'contacts.delete_contact',
    ]);
  });

  it('keeps a repeat that something else separates, because that is a real loop', () => {
    const records = [
      record('06:21:00', 'POST', '/lists/create'),
      record('06:22:00', 'POST', '/contact/backend/contacts/add-contact'),
      record('06:23:00', 'POST', '/lists/create'),
    ];
    expect(deriveFlowSteps(records, window, endpoints).actionIds).toEqual([
      'lists.create_list',
      'contacts.create_contact',
      'lists.create_list',
    ]);
  });

  it('reports a write no catalog entry claims instead of dropping it', () => {
    // Silently skipping it would hide a coverage gap inside a flow that looks
    // complete.
    const records = [record('06:21:00', 'POST', '/contact/backend/mystery')];
    const derived = deriveFlowSteps(records, window, endpoints);
    expect(derived.actionIds).toEqual([]);
    expect(derived.unmatched).toEqual([{ method: 'POST', route: '/contact/backend/mystery' }]);
  });
});
