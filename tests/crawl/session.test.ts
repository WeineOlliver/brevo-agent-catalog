import { describe, expect, it } from 'vitest';
import { waitForSignIn } from '../../src/crawl/session.js';

/** A page whose url advances through a script, one entry per poll. */
function scriptedPage(urls: string[]) {
  let index = 0;
  return {
    url: () => urls[Math.min(index++, urls.length - 1)] ?? '',
  };
}

const withCookies = { cookies: async () => [{ name: 'sib', value: 'x' }] };
const noCookies = { cookies: async () => [] };

const fast = {
  timeoutMs: 100,
  pollIntervalMs: 10,
  sleep: async () => undefined,
  now: (() => {
    let t = 0;
    return () => (t += 10);
  })(),
};

describe('waitForSignIn', () => {
  it('detects the app once the page leaves the sign-in screen', async () => {
    const page = scriptedPage([
      'https://login.brevo.com/?target=x',
      'https://login.brevo.com/?target=x',
      'https://app.brevo.com/',
    ]);
    expect(await waitForSignIn(page, withCookies, { ...fast, now: Date.now })).toBe('detected');
  });

  it('keeps waiting while the page is still on a sign-in url', async () => {
    const page = scriptedPage(['https://login.brevo.com/']);
    let polls = 0;
    const result = await waitForSignIn(page, withCookies, {
      timeoutMs: 50,
      pollIntervalMs: 10,
      sleep: async () => undefined,
      onPoll: () => {
        polls += 1;
      },
    });
    expect(result).toBe('timeout');
    expect(polls).toBeGreaterThan(1);
  });

  it('does not claim success on an app url with no cookies', async () => {
    const page = scriptedPage(['https://app.brevo.com/']);
    expect(
      await waitForSignIn(page, noCookies, {
        timeoutMs: 30,
        pollIntervalMs: 10,
        sleep: async () => undefined,
      }),
    ).toBe('timeout');
  });

  it('ignores a non-brevo host', async () => {
    const page = scriptedPage(['https://example.com/']);
    expect(
      await waitForSignIn(page, withCookies, {
        timeoutMs: 30,
        pollIntervalMs: 10,
        sleep: async () => undefined,
      }),
    ).toBe('timeout');
  });

  it('survives an unparseable url', async () => {
    const page = scriptedPage(['not a url']);
    expect(
      await waitForSignIn(page, withCookies, {
        timeoutMs: 30,
        pollIntervalMs: 10,
        sleep: async () => undefined,
      }),
    ).toBe('timeout');
  });

  it('reports each polled url, so the operator can see what it is looking at', async () => {
    const page = scriptedPage(['https://login.brevo.com/', 'https://app.brevo.com/']);
    const seen: string[] = [];
    await waitForSignIn(page, withCookies, {
      timeoutMs: 100,
      pollIntervalMs: 10,
      sleep: async () => undefined,
      onPoll: (url) => seen.push(url),
    });
    expect(seen[0]).toContain('login.brevo.com');
  });
});
