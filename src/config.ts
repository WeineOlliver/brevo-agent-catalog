/**
 * Runtime configuration, read from the environment.
 *
 * `loadConfig` takes the environment as an argument so it can be exercised
 * without mutating globals.
 */

export type { RedactionRules } from './sanitize/redact.js';
import type { RedactionRules } from './sanitize/redact.js';

export type Config = {
  groqApiKey: string | null;
  groqModel: string;
  claudeBin: string;
  appOrigin: string;
  openApiUrl: string;
  redact: RedactionRules;
  paths: {
    raw: string;
    clean: string;
    actions: string;
    data: string;
    auth: string;
  };
};

const DEFAULT_GROQ_MODEL = 'openai/gpt-oss-120b';
const DEFAULT_APP_ORIGIN = 'https://app.brevo.com';
const DEFAULT_OPENAPI_URL = 'https://api.brevo.com/v3/swagger_definition_v3.yml';

/** Splits a comma-separated environment value, dropping blank entries. */
function splitList(value: string | undefined): string[] {
  if (!value) return [];
  return value
    .split(',')
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0);
}

/**
 * An environment value, or null when it is absent *or blank*.
 *
 * `.env.example` ships every key with an empty value, so `??` is the wrong
 * operator here: an empty string is defined, and passing it through produced a
 * request for the model named "".
 */
function value(raw: string | undefined): string | null {
  const trimmed = raw?.trim() ?? '';
  return trimmed.length > 0 ? trimmed : null;
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  return {
    groqApiKey: value(env.GROQ_API_KEY),
    groqModel: value(env.GROQ_MODEL) ?? DEFAULT_GROQ_MODEL,
    claudeBin: value(env.CLAUDE_BIN) ?? 'claude',
    appOrigin: value(env.BREVO_APP_ORIGIN) ?? DEFAULT_APP_ORIGIN,
    openApiUrl: value(env.BREVO_OPENAPI_URL) ?? DEFAULT_OPENAPI_URL,
    redact: {
      emails: splitList(env.REDACT_EMAILS),
      accountIds: splitList(env.REDACT_ACCOUNT_IDS),
    },
    paths: {
      raw: 'captures/raw',
      clean: 'captures/clean',
      actions: 'actions',
      data: 'data',
      auth: '.auth',
    },
  };
}
