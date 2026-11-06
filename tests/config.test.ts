import { describe, expect, it } from 'vitest';
import { loadConfig } from '../src/config.js';

describe('loadConfig', () => {
  it('returns null groqApiKey when GROQ_API_KEY is unset', () => {
    expect(loadConfig({}).groqApiKey).toBeNull();
  });

  it('reads GROQ_API_KEY from the environment', () => {
    expect(loadConfig({ GROQ_API_KEY: 'test-key' }).groqApiKey).toBe('test-key');
  });

  it('defaults appOrigin to https://app.brevo.com', () => {
    expect(loadConfig({}).appOrigin).toBe('https://app.brevo.com');
  });

  it('defaults openApiUrl to the published Brevo spec', () => {
    expect(loadConfig({}).openApiUrl).toBe(
      'https://api.brevo.com/v3/swagger_definition_v3.yml',
    );
  });

  it('exposes the pipeline paths', () => {
    expect(loadConfig({}).paths).toEqual({
      raw: 'captures/raw',
      clean: 'captures/clean',
      actions: 'actions',
      data: 'data',
      auth: '.auth',
    });
  });

  it('returns empty redaction lists when nothing is configured', () => {
    expect(loadConfig({}).redact).toEqual({ emails: [], accountIds: [] });
  });

  it('splits REDACT_EMAILS on commas and trims each entry', () => {
    expect(loadConfig({ REDACT_EMAILS: 'a@b.com, c@d.com' }).redact.emails).toEqual([
      'a@b.com',
      'c@d.com',
    ]);
  });

  it('ignores empty entries in a redaction list', () => {
    expect(loadConfig({ REDACT_ACCOUNT_IDS: '998877,,  ,112233' }).redact.accountIds).toEqual([
      '998877',
      '112233',
    ]);
  });
});
