/**
 * Captures -> action candidates.
 *
 * A crawl of a real SaaS app records far more noise than signal: analytics
 * beacons, session polling, asset fetches. What survives here is what a user
 * action actually caused.
 */

import type { CaptureRecord } from '../capture/types.js';
import { normalizeRoute } from '../crawl/links.js';
import { isAppTraffic } from '../util/hosts.js';
import { HTTP_METHODS } from '../types.js';

export type ActionCandidate = {
  /** `METHOD /normalized/path` — the cluster key. */
  key: string;
  /** The application route this was first seen on. */
  route: string;
  method: string;
  pathTemplate: string;
  samples: CaptureRecord[];
};

const MAX_SAMPLES = 3;

/** Methods the catalog schema can express. Anything else cannot be drafted. */
const SCHEMA_METHODS = new Set<string>(HTTP_METHODS);

const READ_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

function pathOf(url: string): string {
  try {
    return new URL(url).pathname;
  } catch {
    const queryAt = url.indexOf('?');
    return queryAt === -1 ? url : url.slice(0, queryAt);
  }
}

/**
 * A request the operator made to mark where one flow ended and the next began
 * during a hand-driven HAR session: fetch('/mark_03_create_list') from the
 * console, which 404s and leaves a timestamped line in the log.
 *
 * It must never reach the extractor. It is app-origin, it is a GET, it returns
 * a body, and it carries a path that reads exactly like a feature — so a model
 * asked to draft an action for it writes a confident, entirely fabricated
 * entry. That happened: six of them, with invented outputs, from one session.
 * An endpoint the operator invented is the one kind of traffic in this store
 * that is guaranteed not to be part of the product.
 */
const OPERATOR_MARKER = /^\/_*mark_\d+(?:_|$)/i;

function isNoise(record: CaptureRecord): boolean {
  if (OPERATOR_MARKER.test(pathOf(record.url))) return true;

  // Brevo's own product surface only: beacons, chrome hosts and assets are
  // not business actions. Shared with the interactive runs so the write count
  // they print is the write count this extractor will act on.
  if (!isAppTraffic(record.url)) return true;

  // HEAD and OPTIONS are reads to us but are not in the schema's method enum,
  // so every draft for one is rejected after two provider calls. Drop them here
  // rather than burning a rate-limited budget on a guaranteed failure.
  if (!SCHEMA_METHODS.has(record.method)) return true;

  // A server error tells us nothing reliable about the action's contract.
  if (record.status >= 500) return true;

  // A read that returned nothing is polling, not a business action. A write
  // with no body is still a write worth cataloguing.
  if (READ_METHODS.has(record.method) && (record.responseBody ?? '') === '') return true;

  return false;
}

export function clusterCaptures(records: CaptureRecord[]): ActionCandidate[] {
  const byKey = new Map<string, ActionCandidate>();

  for (const record of records) {
    if (isNoise(record)) continue;

    const pathTemplate = normalizeRoute(pathOf(record.url));
    const key = `${record.method} ${pathTemplate}`;

    const existing = byKey.get(key);
    if (existing) {
      if (existing.samples.length < MAX_SAMPLES) existing.samples.push(record);
      continue;
    }

    byKey.set(key, {
      key,
      route: record.route,
      method: record.method,
      pathTemplate,
      samples: [record],
    });
  }

  return [...byKey.values()];
}
