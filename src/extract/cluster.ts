/**
 * Captures -> action candidates.
 *
 * A crawl of a real SaaS app records far more noise than signal: analytics
 * beacons, session polling, asset fetches. What survives here is what a user
 * action actually caused.
 */

import type { CaptureRecord } from '../capture/types.js';
import { normalizeRoute } from '../crawl/links.js';
import { isBrevoHost } from '../util/hosts.js';
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

/** Third-party telemetry that tells us nothing about Brevo's capabilities. */
const VENDOR_HOSTS =
  /(?:segment\.(?:io|com)|datadoghq|sentry\.io|intercom|hotjar|google-analytics|googletagmanager|doubleclick|facebook\.(?:net|com)|fullstory|mixpanel|amplitude|launchdarkly|pusher|cloudflareinsights)/i;

/** Methods the catalog schema can express. Anything else cannot be drafted. */
const SCHEMA_METHODS = new Set<string>(HTTP_METHODS);

/**
 * Brevo-owned hosts that serve application chrome and telemetry rather than
 * anything a user does: the sidebar's credit counters, in-app banners,
 * notification lists, analytics relays. Measured on the first real crawl, these
 * were a large share of all candidates and not one of them is a business action.
 */
const CHROME_HOSTS =
  /^(?:sidebar-backend|notifications?-banner-api|marketing-notification|dt|metrics|get|fsrelay|rum|ph)\./i;

/**
 * Beacon paths that appear on product hosts too.
 *
 * `log-event` is here because it is served by `crm-backend-api`, a genuine
 * product backend: the host cannot be excluded, only the path. Measured on the
 * exploration run, where it and a PostHog flag poll were the only Brevo-owned
 * telemetry that reached this filter.
 */
const BEACON_PATH =
  /^\/(?:cdn-cgi|g\/collect|collect|banner-info|pr\/|events?\/collect|flags\b)|\/log-events?\b/i;

const ASSET_PATH = /\.(?:css|js|mjs|map|woff2?|ttf|eot|svg|png|jpe?g|gif|webp|ico|avif)$/i;

const READ_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

function hostOf(url: string): string | null {
  try {
    return new URL(url).hostname;
  } catch {
    return null;
  }
}

function pathOf(url: string): string {
  try {
    return new URL(url).pathname;
  } catch {
    const queryAt = url.indexOf('?');
    return queryAt === -1 ? url : url.slice(0, queryAt);
  }
}

function isNoise(record: CaptureRecord): boolean {
  const host = hostOf(record.url);
  if (host === null) return true;

  // Keep anything Brevo owns — api.brevo.com calls are the app's own traffic.
  if (!isBrevoHost(record.url)) return true;
  if (VENDOR_HOSTS.test(host)) return true;
  if (CHROME_HOSTS.test(host)) return true;
  if (ASSET_PATH.test(pathOf(record.url))) return true;
  if (BEACON_PATH.test(pathOf(record.url))) return true;

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
