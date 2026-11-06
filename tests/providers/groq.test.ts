import { describe, expect, it } from 'vitest';
import { createGroqProvider } from '../../src/providers/groq.js';

type FetchCall = { url: string; init: RequestInit };

function stubFetch(status: number, body: unknown) {
  const calls: FetchCall[] = [];
  const impl = (async (url: string | URL | Request, init?: RequestInit) => {
    calls.push({ url: String(url), init: init ?? {} });
    return new Response(JSON.stringify(body), {
      status,
      headers: { 'content-type': 'application/json' },
    });
  }) as unknown as typeof fetch;
  return { impl, calls };
}

const ok = { choices: [{ message: { content: 'hello' } }] };

describe('createGroqProvider', () => {
  it('posts to the Groq chat completions endpoint with the model and bearer key', async () => {
    const { impl, calls } = stubFetch(200, ok);
    await createGroqProvider({ apiKey: 'k-123', model: 'test-model', fetchImpl: impl }).complete({
      system: 'sys',
      user: 'usr',
    });

    expect(calls[0]?.url).toBe('https://api.groq.com/openai/v1/chat/completions');
    expect(calls[0]?.init.method).toBe('POST');
    const headers = calls[0]?.init.headers as Record<string, string>;
    expect(headers.Authorization).toBe('Bearer k-123');
    const sent = JSON.parse(String(calls[0]?.init.body)) as {
      model: string;
      messages: { role: string; content: string }[];
    };
    expect(sent.model).toBe('test-model');
    expect(sent.messages).toEqual([
      { role: 'system', content: 'sys' },
      { role: 'user', content: 'usr' },
    ]);
  });

  it('returns the first choice message content', async () => {
    const { impl } = stubFetch(200, ok);
    const result = await createGroqProvider({
      apiKey: 'k',
      model: 'm',
      fetchImpl: impl,
    }).complete({ system: 's', user: 'u' });
    expect(result).toBe('hello');
  });

  it('throws an error naming the status on a non-2xx response', async () => {
    const { impl } = stubFetch(429, { error: { message: 'rate limited' } });
    await expect(
      createGroqProvider({ apiKey: 'k', model: 'm', fetchImpl: impl }).complete({
        system: 's',
        user: 'u',
      }),
    ).rejects.toThrow(/429/);
  });

  it('throws when the response carries no choices', async () => {
    const { impl } = stubFetch(200, { choices: [] });
    await expect(
      createGroqProvider({ apiKey: 'k', model: 'm', fetchImpl: impl }).complete({
        system: 's',
        user: 'u',
      }),
    ).rejects.toThrow(/choice/i);
  });

  it('passes maxTokens through when given', async () => {
    const { impl, calls } = stubFetch(200, ok);
    await createGroqProvider({ apiKey: 'k', model: 'm', fetchImpl: impl }).complete({
      system: 's',
      user: 'u',
      maxTokens: 512,
    });
    expect(JSON.parse(String(calls[0]?.init.body)).max_tokens).toBe(512);
  });

  it('names itself so the ledger and reports can say which model drafted an entry', () => {
    expect(createGroqProvider({ apiKey: 'k', model: 'test-model' }).name).toContain('test-model');
  });
});
