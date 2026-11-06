/**
 * Navigation discovery.
 *
 * `normalizeRoute` is what keeps the BFS frontier finite: without collapsing
 * id-bearing segments, every contact and every campaign is its own "route" and
 * the crawl never terminates.
 */

const HREF_PATTERN = /<a\b[^>]*?\bhref\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s">]+))/gi;

const EXCLUDED_SCHEMES = /^(?:mailto|tel|javascript|data|blob):/i;

/** Paths that would end the authenticated session, so never followed. */
const SESSION_ENDING = /(?:log|sign)[-_]?out|^\/logout\b/i;

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
    if (SESSION_ENDING.test(resolved.pathname)) continue;

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
