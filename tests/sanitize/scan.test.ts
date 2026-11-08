import { describe, expect, it } from 'vitest';
import { redactText } from '../../src/sanitize/redact.js';
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
    // These are fixtures, not credentials: every body is literally
    // "abcdefghijklmnopqrstuvwx". They are here because a capture can carry a
    // pasted example from somebody else's documentation, and the gate should
    // stop it.
    //
    // They also tripped GitHub's own push protection, which blocked the first
    // push of this repository on a "Stripe API Key" and a "Slack API Token" at
    // these lines. That is the inherent shape of the problem rather than a
    // mistake on either side: the test suite of a secret detector is, by
    // construction, a file full of secret-shaped strings, so it sets off every
    // other detector that reads it. Resolved as the false positive it is.
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

  it('finds a percent-encoded address', () => {
    const kinds = scanForLeaks('?email=someone%40gmail.com', empty).map((l) => l.kind);
    expect(kinds).toContain('email');
  });

  it('still forgives a reserved domain when the address is encoded', () => {
    // The fixtures this project creates are all @example.com, and they reach
    // query strings encoded. Reporting them would train the operator to
    // ignore the gate.
    expect(scanForLeaks('?email=catalog.test%40example.com', empty)).toEqual([]);
  });

  it('finds a phone number under an attribute key', () => {
    const kinds = scanForLeaks('{"SMS":"5511972929773"}', empty).map((l) => l.kind);
    expect(kinds).toContain('phone');
  });

  it('passes the real create-contact body once the redactor has run', () => {
    // The gate's whole job: what sanitize is about to write must come back
    // clean. This is the body that proved the redactor had no phone rule.
    const body =
      '{"email":"tonystark@example.com","attributes":{"SMS":"5511972929773",' +
      '"WHATSAPP":"5511972929773","LANDLINE_NUMBER":"5511972929773","JOB_TITLE":"CEO"}}';
    expect(scanForLeaks(body, empty).map((l) => l.kind)).toContain('phone');
    expect(scanForLeaks(redactText(body, empty), empty)).toEqual([]);
  });

  it('does not flag an epoch timestamp as a phone number', () => {
    expect(scanForLeaks('{"capturedAt":1762500000000}', empty)).toEqual([]);
  });

  it('finds several leaks of different kinds in one document', () => {
    const kinds = scanForLeaks(
      '{"to":"a@b.com","key":"xkeysib-0123456789abcdef0123"}',
      empty,
    ).map((l) => l.kind);
    expect(new Set(kinds)).toEqual(new Set(['email', 'api_key']));
  });
});
