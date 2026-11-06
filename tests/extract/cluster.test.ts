import { describe, expect, it } from 'vitest';
import { clusterCaptures } from '../../src/extract/cluster.js';
import type { CaptureRecord } from '../../src/capture/types.js';

function capture(overrides: Partial<CaptureRecord> = {}): CaptureRecord {
  return {
    id: 'id',
    source: 'playwright',
    route: '/contacts',
    method: 'POST',
    url: 'https://app.brevo.com/contact/add',
    status: 200,
    requestHeaders: {},
    responseHeaders: {},
    requestBody: '{"email":"{{EMAIL}}"}',
    responseBody: '{"id":1}',
    truncated: false,
    capturedAt: '2026-11-06T12:00:00.000Z',
    ...overrides,
  };
}

describe('clusterCaptures', () => {
  it('groups captures sharing method and normalized path into one candidate', () => {
    expect(clusterCaptures([capture(), capture({ id: 'other' })])).toHaveLength(1);
  });

  it('groups captures whose paths differ only by an id', () => {
    const a = capture({ method: 'GET', url: 'https://app.brevo.com/contact/42' });
    const b = capture({ method: 'GET', url: 'https://app.brevo.com/contact/99' });
    const clustered = clusterCaptures([a, b]);
    expect(clustered).toHaveLength(1);
    expect(clustered[0]?.pathTemplate).toBe('/contact/:id');
  });

  it('keeps different methods on the same path as separate candidates', () => {
    expect(clusterCaptures([capture(), capture({ method: 'PUT' })])).toHaveLength(2);
  });

  it('drops analytics, telemetry and asset requests', () => {
    const noise = [
      capture({ url: 'https://api.segment.io/v1/track' }),
      capture({ url: 'https://browser-intake-datadoghq.com/api/v2/rum' }),
      capture({ url: 'https://app.brevo.com/static/fonts/inter.woff2' }),
      capture({ url: 'https://www.google-analytics.com/collect' }),
      capture({ url: 'https://app.brevo.com/assets/main.css' }),
    ];
    expect(clusterCaptures(noise)).toEqual([]);
  });

  it('keeps calls to brevo-owned api hosts', () => {
    expect(clusterCaptures([capture({ url: 'https://api.brevo.com/v3/contacts' })])).toHaveLength(1);
  });

  it('drops brevo-owned hosts that serve app chrome and telemetry, not business actions', () => {
    // Discovered on the first real crawl: these account for a large share of
    // candidates and none of them is something a user does.
    const chrome = [
      'https://sidebar-backend.brevo.com/sidebar/api/header/info',
      'https://notifications-banner-api.brevo.com/banner-info',
      'https://marketing-notification.brevo.com/marketing/notification-list',
      'https://dt.brevo.com/collect',
      'https://metrics.brevo.com/g/collect',
      'https://fsrelay.brevo.com/x',
    ].map((url) => capture({ method: 'GET', url, responseBody: '{"a":1}' }));
    expect(clusterCaptures(chrome)).toEqual([]);
  });

  it('drops cloudflare and analytics beacon paths on any host', () => {
    expect(
      clusterCaptures([
        capture({ url: 'https://app.brevo.com/cdn-cgi/rum' }),
        capture({ method: 'GET', url: 'https://app.brevo.com/g/collect', responseBody: '{}' }),
      ]),
    ).toEqual([]);
  });

  it('keeps a product feature that happens to live on its own service', () => {
    expect(
      clusterCaptures([
        capture({ url: 'https://contacts-api.brevo.com/contacts/import' }),
        capture({ url: 'https://email-campaigns-backend.brevo.com/campaigns' }),
      ]),
    ).toHaveLength(2);
  });

  it('drops polling GETs that returned no body', () => {
    expect(
      clusterCaptures([
        capture({ method: 'GET', url: 'https://app.brevo.com/ping', responseBody: null }),
        capture({ method: 'GET', url: 'https://app.brevo.com/heartbeat', responseBody: '' }),
      ]),
    ).toEqual([]);
  });

  it('keeps a write request even when it returned no body', () => {
    expect(
      clusterCaptures([capture({ method: 'POST', responseBody: null })]),
    ).toHaveLength(1);
  });

  it('drops requests that failed with a server error', () => {
    expect(clusterCaptures([capture({ status: 500 })])).toEqual([]);
  });

  it('keeps a 4xx response, because a validation error reveals required fields', () => {
    expect(clusterCaptures([capture({ status: 422 })])).toHaveLength(1);
  });

  it('drops methods the schema cannot express, instead of drafting them twice', () => {
    // HEAD and OPTIONS are read methods to the clusterer but are not in the
    // schema's method enum, so every draft for one is rejected after two
    // provider calls.
    expect(clusterCaptures([capture({ method: 'HEAD', responseBody: '{}' })])).toEqual([]);
    expect(clusterCaptures([capture({ method: 'OPTIONS', responseBody: '{}' })])).toEqual([]);
  });

  it('retains up to three samples per candidate and no more', () => {
    const many = Array.from({ length: 7 }, (_, i) => capture({ id: `id-${i}` }));
    expect(clusterCaptures(many)[0]?.samples).toHaveLength(3);
  });

  it('records the route the candidate was first seen on', () => {
    expect(clusterCaptures([capture({ route: '/contacts/lists' })])[0]?.route).toBe(
      '/contacts/lists',
    );
  });

  it('gives each candidate a key combining method and path', () => {
    expect(clusterCaptures([capture()])[0]?.key).toBe('POST /contact/add');
  });

  it('returns candidates in a stable order', () => {
    const records = [capture({ method: 'PUT' }), capture({ method: 'GET', responseBody: '{}' })];
    expect(clusterCaptures(records).map((c) => c.key)).toEqual(
      clusterCaptures(records).map((c) => c.key),
    );
  });
});

/**
 * Measured on the 20-route exploration run: of 437 non-GET requests, all but
 * two were telemetry. These are the Brevo-owned ones the filter let through —
 * a feature-flag poll and an event log would both have become "actions".
 */
describe('clusterCaptures telemetry on Brevo-owned hosts', () => {
  it('drops the PostHog feature-flag host', () => {
    const record = capture({ url: 'https://ph.brevo.com/flags/?v=2' });
    expect(clusterCaptures([record])).toHaveLength(0);
  });

  it('drops an event-logging endpoint on a product backend', () => {
    const record = capture({ url: 'https://crm-backend-api.brevo.com/crm/backend/log-event' });
    expect(clusterCaptures([record])).toHaveLength(0);
  });

  it('keeps the two real writes the same run found', () => {
    const enable = capture({
      url: 'https://account-app.brevo.com/account/apps/enable/sms-campaigns',
    });
    const sync = capture({ url: 'https://contacts-api-v2.brevo.com/lists/list-count-sync' });
    expect(clusterCaptures([enable, sync])).toHaveLength(2);
  });
});
