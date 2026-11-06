/**
 * Sanitization.
 *
 * Two rules govern everything here:
 *
 * 1. Redaction is by *shape, wherever it occurs* — in a URL query string, in a
 *    header value, nested arbitrarily deep in a body. Looking only in known
 *    header names and top-level body keys is how secrets escape.
 * 2. Identifiers are replaced with structure-preserving placeholders, never
 *    removed, so `internal_endpoint.body_example` stays usable by an agent.
 *
 * Text is treated as text throughout: bodies are routinely truncated mid-JSON,
 * so nothing here parses them.
 */

import type { CaptureRecord } from '../capture/types.js';
import {
  API_KEY_SOURCE,
  COOKIE_PAIR_SOURCE,
  COOKIE_SOURCE,
  DROPPED_HEADERS,
  DROPPED_HEADER_PATTERN,
  EMAIL_SOURCE,
  FOREIGN_KEY_SOURCE,
  JWT_SOURCE,
  SECRET_ASSIGNMENT_SOURCE,
  escapeRegExp,
} from './patterns.js';

export type RedactionRules = {
  /** Real email addresses belonging to the capture account. */
  emails: string[];
  /** Real account, list, campaign or template identifiers. */
  accountIds: string[];
};

type PlaceholderKind =
  | 'ACCOUNT_ID'
  | 'LIST_ID'
  | 'CAMPAIGN_ID'
  | 'TEMPLATE_ID'
  | 'CONTACT_ID'
  | 'ID';

/**
 * Picks a placeholder from the nearest preceding JSON key or URL path segment,
 * so `{"listIds":[7]}` yields LIST_ID and `/account/998877` yields ACCOUNT_ID.
 */
function placeholderKind(context: string): PlaceholderKind {
  let hint = '';
  let hintAt = -1;

  const keyPattern = /"([A-Za-z0-9_]+)"\s*:/g;
  for (let m = keyPattern.exec(context); m !== null; m = keyPattern.exec(context)) {
    hint = m[1] ?? '';
    hintAt = m.index;
  }

  const segmentPattern = /\/([A-Za-z0-9_-]+)\/?$/.exec(context);
  if (segmentPattern && segmentPattern.index > hintAt) {
    hint = segmentPattern[1] ?? '';
  }

  if (/list/i.test(hint)) return 'LIST_ID';
  if (/campaign/i.test(hint)) return 'CAMPAIGN_ID';
  if (/template/i.test(hint)) return 'TEMPLATE_ID';
  if (/contact/i.test(hint)) return 'CONTACT_ID';
  if (/account|user|company|organi[sz]ation/i.test(hint)) return 'ACCOUNT_ID';
  return 'ID';
}

/**
 * True when the identifier sits as a bare JSON value (`:7`, `[7`, `,7`), where
 * substituting a placeholder would leave the document unparseable unless the
 * replacement is quoted.
 */
function needsQuoting(context: string): boolean {
  const tail = context.replace(/\s+$/, '');
  if (tail.endsWith('"')) return false;
  return /[:[,]$/.test(tail);
}

function redactIdentifiers(text: string, ids: string[]): string {
  let out = text;
  for (const id of ids) {
    if (id.length === 0) continue;
    // Word-boundary guards stop `998877` matching inside `1998877123`.
    const pattern = new RegExp(`(?<![0-9A-Za-z_])${escapeRegExp(id)}(?![0-9A-Za-z_])`, 'g');
    out = out.replace(pattern, (_match, offset: number, whole: string) => {
      const context = whole.slice(Math.max(0, offset - 120), offset);
      const token = `{{${placeholderKind(context)}}}`;
      return needsQuoting(context) ? `"${token}"` : token;
    });
  }
  return out;
}

export function redactText(text: string, rules: RedactionRules): string {
  let out = text;

  // Shaped credentials first, so later passes only ever see placeholders.
  out = out.replace(new RegExp(JWT_SOURCE, 'g'), '{{TOKEN}}');
  out = out.replace(new RegExp(API_KEY_SOURCE, 'g'), '{{API_KEY}}');
  out = out.replace(new RegExp(FOREIGN_KEY_SOURCE, 'g'), '{{API_KEY}}');
  out = out.replace(new RegExp(COOKIE_PAIR_SOURCE, 'gi'), '{{COOKIE}}');
  out = out.replace(new RegExp(SECRET_ASSIGNMENT_SOURCE, 'gi'), '$1{{TOKEN}}');
  out = out.replace(new RegExp(COOKIE_SOURCE, 'gi'), 'cookie: {{COOKIE}}');

  // Any email-shaped string, not only the configured ones.
  out = out.replace(new RegExp(EMAIL_SOURCE, 'g'), '{{EMAIL}}');

  out = redactIdentifiers(out, rules.accountIds);

  return out;
}

function redactHeaders(
  headers: Record<string, string>,
  rules: RedactionRules,
): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [name, value] of Object.entries(headers)) {
    if (DROPPED_HEADERS.has(name) || DROPPED_HEADER_PATTERN.test(name)) continue;
    out[name] = redactText(value, rules);
  }
  return out;
}

export function redactCapture(record: CaptureRecord, rules: RedactionRules): CaptureRecord {
  return {
    ...record,
    route: redactText(record.route, rules),
    url: redactText(record.url, rules),
    requestHeaders: redactHeaders(record.requestHeaders, rules),
    responseHeaders: redactHeaders(record.responseHeaders, rules),
    requestBody: record.requestBody === null ? null : redactText(record.requestBody, rules),
    responseBody: record.responseBody === null ? null : redactText(record.responseBody, rules),
  };
}
