import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { captureId, parseHar } from '../../src/capture/har.js';

const sampleHar = readFileSync('tests/fixtures/sample.har', 'utf8');

describe('parseHar', () => {
  it('parses every entry in a HAR into a CaptureRecord', () => {
    expect(parseHar(sampleHar)).toHaveLength(3);
  });

  it('marks the source as har', () => {
    expect(parseHar(sampleHar).every((r) => r.source === 'har')).toBe(true);
  });

  it('keeps the request method, url and status', () => {
    const first = parseHar(sampleHar)[0]!;
    expect(first.method).toBe('POST');
    expect(first.url).toBe('https://app.brevo.com/contact/add');
    expect(first.status).toBe(200);
  });

  it('keeps the request body verbatim, because sanitizing is a later stage', () => {
    expect(parseHar(sampleHar)[0]!.requestBody).toContain('weine@example.com');
  });

  it('does not throw on a response body that is truncated mid-JSON', () => {
    const records = parseHar(sampleHar);
    const cut = records.find((r) => r.truncated);
    expect(cut?.responseBody).toBeTypeOf('string');
    expect(cut?.responseBody).toContain('"campaigns"');
  });

  it('flags truncation when the HAR declares a size larger than the captured text', () => {
    expect(parseHar(sampleHar).filter((r) => r.truncated)).toHaveLength(1);
  });

  it('does not throw on a non-JSON response body', () => {
    expect(() => parseHar(sampleHar)).not.toThrow();
    expect(
      parseHar(sampleHar).some((r) => r.responseHeaders['content-type']?.includes('text/html')),
    ).toBe(true);
  });

  it('lowercases header names', () => {
    const first = parseHar(sampleHar)[0]!;
    expect(Object.keys(first.requestHeaders).every((k) => k === k.toLowerCase())).toBe(true);
    expect(first.requestHeaders['x-csrf-token']).toBe('tok-9988');
  });

  it('leaves a request with no body as null rather than an empty string', () => {
    expect(parseHar(sampleHar)[1]!.requestBody).toBeNull();
  });

  it('uses the given route for every record when one is supplied', () => {
    expect(parseHar(sampleHar, '/contacts').every((r) => r.route === '/contacts')).toBe(true);
  });

  it('falls back to the url pathname when no route is supplied', () => {
    expect(parseHar(sampleHar)[0]!.route).toBe('/contact/add');
  });

  it('carries the HAR timestamp through as capturedAt', () => {
    expect(parseHar(sampleHar)[0]!.capturedAt).toBe('2026-11-06T12:00:00.000Z');
  });

  it('returns an empty array for a HAR with no entries', () => {
    expect(parseHar(JSON.stringify({ log: { version: '1.2', entries: [] } }))).toEqual([]);
  });

  it('throws a clear error when the input is not a HAR', () => {
    expect(() => parseHar('{"not":"a har"}')).toThrow(/har/i);
  });
});

describe('captureId', () => {
  it('gives the same id to the same method and url', () => {
    expect(captureId('POST', 'https://a/b')).toBe(captureId('POST', 'https://a/b'));
  });

  it('gives different ids to different methods on one url', () => {
    expect(captureId('POST', 'https://a/b')).not.toBe(captureId('GET', 'https://a/b'));
  });

  it('is filename-safe', () => {
    expect(captureId('POST', 'https://a/b?x=1&y=2')).toMatch(/^[a-z0-9]+$/);
  });
});
