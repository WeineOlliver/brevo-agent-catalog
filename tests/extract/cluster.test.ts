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
