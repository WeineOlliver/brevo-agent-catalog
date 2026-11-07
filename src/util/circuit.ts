/**
 * A circuit breaker for a stage that calls a provider in a loop.
 *
 * Bounding one call is not enough. Extraction calls a rate-limited provider
 * once per candidate, and each call may retry five times honouring a
 * `Retry-After` of up to a minute: 136 candidates can therefore spend hours
 * without a single technical hang, and every one of those hours is spent
 * learning the same fact — the provider is not answering right now.
 *
 * So consecutive failures trip the stage. The threshold counts *consecutive*
 * failures rather than total, because a catalog of real traffic always produces
 * a few candidates no model can draft, and those must not end a run that is
 * otherwise working. One success resets it.
 */

export type Breaker = {
  /** Records a failure and returns whether the circuit is now open. */
  fail(): boolean;
  /** Records a success, closing the circuit again. */
  succeed(): void;
  /** True once `limit` failures have happened with no success between them. */
  readonly open: boolean;
  /** The current consecutive-failure count, for the run's own report. */
  readonly consecutive: number;
};

export function createBreaker(limit: number): Breaker {
  if (!Number.isInteger(limit) || limit < 1) {
    throw new Error(`a breaker limit must be a positive integer, got ${limit}`);
  }

  let consecutive = 0;

  return {
    fail(): boolean {
      consecutive += 1;
      return consecutive >= limit;
    },
    succeed(): void {
      consecutive = 0;
    },
    get open(): boolean {
      return consecutive >= limit;
    },
    get consecutive(): number {
      return consecutive;
    },
  };
}
