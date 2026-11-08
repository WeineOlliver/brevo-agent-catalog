/**
 * Deriving a flow's steps from the capture, so a flow cannot drift into fiction.
 *
 * The steps of a flow are not authored. They are the write calls Brevo's own UI
 * made while a human performed the task once, in the order it made them, read
 * back out of the sanitized capture. `pnpm validate` re-derives every flow and
 * fails on any difference, which makes a flow file a claim about evidence
 * rather than a claim about memory.
 *
 * Two deliberate filters, and both are judgement rather than fact, so they are
 * named here instead of buried in a regex:
 *
 * 1. **The listing refresh.** Every mutation in the contacts UI is followed by
 *    `/segment/count`, `/segment/query` and `/segment/paginated_count` — the
 *    grid reloading itself. They are writes only because Brevo reads over POST
 *    (the same fact that broke the method-derived risk rule, decision #12).
 *    Counting them would make a six-step flow fifteen steps of noise.
 * 2. **Consecutive repeats.** Three `PATCH /contacts/update` in a row is one
 *    person editing three fields in a form, not three steps. Repeats that are
 *    separated by a different call are kept, because that is a real loop.
 */

export type CaptureRecord = {
  method: string;
  route: string;
  url: string;
  capturedAt: string;
};

export type EndpointRef = {
  id: string;
  method: string;
  /** Internal endpoint template, e.g. `/contact/backend/contacts/:id`. */
  path: string;
};

const WRITE_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

/**
 * Reads over POST that the contacts grid fires after every mutation.
 *
 * Action ids rather than raw routes: the catalog already decided what these
 * endpoints are, and a route list here would be a second source of truth.
 */
export const LISTING_REFRESH_ACTIONS = new Set([
  'segments.get_count',
  'segments.query_contacts',
  'segments.count_paginated',
]);

/** `/a/:id/b` matches `/a/42/b`, and a parameter never spans a `/`. */
export function templateToRegex(template: string): RegExp {
  const literals = template
    .split(/:[A-Za-z_][A-Za-z0-9_]*/)
    .map((part) => part.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
  return new RegExp(`^${literals.join('[^/]+')}$`);
}

/**
 * Picks the catalog action a captured request belongs to.
 *
 * Several templates can match one concrete path, so the most specific wins:
 * fewest parameters first, then the longest template. A literal segment is
 * evidence about which endpoint was called; a parameter is a wildcard.
 */
export function resolveAction(
  method: string,
  route: string,
  endpoints: EndpointRef[],
): string | null {
  const hits = endpoints.filter(
    (entry) => entry.method === method && templateToRegex(entry.path).test(route),
  );
  if (hits.length === 0) return null;

  const [best] = [...hits].sort((a, b) => {
    const params = (a.path.match(/:/g) ?? []).length - (b.path.match(/:/g) ?? []).length;
    return params !== 0 ? params : b.path.length - a.path.length;
  });
  return best?.id ?? null;
}

export type DeriveWindow = { from: string; to: string };

export type DerivedSteps = {
  actionIds: string[];
  /** Writes inside the window that no catalog entry claims. Should be empty. */
  unmatched: { method: string; route: string }[];
};

/** The time-of-day part of an ISO timestamp, which is what a window compares. */
function timeOf(capturedAt: string): string {
  return capturedAt.slice(11, 19);
}

export function deriveFlowSteps(
  records: CaptureRecord[],
  window: DeriveWindow,
  endpoints: EndpointRef[],
): DerivedSteps {
  const actionIds: string[] = [];
  const unmatched: { method: string; route: string }[] = [];

  for (const record of records) {
    const time = timeOf(record.capturedAt);
    if (time < window.from || time > window.to) continue;
    if (!WRITE_METHODS.has(record.method)) continue;
    if (!record.url.includes('brevo.com')) continue;

    const id = resolveAction(record.method, record.route, endpoints);
    if (id === null) {
      unmatched.push({ method: record.method, route: record.route });
      continue;
    }
    if (LISTING_REFRESH_ACTIONS.has(id)) continue;
    if (actionIds[actionIds.length - 1] === id) continue;

    actionIds.push(id);
  }

  return { actionIds, unmatched };
}
