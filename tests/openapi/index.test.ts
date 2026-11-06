import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { buildPublicApiIndex, pathTemplateToRegex } from '../../src/openapi/index.js';

const miniSpec = readFileSync('tests/fixtures/mini-openapi.yml', 'utf8');
const index = buildPublicApiIndex(miniSpec);

describe('buildPublicApiIndex', () => {
  it('indexes every operation in the spec', () => {
    expect(index.operations).toHaveLength(6);
  });

  it('keeps a null operationId rather than inventing one', () => {
    expect(index.operations.some((o) => o.operationId === null)).toBe(true);
  });

  it('carries tags through', () => {
    expect(index.lookup('GET', '/v3/contacts')?.tags).toEqual(['Contacts']);
  });

  it('throws when the document has no paths', () => {
    expect(() => buildPublicApiIndex('openapi: 3.0.1\ninfo:\n  title: x\n')).toThrow(/paths/i);
  });
});

describe('lookup', () => {
  it('matches a concrete path against a templated one', () => {
    expect(index.lookup('GET', '/v3/contacts/42')?.pathTemplate).toBe('/contacts/{identifier}');
    expect(index.lookup('GET', '/v3/contacts/a%40b.com')?.operationId).toBeTypeOf('string');
  });

  it('does not match a path with an extra segment', () => {
    expect(index.lookup('GET', '/v3/contacts/42/extra')).toBeNull();
  });

  it('prefers an exact literal path over a templated match', () => {
    expect(index.lookup('GET', '/v3/contacts/lists')?.pathTemplate).toBe('/contacts/lists');
  });

  it('is method-sensitive', () => {
    expect(index.lookup('DELETE', '/v3/contacts/42')).toBeNull();
  });

  it('matches regardless of method case', () => {
    expect(index.lookup('get', '/v3/contacts')?.operationId).toBe('getContacts');
  });

  it('works on a path given without the /v3 server prefix', () => {
    expect(index.lookup('GET', '/contacts')?.operationId).toBe('getContacts');
  });

  it('works on a full url', () => {
    expect(index.lookup('GET', 'https://api.brevo.com/v3/contacts')?.operationId).toBe(
      'getContacts',
    );
  });

  it('ignores a query string', () => {
    expect(index.lookup('GET', '/v3/contacts?limit=10')?.operationId).toBe('getContacts');
  });

  it('returns null for an unknown path', () => {
    expect(index.lookup('GET', '/v3/nothing/here')).toBeNull();
  });

  it('collects enum values for a parameter', () => {
    expect(index.lookup('GET', '/v3/contacts')?.enums).toHaveProperty('sort');
    expect(index.lookup('GET', '/v3/contacts')?.enums.sort).toEqual(['asc', 'desc']);
  });

  it('collects enum values from request body properties', () => {
    expect(index.lookup('POST', '/v3/contacts')?.enums.smtpBlacklistSender).toEqual([
      'transactional',
      'marketing',
    ]);
  });

  it('collects required request body fields', () => {
    expect(index.lookup('POST', '/v3/contacts')?.required).toContain('email');
  });

  it('collects required path parameters', () => {
    expect(index.lookup('GET', '/v3/contacts/42')?.required).toContain('identifier');
  });

  it('does not report optional parameters as required', () => {
    expect(index.lookup('GET', '/v3/contacts')?.required).not.toContain('limit');
  });
});

describe('pathTemplateToRegex', () => {
  it('replaces a template parameter with a single-segment wildcard', () => {
    expect(pathTemplateToRegex('/contacts/{id}').test('/contacts/42')).toBe(true);
  });

  it('anchors both ends, so an extra segment does not match', () => {
    expect(pathTemplateToRegex('/contacts/{id}').test('/contacts/42/extra')).toBe(false);
    expect(pathTemplateToRegex('/contacts/{id}').test('/x/contacts/42')).toBe(false);
  });

  it('does not match an empty segment', () => {
    expect(pathTemplateToRegex('/contacts/{id}').test('/contacts/')).toBe(false);
  });

  it('escapes regex metacharacters in literal segments', () => {
    expect(pathTemplateToRegex('/a.b/{id}').test('/axb/1')).toBe(false);
    expect(pathTemplateToRegex('/a.b/{id}').test('/a.b/1')).toBe(true);
  });
});
