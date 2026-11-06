import { describe, expect, it } from 'vitest';
import { loadConfig } from '../src/config.js';

describe('loadConfig', () => {
  it('returns null groqApiKey when GROQ_API_KEY is unset', () => {
    expect(loadConfig({}).groqApiKey).toBeNull();
  });

  it('reads GROQ_API_KEY from the environment', () => {
    expect(loadConfig({ GROQ_API_KEY: 'test-key' }).groqApiKey).toBe('test-key');
  });

  it('treats an empty GROQ_API_KEY as absent, not as a key', () => {
    // .env.example ships every value empty, so this is the state anyone who
    // copies it starts from.
    expect(loadConfig({ GROQ_API_KEY: '' }).groqApiKey).toBeNull();
    expect(loadConfig({ GROQ_API_KEY: '   ' }).groqApiKey).toBeNull();
  });

  it('treats an empty GROQ_MODEL as unset and uses the default', () => {
    expect(loadConfig({ GROQ_MODEL: '' }).groqModel).toBe(loadConfig({}).groqModel);
    expect(loadConfig({ GROQ_MODEL: '' }).groqModel.length).toBeGreaterThan(0);
  });

  it('treats every other empty override as unset', () => {
    const empty = loadConfig({ BREVO_APP_ORIGIN: '', BREVO_OPENAPI_URL: '', CLAUDE_BIN: '' });
    expect(empty.appOrigin).toBe('https://app.brevo.com');
    expect(empty.openApiUrl).toContain('swagger_definition_v3.yml');
    expect(empty.claudeBin).toBe('claude');
  });

  it('trims a configured value', () => {
    expect(loadConfig({ GROQ_MODEL: '  some-model  ' }).groqModel).toBe('some-model');
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
