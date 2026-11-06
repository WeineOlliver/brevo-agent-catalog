import { describe, expect, it } from 'vitest';
import { canonicalModules, normalizeCatalog } from '../../src/catalog/normalize.js';
import { ActionSchema, type Action } from '../../src/types.js';
import { validAction } from '../fixtures/valid-action.js';

function action(over: Partial<Action> & { id: string }): Action {
  return ActionSchema.parse({ ...validAction, ...over });
}

const endpoint = (method: 'GET' | 'POST', path: string) => ({
  method,
  path,
  body_example: null,
});

describe('canonicalModules', () => {
  it('maps a singular module onto its plural when the plural is more populated', () => {
    const map = canonicalModules([
      action({ id: 'organization.get_info', module: 'organization' }),
      action({ id: 'organizations.list_members', module: 'organizations' }),
      action({ id: 'organizations.get_plan', module: 'organizations' }),
    ]);
    expect(map.get('organization')).toBe('organizations');
  });

  it('maps a plural onto the singular when the singular is more populated', () => {
    const map = canonicalModules([
      action({ id: 'account.get_info', module: 'account' }),
      action({ id: 'account.get_plan', module: 'account' }),
      action({ id: 'accounts.list', module: 'accounts' }),
    ]);
    expect(map.get('accounts')).toBe('account');
  });

  it('prefers the plural when the two are equally populated', () => {
    const map = canonicalModules([
      action({ id: 'feature.get_flags', module: 'feature' }),
      action({ id: 'features.list', module: 'features' }),
    ]);
    expect(map.get('feature')).toBe('features');
  });

  it('leaves unrelated module names alone', () => {
    const map = canonicalModules([
      action({ id: 'contacts.create_contact', module: 'contacts' }),
      action({ id: 'campaigns.send_campaign', module: 'campaigns' }),
    ]);
    expect(map.size).toBe(0);
  });

  it('does not merely strip a trailing s from a word that is not a plural pair', () => {
    const map = canonicalModules([action({ id: 'segments.list', module: 'segments' })]);
    expect(map.get('segments')).toBeUndefined();
  });
});

describe('normalizeCatalog', () => {
  it('merges two entries describing the same endpoint', () => {
    const result = normalizeCatalog([
      action({ id: 'deals.list', internal_endpoint: endpoint('GET', '/crm/backend/deals') }),
      action({
        id: 'deals.list_for_contact',
        internal_endpoint: endpoint('GET', '/crm/backend/deals'),
      }),
    ]);
    expect(result.actions).toHaveLength(1);
    expect(result.merged).toHaveLength(1);
  });

  it('reports which id was kept and which was dropped', () => {
    const result = normalizeCatalog([
      action({
        id: 'security.list_ips',
        description: 'short',
        internal_endpoint: endpoint('GET', '/ips/list'),
      }),
      action({
        id: 'security.list_authorized_ips',
        description: 'A much longer and more useful description for an agent to read.',
        internal_endpoint: endpoint('GET', '/ips/list'),
      }),
    ]);
    expect(result.merged[0]?.kept).toBe('security.list_authorized_ips');
    expect(result.merged[0]?.dropped).toBe('security.list_ips');
  });

  it('keeps the entry from the more populated module when both describe one endpoint', () => {
    const result = normalizeCatalog([
      action({ id: 'dashboard.get_campaign_status', module: 'dashboard', internal_endpoint: endpoint('GET', '/x') }),
      action({ id: 'campaigns.get_dashboard_status', module: 'campaigns', internal_endpoint: endpoint('GET', '/x') }),
      action({ id: 'campaigns.send_campaign', module: 'campaigns', internal_endpoint: endpoint('POST', '/y') }),
    ]);
    expect(result.actions.map((a) => a.id).sort()).toEqual([
      'campaigns.get_dashboard_status',
      'campaigns.send_campaign',
    ]);
  });

  it('does not merge different endpoints', () => {
    const result = normalizeCatalog([
      action({ id: 'contacts.a', internal_endpoint: endpoint('GET', '/a') }),
      action({ id: 'contacts.b', internal_endpoint: endpoint('GET', '/b') }),
    ]);
    expect(result.actions).toHaveLength(2);
    expect(result.merged).toEqual([]);
  });

  it('never merges entries that declare no endpoint, since they are not comparable', () => {
    const result = normalizeCatalog([
      action({ id: 'automation.a', internal_endpoint: null }),
      action({ id: 'automation.b', internal_endpoint: null }),
    ]);
    expect(result.actions).toHaveLength(2);
  });

  it('rewrites the id when the module is renamed', () => {
    const result = normalizeCatalog([
      action({ id: 'organization.get_info', module: 'organization', internal_endpoint: endpoint('GET', '/o') }),
      action({ id: 'organizations.list', module: 'organizations', internal_endpoint: endpoint('GET', '/os') }),
      action({ id: 'organizations.get_plan', module: 'organizations', internal_endpoint: endpoint('GET', '/op') }),
    ]);
    const ids = result.actions.map((a) => a.id);
    expect(ids).toContain('organizations.get_info');
    expect(ids).not.toContain('organization.get_info');
    expect(result.renamed).toContainEqual({ from: 'organization.get_info', to: 'organizations.get_info' });
  });

  it('leaves every output entry schema-valid', () => {
    const result = normalizeCatalog([
      action({ id: 'organization.get_info', module: 'organization', internal_endpoint: endpoint('GET', '/o') }),
      action({ id: 'organizations.list', module: 'organizations', internal_endpoint: endpoint('GET', '/os') }),
    ]);
    for (const a of result.actions) expect(ActionSchema.safeParse(a).success).toBe(true);
  });

  it('is idempotent — normalising twice changes nothing the second time', () => {
    const first = normalizeCatalog([
      action({ id: 'deals.list', internal_endpoint: endpoint('GET', '/d') }),
      action({ id: 'deals.list_again', internal_endpoint: endpoint('GET', '/d') }),
    ]);
    const second = normalizeCatalog(first.actions);
    expect(second.merged).toEqual([]);
    expect(second.renamed).toEqual([]);
    expect(second.actions).toEqual(first.actions);
  });

  it('does not create an id collision while renaming', () => {
    const result = normalizeCatalog([
      action({ id: 'feature.get_flags', module: 'feature', internal_endpoint: endpoint('GET', '/f1') }),
      action({ id: 'features.get_flags', module: 'features', internal_endpoint: endpoint('GET', '/f2') }),
    ]);
    expect(new Set(result.actions.map((a) => a.id)).size).toBe(result.actions.length);
  });
});
