import { describe, expect, it } from 'vitest';
import type { CaptureRecord } from '../../src/capture/types.js';
import { redactCapture, redactText } from '../../src/sanitize/redact.js';

const rules = { accountIds: ['998877'], emails: ['weine@example.com'] };
const empty = { accountIds: [], emails: [] };

const record: CaptureRecord = {
  id: 'abc123',
  source: 'har',
  route: '/contacts',
  method: 'POST',
  url: 'https://app.brevo.com/contact/add',
  status: 200,
  requestHeaders: {
    cookie: 'sid=abc123',
    authorization: 'Bearer eyJhbGciOiJIUzI1NiJ9.e30.signature',
    'x-csrf-token': 'tok-9988',
    'x-csrf-state': 'state-1',
    'content-type': 'application/json',
  },
  responseHeaders: { 'set-cookie': 'sid=xyz; HttpOnly', 'content-type': 'application/json' },
  requestBody: '{"email":"weine@example.com"}',
  responseBody: '{"id":1234}',
  truncated: false,
  capturedAt: '2026-11-06T12:00:00.000Z',
};

describe('redactCapture', () => {
  it('drops cookie, set-cookie, authorization and x-csrf* headers', () => {
    const out = redactCapture(record, rules);
    expect(out.requestHeaders).not.toHaveProperty('cookie');
    expect(out.requestHeaders).not.toHaveProperty('authorization');
    expect(out.requestHeaders).not.toHaveProperty('x-csrf-token');
    expect(out.requestHeaders).not.toHaveProperty('x-csrf-state');
    expect(out.responseHeaders).not.toHaveProperty('set-cookie');
  });

  it('keeps harmless headers', () => {
    expect(redactCapture(record, rules).requestHeaders['content-type']).toBe('application/json');
  });

  it('redacts a key carried in a URL query string', () => {
    const out = redactCapture(
      { ...record, url: 'https://app.brevo.com/x?api-key=xkeysib-abc123def456789a' },
      rules,
    );
    expect(out.url).not.toContain('xkeysib-abc123def456789a');
  });

  it('redacts the request and response bodies', () => {
    const out = redactCapture(record, rules);
    expect(out.requestBody).not.toContain('weine@example.com');
    expect(out.requestBody).toContain('{{EMAIL}}');
  });

  it('redacts configured identifiers out of the route', () => {
    expect(redactCapture({ ...record, route: '/account/998877' }, rules).route).not.toContain(
      '998877',
    );
  });

  it('leaves a null body as null', () => {
    const out = redactCapture({ ...record, requestBody: null, responseBody: null }, rules);
    expect(out.requestBody).toBeNull();
    expect(out.responseBody).toBeNull();
  });

  it('preserves the record identity fields', () => {
    const out = redactCapture(record, rules);
    expect(out.id).toBe(record.id);
    expect(out.method).toBe('POST');
    expect(out.status).toBe(200);
  });
});

describe('redactText', () => {
  it('replaces a real email with {{EMAIL}}', () => {
    expect(redactText('to=weine@example.com', { accountIds: [], emails: ['weine@example.com'] })).toBe(
      'to={{EMAIL}}',
    );
  });

  it('replaces any email-shaped string, not only known ones', () => {
    expect(redactText('to=someone.else@mail.co', empty)).toBe('to={{EMAIL}}');
  });

  it('redacts a token nested deep inside a JSON body', () => {
    const body = JSON.stringify({ a: { b: { c: { token: 'eyJhbGciOiJIUzI1NiJ9.e30.xyzsig' } } } });
    expect(redactText(body, empty)).not.toContain('eyJhbGciOiJIUzI1NiJ9');
  });

  it('redacts a Brevo api key wherever it appears', () => {
    expect(redactText('key is xkeysib-0123456789abcdef0123 ok', empty)).not.toContain('xkeysib-0123456789abcdef0123');
  });

  it('redacts a generic token query parameter', () => {
    expect(redactText('?access_token=supersecretvalue123', empty)).not.toContain(
      'supersecretvalue123',
    );
  });

  it('preserves JSON structure when substituting placeholders', () => {
    expect(JSON.parse(redactText('{"listIds":[7]}', { accountIds: ['7'], emails: [] }))).toEqual({
      listIds: ['{{LIST_ID}}'],
    });
  });

  it('chooses the placeholder from the surrounding key', () => {
    expect(redactText('{"campaignId":"4321"}', { accountIds: ['4321'], emails: [] })).toContain(
      '{{CAMPAIGN_ID}}',
    );
    expect(redactText('{"templateId":"4321"}', { accountIds: ['4321'], emails: [] })).toContain(
      '{{TEMPLATE_ID}}',
    );
    expect(redactText('{"accountId":"4321"}', { accountIds: ['4321'], emails: [] })).toContain(
      '{{ACCOUNT_ID}}',
    );
  });

  it('redacts an identifier in a URL path without quoting it', () => {
    expect(redactText('https://app.brevo.com/list/998877/edit', rules)).toBe(
      'https://app.brevo.com/list/{{LIST_ID}}/edit',
    );
  });

  it('does not match an identifier embedded inside a longer number', () => {
    expect(redactText('{"n":1998877123}', { accountIds: ['998877'], emails: [] })).toContain(
      '1998877123',
    );
  });

  it('does not throw on a truncated or non-JSON body', () => {
    expect(() => redactText('{"a":1,"b":{"c"', rules)).not.toThrow();
    expect(() => redactText('<html><body>hi', rules)).not.toThrow();
  });

  it('is idempotent — redacting already-redacted text changes nothing', () => {
    const once = redactText('{"email":"weine@example.com","listIds":[998877]}', rules);
    expect(redactText(once, rules)).toBe(once);
  });

  it('leaves text with nothing sensitive untouched', () => {
    expect(redactText('{"name":"Promo campaign"}', rules)).toBe('{"name":"Promo campaign"}');
  });
});
