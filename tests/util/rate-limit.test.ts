import { describe, expect, it } from 'vitest';
import { createLimiter } from '../../src/util/rate-limit.js';

describe('createLimiter', () => {
  it('spaces successive calls by at least the minimum interval', async () => {
    const limit = createLimiter(50);
    const t0 = Date.now();
    await Promise.all([limit(async () => 1), limit(async () => 2), limit(async () => 3)]);
    expect(Date.now() - t0).toBeGreaterThanOrEqual(100);
  });

  it("preserves each call's resolved value", async () => {
    const limit = createLimiter(1);
    expect(await Promise.all([limit(async () => 1), limit(async () => 2), limit(async () => 3)])).toEqual(
      [1, 2, 3],
    );
  });

  it('runs calls in the order they were submitted', async () => {
    const limit = createLimiter(1);
    const order: number[] = [];
    await Promise.all([1, 2, 3].map((n) => limit(async () => void order.push(n))));
    expect(order).toEqual([1, 2, 3]);
  });

  it('propagates a rejection without stalling later calls', async () => {
    const limit = createLimiter(1);
    const failed = limit(async () => {
      throw new Error('boom');
    });
    await expect(failed).rejects.toThrow('boom');
    await expect(limit(async () => 'after')).resolves.toBe('after');
  });

  it('does not delay a single call beyond its own work', async () => {
    const limit = createLimiter(1000);
    const t0 = Date.now();
    await limit(async () => 'only');
    expect(Date.now() - t0).toBeLessThan(900);
  });
});
