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

/**
 * `key=value` / `"key": "value"` for names that imply a credential.
 *
 * The session and CSRF names matter as much as the obvious ones: an app's
 * bootstrap XHR routinely echoes its own session value in a JSON body under
 * `sid`, `_csrf` or `jsessionid`, where no header rule would ever see it.
 */
export const SECRET_ASSIGNMENT_SOURCE =
  '((?:api[-_]?key|access[-_]?token|refresh[-_]?token|id[-_]?token|token|secret|password|passwd|bearer|' +
  'cookie|sid|sess|session|session[-_]?id|jsessionid|phpsessid|csrf|csrf[-_]?token|xsrf|_csrf|' +
  'nonce|auth|authorization|signature|sig|private[-_]?key|client[-_]?secret)["\']?[ \\t]*[:=][ \\t]*["\']?)' +
  '([A-Za-z0-9._~+/=-]{8,})';

/**
 * A value that is an expression rather than a literal — `config.groqApiKey`,
 * `env.GROQ_API_KEY`. Source code passing a credential around is not a leak,
 * and flagging it is how a gate earns a reputation for crying wolf.
 */
export const CODE_REFERENCE_VALUE = /^[A-Za-z_$][\w$]*(?:\.[A-Za-z_$][\w$]*)+$/;

/** A cookie header and its value. */
export const COOKIE_SOURCE = '(?:set-)?cookie\\s*:\\s*\\S+';

/** A bare `name=value; Path=/` cookie pair with no header prefix. */
export const COOKIE_PAIR_SOURCE =
  '\\b[A-Za-z0-9_-]{2,}=[A-Za-z0-9._~+/=-]{8,}\\s*;\\s*(?:Path|Domain|Expires|Max-Age|Secure|HttpOnly|SameSite)\\b';

/**
 * Other vendors' key shapes. Nothing in this pipeline produces them, but a
 * pasted example in a document or a prompt is the realistic leak for a project
 * like this, and the gate should not be blind to it.
 */
export const FOREIGN_KEY_SOURCE =
  '(?:AKIA[0-9A-Z]{16}|ghp_[A-Za-z0-9]{20,}|gho_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{20,}|' +
  'sk_live_[A-Za-z0-9]{16,}|rk_live_[A-Za-z0-9]{16,}|xox[baprs]-[A-Za-z0-9-]{10,}|' +
  'sk-ant-[A-Za-z0-9_-]{16,}|gsk_[A-Za-z0-9]{20,}|' +
  '-----BEGIN (?:RSA |EC |OPENSSH |PGP )?PRIVATE KEY-----)';

export const EMAIL_SOURCE = '[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\\.[A-Za-z]{2,}';

/** Request and response headers removed wholesale rather than redacted. */
export const DROPPED_HEADERS = new Set(['cookie', 'set-cookie', 'authorization']);

/** Header names matching this are also dropped. */
export const DROPPED_HEADER_PATTERN = /^x-csrf/i;

/** A substitution this pipeline already made. Never a leak. */
export const PLACEHOLDER_PATTERN = /\{\{[A-Z_]+\}\}/;

export function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
