/**
 * The catalog index.
 *
 * One small file a consumer loads to see everything available, with the
 * confidence and the risk flag on each entry, and without the full input
 * schemas. An agent reads this, picks an id, then reads that one entry.
 */

import { VERIFICATION_STATUSES, type Action, type VerificationStatus } from '../types.js';

export type CatalogIndexEntry = {
  id: string;
  module: string;
  name: string;
  description: string;
  status: VerificationStatus;
  destructive: boolean;
};

export type CatalogIndex = {
  generated_at: string;
  count: number;
  by_status: Record<VerificationStatus, number>;
  actions: CatalogIndexEntry[];
};

export function buildIndex(actions: Action[]): CatalogIndex {
  const seen = new Map<string, string>();
  for (const action of actions) {
    const previous = seen.get(action.id);
    if (previous !== undefined) {
      throw new Error(
        `Duplicate action id "${action.id}": already defined by "${previous}". ` +
          'Two captures produced the same id; give one of them a distinct verb_object.',
      );
    }
    seen.set(action.id, action.name);
  }

  const by_status = Object.fromEntries(
    VERIFICATION_STATUSES.map((status) => [status, 0]),
  ) as Record<VerificationStatus, number>;

  for (const action of actions) by_status[action.verification.status] += 1;

  const entries: CatalogIndexEntry[] = actions
    .map((action) => ({
      id: action.id,
      module: action.module,
      name: action.name,
      description: action.description,
      status: action.verification.status,
      destructive: action.destructive,
    }))
    .sort((a, b) => a.id.localeCompare(b.id));

  return {
    generated_at: new Date().toISOString(),
    count: actions.length,
    by_status,
    actions: entries,
  };
}
