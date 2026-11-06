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

  it('clears its timer so a finished call cannot hold the process open', async () => {
    const pending = vi.spyOn(global, 'clearTimeout');
    await withDeadline(Promise.resolve('ok'), 50, 'fallback');
    expect(pending).toHaveBeenCalled();
    pending.mockRestore();
  });
});
