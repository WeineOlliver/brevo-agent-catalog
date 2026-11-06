/**
 * Secret shapes, shared by the redactor and the scan gate only as *source
 * text* — each module compiles its own copies, because a `g`-flagged RegExp
 * carries mutable `lastIndex` state and sharing one instance across two
 * callers silently skips matches.
 */

/** Brevo api keys. */
export const API_KEY_SOURCE = '\\bxkeysib-[A-Za-z0-9_-]{10,}\\b';

/** Three dot-separated base64url segments beginning with a JSON header. */
export const JWT_SOURCE = '\\beyJ[A-Za-z0-9_-]{5,}\\.[A-Za-z0-9_-]{2,}\\.[A-Za-z0-9_-]{4,}\\b';

/** `key=value` / `"key": "value"` for names that imply a credential. */
export const SECRET_ASSIGNMENT_SOURCE =
  '((?:api[-_]?key|access[-_]?token|refresh[-_]?token|id[-_]?token|token|secret|password|passwd|bearer)["\']?\\s*[:=]\\s*["\']?)([A-Za-z0-9._~+/=-]{8,})';

/** A cookie header and its value. */
export const COOKIE_SOURCE = '(?:set-)?cookie\\s*:\\s*\\S+';

export const EMAIL_SOURCE = '[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\\.[A-Za-z]{2,}';

/** Request and response headers removed wholesale rather than redacted. */
export const DROPPED_HEADERS = new Set(['cookie', 'set-cookie', 'authorization']);

/** Header names matching this are also dropped. */
export const DROPPED_HEADER_PATTERN = /^x-csrf/i;

export function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
