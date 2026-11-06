/**
 * Serial rate limiter.
 *
 * The crawl is capped at one request per second against someone else's
 * production service. Calls run in submission order, spaced by at least
 * `minIntervalMs`, and a rejection does not stall the queue behind it.
 */

export type Limiter = <T>(fn: () => Promise<T>) => Promise<T>;

export function createLimiter(minIntervalMs: number): Limiter {
  let chain: Promise<unknown> = Promise.resolve();
  let previousStart = 0;

  return <T>(fn: () => Promise<T>): Promise<T> => {
    const run = async (): Promise<T> => {
      const wait = previousStart + minIntervalMs - Date.now();
      if (wait > 0) await new Promise((resolve) => setTimeout(resolve, wait));
      previousStart = Date.now();
      return fn();
    };

    // The queue advances whether or not this call settled successfully.
    const result = chain.then(run, run);
    chain = result.then(
      () => undefined,
      () => undefined,
    );
    return result;
  };
}
