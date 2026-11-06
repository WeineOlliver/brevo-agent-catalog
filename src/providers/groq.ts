/**
 * Groq adapter — the breadth pass.
 *
 * OpenAI-compatible chat completions. Fast and cheap enough to run across every
 * discovered route.
 *
 * The free tier rate-limits on tokens per minute, not requests, so pacing the
 * caller is not enough on its own: this retries a 429 and honours the server's
 * own `Retry-After`. Measured on a real run, 97 of 126 drafts failed without it.
 */

import type { CompletionRequest, LlmProvider } from './types.js';

const ENDPOINT = 'https://api.groq.com/openai/v1/chat/completions';

const DEFAULT_MAX_RETRIES = 5;
const BASE_BACKOFF_MS = 2000;
const MAX_BACKOFF_MS = 60_000;

type GroqResponse = {
  choices?: { message?: { content?: unknown } }[];
  error?: { message?: unknown };
};

const defaultSleep = (ms: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, ms));

/** Status codes worth retrying: rate limits and transient server faults. */
function isRetryable(status: number): boolean {
  return status === 429 || status === 408 || status >= 500;
}

function backoffFor(response: Response, attempt: number): number {
  const header = response.headers.get('retry-after');
  if (header !== null) {
    const seconds = Number(header);
    if (Number.isFinite(seconds) && seconds > 0) {
      return Math.min(seconds * 1000 + 250, MAX_BACKOFF_MS);
    }
  }
  return Math.min(BASE_BACKOFF_MS * 2 ** attempt, MAX_BACKOFF_MS);
}

export function createGroqProvider(opts: {
  apiKey: string;
  model: string;
  fetchImpl?: typeof fetch;
  sleep?: (ms: number) => Promise<void>;
  maxRetries?: number;
}): LlmProvider {
  const doFetch = opts.fetchImpl ?? fetch;
  const sleep = opts.sleep ?? defaultSleep;
  const maxRetries = opts.maxRetries ?? DEFAULT_MAX_RETRIES;

  return {
    name: `groq:${opts.model}`,

    async complete(request: CompletionRequest): Promise<string> {
      let lastError = '';

      for (let attempt = 0; attempt <= maxRetries; attempt += 1) {
        const response = await doFetch(ENDPOINT, {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${opts.apiKey}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            model: opts.model,
            messages: [
              { role: 'system', content: request.system },
              { role: 'user', content: request.user },
            ],
            ...(request.maxTokens === undefined ? {} : { max_tokens: request.maxTokens }),
          }),
        });

        if (response.ok) {
          const payload = (await response.json().catch(() => ({}))) as GroqResponse;
          const content = payload.choices?.[0]?.message?.content;
          if (typeof content !== 'string') {
            throw new Error('Groq response carried no choice content');
          }
          return content;
        }

        const payload = (await response.json().catch(() => ({}))) as GroqResponse;
        const detail =
          typeof payload.error?.message === 'string' ? `: ${payload.error.message}` : '';
        lastError = `Groq request failed with HTTP ${response.status}${detail}`;

        // A 404 or a 400 will never succeed on retry; only wait for the ones
        // that might.
        if (!isRetryable(response.status) || attempt === maxRetries) break;

        await sleep(backoffFor(response, attempt));
      }

      throw new Error(lastError);
    },
  };
}
