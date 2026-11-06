import { describe, expect, it } from 'vitest';
import { scanForLeaks } from '../../src/sanitize/scan.js';

const empty = { accountIds: [], emails: [] };

describe('scanForLeaks', () => {
  it('finds a Brevo api key shape', () => {
    expect(scanForLeaks('xkeysib-0123456789abcdef0123', empty).map((l) => l.kind)).toContain(
      'api_key',
    );
  });

  it('finds a JWT shape', () => {
    expect(
      scanForLeaks('eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxIn0.abcdefgh', empty).map((l) => l.kind),
    ).toContain('jwt');
  });

  it('finds a cookie assignment', () => {
    expect(scanForLeaks('Cookie: sid=abc123def456', empty).map((l) => l.kind)).toContain('cookie');
  });

  it('finds an email address', () => {
    expect(scanForLeaks('{"to":"real.person@gmail.com"}', empty).map((l) => l.kind)).toContain(
      'email',
    );
  });

  it('finds a configured account id', () => {
    expect(
      scanForLeaks('acct 998877', { accountIds: ['998877'], emails: [] }).map((l) => l.kind),
    ).toContain('account_id');
  });

  it('returns no leaks for already-redacted text', () => {
    expect(scanForLeaks('{"email":"{{EMAIL}}","list":"{{LIST_ID}}"}', empty)).toEqual([]);
  });

  it('returns no leaks for ordinary content', () => {
    expect(scanForLeaks('{"name":"Promo campaign","status":"draft"}', empty)).toEqual([]);
  });

  it('reports the matched text so a failure is actionable', () => {
    const leaks = scanForLeaks('xkeysib-0123456789abcdef0123', empty);
    expect(leaks[0]?.match).toContain('xkeysib-');
  });

  it('finds several leaks of different kinds in one document', () => {
    const kinds = scanForLeaks(
      '{"to":"a@b.com","key":"xkeysib-0123456789abcdef0123"}',
      empty,
    ).map((l) => l.kind);
    expect(new Set(kinds)).toEqual(new Set(['email', 'api_key']));
  });
});
