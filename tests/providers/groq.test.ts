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

  it('throws an error naming the status on a non-retryable response', async () => {
    const { impl } = stubFetch(400, { error: { message: 'bad request' } });
    await expect(
      createGroqProvider({ apiKey: 'k', model: 'm', fetchImpl: impl }).complete({
        system: 's',
        user: 'u',
      }),
    ).rejects.toThrow(/400/);
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

  it('retries a 429 after the Retry-After delay and then succeeds', async () => {
    let calls = 0;
    const waits: number[] = [];
    const impl = (async () => {
      calls += 1;
      if (calls === 1) {
        return new Response(JSON.stringify({ error: { message: 'rate limited' } }), {
          status: 429,
          headers: { 'retry-after': '3' },
        });
      }
      return new Response(JSON.stringify(ok), { status: 200 });
    }) as unknown as typeof fetch;

    const result = await createGroqProvider({
      apiKey: 'k',
      model: 'm',
      fetchImpl: impl,
      sleep: async (ms) => void waits.push(ms),
    }).complete({ system: 's', user: 'u' });

    expect(result).toBe('hello');
    expect(calls).toBe(2);
    expect(waits[0]).toBeGreaterThanOrEqual(3000);
  });

  it('backs off without a Retry-After header', async () => {
    let calls = 0;
    const waits: number[] = [];
    const impl = (async () => {
      calls += 1;
      return calls < 3
        ? new Response('{}', { status: 429 })
        : new Response(JSON.stringify(ok), { status: 200 });
    }) as unknown as typeof fetch;

    await createGroqProvider({
      apiKey: 'k',
      model: 'm',
      fetchImpl: impl,
      sleep: async (ms) => void waits.push(ms),
    }).complete({ system: 's', user: 'u' });

    expect(calls).toBe(3);
    expect(waits.length).toBe(2);
    expect(waits[1]).toBeGreaterThan(waits[0] ?? 0);
  });

  it('gives up after the retry budget and reports the rate limit', async () => {
    const impl = (async () => new Response('{}', { status: 429 })) as unknown as typeof fetch;
    await expect(
      createGroqProvider({
        apiKey: 'k',
        model: 'm',
        fetchImpl: impl,
        sleep: async () => undefined,
        maxRetries: 2,
      }).complete({ system: 's', user: 'u' }),
    ).rejects.toThrow(/429/);
  });

  it('does not retry a 404, which will never succeed', async () => {
    let calls = 0;
    const impl = (async () => {
      calls += 1;
      return new Response(JSON.stringify({ error: { message: 'no such model' } }), { status: 404 });
    }) as unknown as typeof fetch;

    await expect(
      createGroqProvider({ apiKey: 'k', model: 'm', fetchImpl: impl, sleep: async () => undefined })
        .complete({ system: 's', user: 'u' }),
    ).rejects.toThrow(/404/);
    expect(calls).toBe(1);
  });

  it('names itself so the ledger and reports can say which model drafted an entry', () => {
    expect(createGroqProvider({ apiKey: 'k', model: 'test-model' }).name).toContain('test-model');
  });
});

describe('a request that never answers', () => {
  it('aborts the attempt instead of waiting forever', async () => {
    // The failure that cost eighty minutes: no status code, so none of the
    // retry checks above can see it. Without a signal, `fetch` never returns
    // and the five retries never engage.
    let calls = 0;
    const hangs: typeof fetch = (_url, init) => {
      calls += 1;
      return new Promise((_resolve, reject) => {
        init?.signal?.addEventListener('abort', () => reject(new Error('aborted')));
      });
    };

    const provider = createGroqProvider({
      apiKey: 'k',
      model: 'm',
      fetchImpl: hangs,
      timeoutMs: 20,
      maxRetries: 2,
      sleep: async () => {},
    });

    await expect(provider.complete({ system: 's', user: 'u' })).rejects.toThrow(/failed/i);
    // Every attempt was made, which is the point: it retried rather than hung.
    expect(calls).toBe(3);
  });

  it('passes an abort signal on every attempt', async () => {
    const signals: (AbortSignal | null | undefined)[] = [];
    const ok: typeof fetch = (_url, init) => {
      signals.push(init?.signal);
      return Promise.resolve(
        new Response(JSON.stringify({ choices: [{ message: { content: 'x' } }] }), {
          status: 200,
        }),
      );
    };

    const provider = createGroqProvider({ apiKey: 'k', model: 'm', fetchImpl: ok });
    await provider.complete({ system: 's', user: 'u' });
    expect(signals).toHaveLength(1);
    expect(signals[0]).toBeInstanceOf(AbortSignal);
  });
});
