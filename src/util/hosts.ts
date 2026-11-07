/**
 * Which traffic counts as Brevo's product surface.
 *
 * Two questions, deliberately separate:
 *
 * `isBrevoHost` — is this host Brevo's at all? Verification needs it, because a
 * third-party widget answering the same path would otherwise be enough to stamp
 * an action `verified`.
 *
 * `isAppTraffic` — is this a request the product made to do something a user
 * asked for? Clustering needs it to drop beacons, and the interactive runs need
 * it to count writes. Those two had drifted: extraction filtered telemetry while
 * the runs printed raw non-GET totals, so an exploration that submitted no form
 * at all reported "437 write requests" — Clarity, Amplitude, LinkedIn, FullStory
 * and Cloudflare challenge beacons. A number that cannot distinguish a working
 * pass from a broken one is worse than no number, so both now ask this.
 */

const BREVO_HOSTS = /(?:\.|^)(?:brevo\.com|sendinblue\.com)$/i;

/** Third-party telemetry that tells us nothing about Brevo's capabilities. */
const VENDOR_HOSTS =
  /(?:segment\.(?:io|com)|datadoghq|sentry\.io|intercom|hotjar|google-analytics|googletagmanager|doubleclick|facebook\.(?:net|com)|fullstory|mixpanel|amplitude|launchdarkly|pusher|cloudflareinsights)/i;

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

export function isBrevoHost(url: string): boolean {
  try {
    return BREVO_HOSTS.test(new URL(url).hostname);
  } catch {
    return false;
  }
}

/**
 * A request to Brevo's product surface: Brevo's own host, not a telemetry or
 * chrome host, not a beacon path, not a static asset.
 *
 * Says nothing about the method, the status or the body — those are questions
 * about whether a *candidate* is draftable, and they belong to the extractor.
 */
export function isAppTraffic(url: string): boolean {
  if (!isBrevoHost(url)) return false;

  let host: string;
  let path: string;
  try {
    const parsed = new URL(url);
    host = parsed.hostname;
    path = parsed.pathname;
  } catch {
    return false;
  }

  if (VENDOR_HOSTS.test(host)) return false;
  if (CHROME_HOSTS.test(host)) return false;
  if (BEACON_PATH.test(path)) return false;
  if (ASSET_PATH.test(path)) return false;

  return true;
}

const READ_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

/**
 * A request that changed something, as far as the catalog is concerned.
 *
 * The method test alone is not enough: Brevo reads through POST in several
 * places (`segment/count`, `segment/query`, `segment/paginated_count`), and
 * telemetry is almost all POST. This is the predicate the runs report on.
 */
export function isWriteTraffic(url: string, method: string): boolean {
  return isAppTraffic(url) && !READ_METHODS.has(method.toUpperCase());
}
