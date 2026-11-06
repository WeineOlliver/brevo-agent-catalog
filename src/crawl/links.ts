/**
 * Navigation discovery.
 *
 * `normalizeRoute` is what keeps the BFS frontier finite: without collapsing
 * id-bearing segments, every contact and every campaign is its own "route" and
 * the crawl never terminates.
 */

const HREF_PATTERN = /<a\b[^>]*?\bhref\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s">]+))/gi;

const EXCLUDED_SCHEMES = /^(?:mailto|tel|javascript|data|blob):/i;

/**
 * Paths that leave the authenticated application, so never followed.
 *
 * Logging out ends the session outright. Password-reset and sign-up links are
 * just as fatal in practice: they redirect to `login.brevo.com`, which the
 * crawler reads — correctly — as an expired session, aborting the entire run.
 */
const LEAVES_APP =
  /(?:log|sign)[-_]?out|^\/logout\b|forgot[-_]?password|reset[-_]?password|(?:^|\/)sign[-_]?up\b|(?:^|\/)register\b|(?:^|\/)login\b|(?:^|\/)signin\b/i;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const LONG_HEX = /^[0-9a-f]{12,}$/i;
const NUMERIC = /^\d+$/;
/** Brevo keys contacts by email, so an address is an identifier here. */
const EMAILISH = /@/;
/** A sanitizer placeholder, raw or percent-encoded. */
const PLACEHOLDER = /\{\{|%7B%7B/i;

function isIdentifierSegment(segment: string): boolean {
  return (
    NUMERIC.test(segment) ||
    UUID.test(segment) ||
    LONG_HEX.test(segment) ||
    EMAILISH.test(segment) ||
    PLACEHOLDER.test(segment)
  );
}

/** Hosts that only ever serve authentication, never the application. */
const SIGNIN_HOSTS = /^(?:login|onboarding|account-app)\./i;

/**
 * Sign-in paths, anchored to the start of the path so an application route that
 * merely contains one of these words — `/senders/verify` is a real product
 * action — is not mistaken for an auth screen.
 *
 * The second-factor group matters as much as the first: Brevo sends a new device
 * to `/2fa/login/new-device/...` on app.brevo.com, and without it the wait
 * declares success while the operator is still typing a code.
 */
const SIGNIN_PATH =
  /^\/(?:login|signin|sign-in|account\/login|forgot-password|reset-password|signup|register|2fa|otp|mfa|two-factor|twofactor|challenge|authenticator|verify|verification|confirm-email)(?:\/|$)/i;

/**
 * Whether a url is an authentication page rather than the application.
 *
 * The crawler checks this on **every** route including the first. Skipping the
 * first route is how an expired session reports as a successful one-route crawl
 * instead of failing loudly — which is strictly worse than crashing.
 */
export function isSignInUrl(url: string): boolean {
  try {
    const parsed = new URL(url);
    return SIGNIN_HOSTS.test(parsed.hostname) || SIGNIN_PATH.test(parsed.pathname);
  } catch {
    return false;
  }
}

export function extractNavLinks(html: string, origin: string): string[] {
  const found = new Set<string>();
  const originUrl = new URL(origin);

  for (let m = HREF_PATTERN.exec(html); m !== null; m = HREF_PATTERN.exec(html)) {
    const raw = (m[1] ?? m[2] ?? m[3] ?? '').trim();
    if (raw.length === 0) continue;
    if (raw.startsWith('#')) continue;
    if (EXCLUDED_SCHEMES.test(raw)) continue;

    let resolved: URL;
    try {
      resolved = new URL(raw, origin);
    } catch {
      continue;
    }

    if (resolved.origin !== originUrl.origin) continue;
    if (LEAVES_APP.test(resolved.pathname)) continue;

    found.add(`${resolved.origin}${resolved.pathname}${resolved.search}`);
  }

  return [...found];
}

/** Collapses a url to a stable route key, with id-bearing segments masked. */
export function normalizeRoute(urlOrPath: string): string {
  let path: string;
  try {
    path = new URL(urlOrPath).pathname;
  } catch {
    const queryAt = urlOrPath.indexOf('?');
    path = queryAt === -1 ? urlOrPath : urlOrPath.slice(0, queryAt);
  }

  const masked = path
    .split('/')
    .map((segment) => (isIdentifierSegment(segment) ? ':id' : segment))
    .join('/');

  const trimmed = masked.replace(/\/+$/, '');
  return trimmed.length === 0 ? '/' : trimmed;
}
