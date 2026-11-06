/**
 * Catalog normalisation.
 *
 * Two problems the first real extraction produced, both of which make an agent
 * pick the wrong action:
 *
 * 1. **Two ids for one endpoint.** `deals.list` and `deals.list_for_contact`
 *    were both `GET /crm/backend/deals`. An agent choosing between synonyms is
 *    choosing at random.
 * 2. **Singular and plural module names side by side** — `organization` and
 *    `organizations`, `feature` and `features`. The model names a module per
 *    endpoint; a catalog needs one name per product area.
 *
 * Both are resolved from the catalog itself rather than from a hardcoded list,
 * so the rule keeps working as coverage grows.
 */

import type { Action } from '../types.js';

export type MergeRecord = { endpoint: string; kept: string; dropped: string };
export type RenameRecord = { from: string; to: string };

export type NormalizeResult = {
  actions: Action[];
  merged: MergeRecord[];
  renamed: RenameRecord[];
};

function endpointKey(action: Action): string | null {
  const endpoint = action.internal_endpoint;
  if (endpoint === null) return null;
  return `${endpoint.method} ${endpoint.path}`;
}

function countByModule(actions: Action[]): Map<string, number> {
  const counts = new Map<string, number>();
  for (const action of actions) {
    counts.set(action.module, (counts.get(action.module) ?? 0) + 1);
  }
  return counts;
}

/**
 * Builds alias -> canonical for singular/plural module pairs that both occur.
 * The more populated spelling wins; a tie goes to the plural, which is how the
 * rest of the catalog's collection modules are named.
 */
export function canonicalModules(actions: Action[]): Map<string, string> {
  const counts = countByModule(actions);
  const aliases = new Map<string, string>();

  for (const singular of counts.keys()) {
    const plural = `${singular}s`;
    if (!counts.has(plural)) continue;

    const singularCount = counts.get(singular) ?? 0;
    const pluralCount = counts.get(plural) ?? 0;

    if (pluralCount > singularCount) aliases.set(singular, plural);
    else if (singularCount > pluralCount) aliases.set(plural, singular);
    else aliases.set(singular, plural);
  }

  return aliases;
}

/** Prefers the entry from the busier module, then the fuller description. */
function pickBetter(a: Action, b: Action, moduleCounts: Map<string, number>): [Action, Action] {
  const byModule = (moduleCounts.get(b.module) ?? 0) - (moduleCounts.get(a.module) ?? 0);
  if (byModule !== 0) return byModule > 0 ? [b, a] : [a, b];

  const byDescription = b.description.length - a.description.length;
  if (byDescription !== 0) return byDescription > 0 ? [b, a] : [a, b];

  return a.id <= b.id ? [a, b] : [b, a];
}

export function normalizeCatalog(input: Action[]): NormalizeResult {
  const moduleCounts = countByModule(input);

  // Merge duplicate endpoints first, so module counts used for renaming
  // reflect the deduplicated catalog.
  const byEndpoint = new Map<string, Action>();
  const standalone: Action[] = [];
  const merged: MergeRecord[] = [];

  for (const action of input) {
    const key = endpointKey(action);
    if (key === null) {
      standalone.push(action);
      continue;
    }

    const existing = byEndpoint.get(key);
    if (existing === undefined) {
      byEndpoint.set(key, action);
      continue;
    }

    const [kept, dropped] = pickBetter(existing, action, moduleCounts);
    byEndpoint.set(key, kept);
    merged.push({ endpoint: key, kept: kept.id, dropped: dropped.id });
  }

  const deduped = [...byEndpoint.values(), ...standalone];

  const aliases = canonicalModules(deduped);
  const renamed: RenameRecord[] = [];
  const taken = new Set(deduped.map((action) => action.id));

  const actions = deduped.map((action) => {
    const canonical = aliases.get(action.module);
    if (canonical === undefined) return action;

    const verb = action.id.slice(action.module.length + 1);
    const candidate = `${canonical}.${verb}`;

    // Renaming must never collide with an id that already exists.
    if (candidate !== action.id && taken.has(candidate)) return action;

    taken.delete(action.id);
    taken.add(candidate);
    if (candidate !== action.id) renamed.push({ from: action.id, to: candidate });

    return { ...action, id: candidate, module: canonical };
  });

  actions.sort((a, b) => a.id.localeCompare(b.id));
  return { actions, merged, renamed };
}
