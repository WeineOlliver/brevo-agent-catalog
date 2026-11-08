import { describe, expect, it, vi } from 'vitest';
import { withDeadline } from '../../src/util/deadline.js';

describe('withDeadline', () => {
  it('returns the value when the work finishes in time', async () => {
    await expect(withDeadline(Promise.resolve('ok'), 50, 'fallback')).resolves.toBe('ok');
  });

  it('returns the fallback when the work outlives the deadline', async () => {
    const forever = new Promise<string>(() => {});
    await expect(withDeadline(forever, 20, 'fallback')).resolves.toBe('fallback');
  });

  it('returns the fallback when the work rejects, so one bad route cannot abort a run', async () => {
    await expect(withDeadline(Promise.reject(new Error('boom')), 50, 'fallback')).resolves.toBe(
      'fallback',
    );
  });

  it('reports whether the deadline was hit', async () => {
    const onTimeout = vi.fn();
    await withDeadline(new Promise<string>(() => {}), 20, 'fallback', onTimeout);
    expect(onTimeout).toHaveBeenCalledOnce();
  });

  it('does not report a timeout for work that finished', async () => {
    const onTimeout = vi.fn();
    await withDeadline(Promise.resolve('ok'), 50, 'fallback', onTimeout);
    expect(onTimeout).not.toHaveBeenCalled();
  });

  it('hands the caller the error it swallowed', async () => {
    // Two extraction runs reported "the provider failed" when the adapter had
    // said "HTTP 429, retry after 60s". The fallback behaviour is deliberate;
    // losing the reason was not.
    const onError = vi.fn();
    const failing = Promise.reject(new Error('Groq request failed with HTTP 429'));
    expect(await withDeadline(failing, 50, 'fallback', undefined, onError)).toBe('fallback');
    expect(onError).toHaveBeenCalledTimes(1);
    expect(String(onError.mock.calls[0]?.[0])).toContain('HTTP 429');
  });

  it('does not report an error when the work merely timed out', async () => {
    // The two outcomes have different remedies, so a caller must be able to
    // tell them apart: a timeout is waited out, a 401 ends the run.
    const onError = vi.fn();
    const onTimeout = vi.fn();
    const never = new Promise<string>(() => {});
    expect(await withDeadline(never, 10, 'fallback', onTimeout, onError)).toBe('fallback');
    expect(onTimeout).toHaveBeenCalledTimes(1);
    expect(onError).not.toHaveBeenCalled();
  });

  it('clears its timer so a finished call cannot hold the process open', async () => {
    const pending = vi.spyOn(global, 'clearTimeout');
    await withDeadline(Promise.resolve('ok'), 50, 'fallback');
    expect(pending).toHaveBeenCalled();
    pending.mockRestore();
  });
});
