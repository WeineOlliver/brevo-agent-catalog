/**
 * Runtime configuration, read from the environment.
 *
 * `loadConfig` takes the environment as an argument so it can be exercised
 * without mutating globals.
 */

export type RedactionRules = {
  /** Real email addresses belonging to the capture account. */
  emails: string[];
  /** Real account, list, campaign or template identifiers to replace. */
  accountIds: string[];
};

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

const DEFAULT_GROQ_MODEL = 'llama-3.3-70b-versatile';
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

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  return {
    groqApiKey: env.GROQ_API_KEY ?? null,
    groqModel: env.GROQ_MODEL ?? DEFAULT_GROQ_MODEL,
    claudeBin: env.CLAUDE_BIN ?? 'claude',
    appOrigin: env.BREVO_APP_ORIGIN ?? DEFAULT_APP_ORIGIN,
    openApiUrl: env.BREVO_OPENAPI_URL ?? DEFAULT_OPENAPI_URL,
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
