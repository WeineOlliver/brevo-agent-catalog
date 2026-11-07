/**
 * Throwaway fixtures for the sanctioned write passes.
 *
 * Every value is namespaced. That prefix is the enforcement point for the
 * mutation bounds: the harness may delete anything it created, and nothing
 * else, so "did we create this?" must never be a judgement call.
 */

import { randomBytes } from 'node:crypto';
import type { Page } from 'playwright';

export const FIXTURE_PREFIX = 'catalog-test-';

export type FixtureBag = {
  /** A fresh, syntactically valid address, namespaced. */
  email(): string;
  /** A fresh list or campaign name, namespaced. */
  listName(): string;
/**
   * Every name this bag handed out.
   *
   * A name here was *used*, not necessarily created: the bag records it the
   * moment it is generated, before anything is typed or submitted. An
   * exploration run once reported sixteen created lists while no list-creation
   * request existed in any capture, because a silently failed click still
   * consumed a name. What was really created is in the captured traffic, which
   * is what the runs now report; this list is for cleanup, where guessing wide
   * is the safe direction.
   */
  names: string[];
};

export function createFixtureBag(seed = randomBytes(3).toString('hex')): FixtureBag {
  let counter = 0;
  const names: string[] = [];

  const next = (value: string): string => {
    counter += 1;
    names.push(value);
    return value;
  };

  return {
    email: () => next(`${FIXTURE_PREFIX}${seed}-${counter + 1}@example.com`),
    listName: () => next(`${FIXTURE_PREFIX}${seed}-list-${counter + 1}`),
    names,
  };
}

/**
 * One module's write pass. Each pass drives the real UI with the recorder
 * attached, so the request bodies, enums and validation errors behind write
 * actions are captured rather than inferred.
 */
export type InteractionPass = {
  module: string;
  run(page: Page, fx: FixtureBag): Promise<void>;
};
