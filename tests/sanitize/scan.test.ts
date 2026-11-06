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

  it('does not flag RFC 2606 documentation addresses', () => {
    expect(scanForLeaks('{"to":"john@example.com"}', empty)).toEqual([]);
    expect(scanForLeaks('a@example.org and b@example.net', empty)).toEqual([]);
    expect(scanForLeaks('c@host.test and d@thing.invalid', empty)).toEqual([]);
  });

  it('still flags a real-looking address alongside a documentation one', () => {
    const leaks = scanForLeaks('john@example.com and real.person@gmail.com', empty);
    expect(leaks).toHaveLength(1);
    expect(leaks[0]?.match).toBe('real.person@gmail.com');
  });

  it('finds a session value under a key the credential list did not originally cover', () => {
    for (const body of [
      '{"Cookie":"sib_session=abc123def456ghi789"}',
      '{"sid":"9f8a7b6c5d4e3f2a1b0c"}',
      '{"_csrf":"aB3dEfGh1jKlMnOpQrStUvWx"}',
      '{"sessionid":"9f8a7b6c5d4e3f2a"}',
      '{"jsessionid":"A1B2C3D4E5F6A7B8"}',
      '?auth=aB3dEfGh1jKlMnOpQrSt',
      '?signature=aB3dEfGh1jKlMnOpQrSt',
      '{"nonce":"aB3dEfGh1jKlMnOpQrSt"}',
    ]) {
      expect(scanForLeaks(body, empty), body).not.toEqual([]);
    }
  });

  it('finds a bare cookie name=value pair with no header prefix', () => {
    expect(
      scanForLeaks('sessionid=9f8a7b6c5d4e3f2a1b0c; Path=/; HttpOnly', empty),
    ).not.toEqual([]);
  });

  it('finds other vendors’ key shapes, which a pasted example would carry', () => {
    for (const secret of [
      'AKIAIOSFODNN7EXAMPLE',
      'ghp_abcdefghijklmnopqrstuvwxyz0123456789',
      'sk_live_abcdefghijklmnopqrstuvwx',
      'xoxb-123456789012-123456789012-abcdefghijklmnopqrstuvwx',
      '-----BEGIN RSA PRIVATE KEY-----',
    ]) {
      expect(scanForLeaks(secret, empty), secret).not.toEqual([]);
    }
  });

  it('does not let an empty assignment swallow the next line', () => {
    // `.env.example` is a template of empty keys; a separator matching across a
    // newline makes the following line look like the value.
    expect(scanForLeaks('GROQ_API_KEY=\nGROQ_MODEL=\n', empty)).toEqual([]);
    expect(scanForLeaks('token:\nsomething_else=1\n', empty)).toEqual([]);
  });

  it('does not flag source code that merely passes a credential around', () => {
    // `apiKey: config.groqApiKey` is a property assignment, not a secret.
    expect(scanForLeaks('apiKey: config.groqApiKey', empty)).toEqual([]);
    expect(scanForLeaks('groqApiKey: env.GROQ_API_KEY ?? null', empty)).toEqual([]);
    expect(scanForLeaks('Authorization: `Bearer ${opts.apiKey}`', empty)).toEqual([]);
  });

  it('still flags a quoted literal assigned to a credential key', () => {
    expect(scanForLeaks('apiKey: "xkeysib-0123456789abcdef0123"', empty)).not.toEqual([]);
    expect(scanForLeaks('token = "aB3dEfGh1jKlMnOpQrSt"', empty)).not.toEqual([]);
  });

  it('does not flag a placeholder the redactor itself produced', () => {
    expect(scanForLeaks('cookie: {{COOKIE}}', empty)).toEqual([]);
    expect(scanForLeaks('{"token":"{{TOKEN}}","key":"{{API_KEY}}"}', empty)).toEqual([]);
    expect(scanForLeaks('{"sid":"{{TOKEN}}"}', empty)).toEqual([]);
  });

  it('flags a configured email even on a reserved domain, because it is really ours', () => {
    expect(
      scanForLeaks('weine@example.com', { accountIds: [], emails: ['weine@example.com'] }).map(
        (l) => l.kind,
      ),
    ).toContain('email');
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
