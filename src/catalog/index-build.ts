/**
 * The catalog index.
 *
 * One small file a consumer loads to see everything available, with the
 * confidence and the risk flag on each entry, and without the full input
 * schemas. An agent reads this, picks an id, then reads that one entry.
 *
 * Each entry carries both groupings, because they answer different questions.
 * `module` is the first segment of an internal URL: it says which Brevo service
 * serves the call, which is useful when reading the capture and useless when
 * looking for a feature. `area` is one of nine boxes named after what a person
 * does in the app, so an agent can narrow to "the campaign stuff" without
 * knowing that sending one campaign crosses three services. See areas.ts.
 */

import { VERIFICATION_STATUSES, type Action, type VerificationStatus } from '../types.js';
import { AREAS, areaOf, type AreaId } from './areas.js';

export type CatalogIndexEntry = {
  id: string;
  module: string;
  /** User-facing grouping. See areas.ts for why `module` is not enough. */
  area: AreaId;
  name: string;
  description: string;
  status: VerificationStatus;
  destructive: boolean;
};

export type CatalogIndex = {
  generated_at: string;
  count: number;
  by_status: Record<VerificationStatus, number>;
  by_area: Record<AreaId, number>;
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

  const by_area = Object.fromEntries(AREAS.map((area) => [area.id, 0])) as Record<
    AreaId,
    number
  >;

  const entries: CatalogIndexEntry[] = actions
    .map((action) => {
      const area = areaOf(action);
      if (area === null) {
        // Deliberately fatal. A silent fallback would grow the catch-all into
        // the largest box in the taxonomy without anyone choosing that, and the
        // grouping would stop meaning anything the first time a new module
        // appeared.
        throw new Error(
          `Action "${action.id}" has module "${action.module}", which is not in ` +
            'MODULE_AREA. Add it to src/catalog/areas.ts and decide which area it belongs to.',
        );
      }
      by_area[area] += 1;

      return {
        id: action.id,
        module: action.module,
        area,
        name: action.name,
        description: action.description,
        status: action.verification.status,
        destructive: action.destructive,
      };
    })
    .sort((a, b) => a.id.localeCompare(b.id));

  return {
    generated_at: new Date().toISOString(),
    count: actions.length,
    by_status,
    by_area,
    actions: entries,
  };
}
