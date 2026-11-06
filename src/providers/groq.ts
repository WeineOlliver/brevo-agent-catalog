/**
 * Groq adapter — the breadth pass.
 *
 * OpenAI-compatible chat completions. Fast and cheap enough to run across every
 * discovered route; the free tier's rate limits are paced by the caller.
 */

import type { CompletionRequest, LlmProvider } from './types.js';

const ENDPOINT = 'https://api.groq.com/openai/v1/chat/completions';

type GroqResponse = {
  choices?: { message?: { content?: unknown } }[];
  error?: { message?: unknown };
};

export function createGroqProvider(opts: {
  apiKey: string;
  model: string;
  fetchImpl?: typeof fetch;
}): LlmProvider {
  const doFetch = opts.fetchImpl ?? fetch;

  return {
    name: `groq:${opts.model}`,

    async complete(request: CompletionRequest): Promise<string> {
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

      const payload = (await response.json().catch(() => ({}))) as GroqResponse;

      if (!response.ok) {
        const detail =
          typeof payload.error?.message === 'string' ? `: ${payload.error.message}` : '';
        throw new Error(`Groq request failed with HTTP ${response.status}${detail}`);
      }

      const content = payload.choices?.[0]?.message?.content;
      if (typeof content !== 'string') {
        throw new Error('Groq response carried no choice content');
      }

      return content;
    },
  };
}
