/**
 * The leak gate.
 *
 * Deliberately an independent second opinion: it re-derives the patterns rather
 * than asking the redactor what it would have replaced. A gate implemented by
 * calling the thing it is checking cannot fail.
 */

import {
  API_KEY_SOURCE,
  CODE_REFERENCE_VALUE,
  COOKIE_PAIR_SOURCE,
  COOKIE_SOURCE,
  EMAIL_ENCODED_SOURCE,
  EMAIL_SOURCE,
  FOREIGN_KEY_SOURCE,
  JWT_SOURCE,
  PHONE_ASSIGNMENT_SOURCE,
  PHONE_E164_SOURCE,
  PLACEHOLDER_PATTERN,
  SECRET_ASSIGNMENT_SOURCE,
  escapeRegExp,
} from './patterns.js';
import type { RedactionRules } from './redact.js';

export type LeakKind = 'api_key' | 'jwt' | 'cookie' | 'email' | 'phone' | 'account_id';

export type Leak = { kind: LeakKind; match: string };

/**
 * Domains RFC 2606 and RFC 6761 reserve for documentation and testing. They can
 * never belong to a real person, so an address on one is not a leak — and
 * treating it as one would train the operator to ignore this gate, which is far
 * more dangerous than the false positives themselves.
 *
 * An address the operator explicitly configured as theirs is still reported,
 * even on a reserved domain.
 */
const RESERVED_EMAIL_DOMAIN =
  /(?:@|%40|%2540)(?:example\.(?:com|org|net)|[^@\s]*\.(?:example|test|invalid|localhost))$/i;

const SHAPES: ReadonlyArray<{
  kind: LeakKind;
  source: string;
  flags: string;
  /** Rejects a match whose captured value is not really a secret. */
  valueFilter?: (value: string | undefined) => boolean;
}> = [
  { kind: 'jwt', source: JWT_SOURCE, flags: 'g' },
  { kind: 'api_key', source: API_KEY_SOURCE, flags: 'g' },
  { kind: 'api_key', source: FOREIGN_KEY_SOURCE, flags: 'g' },
  {
    kind: 'api_key',
    source: SECRET_ASSIGNMENT_SOURCE,
    flags: 'gi',
    valueFilter: (value) => value !== undefined && !CODE_REFERENCE_VALUE.test(value),
  },
  { kind: 'cookie', source: COOKIE_SOURCE, flags: 'gi' },
  { kind: 'cookie', source: COOKIE_PAIR_SOURCE, flags: 'gi' },
  { kind: 'email', source: EMAIL_SOURCE, flags: 'g' },
  { kind: 'email', source: EMAIL_ENCODED_SOURCE, flags: 'gi' },
  { kind: 'phone', source: PHONE_ASSIGNMENT_SOURCE, flags: 'gi' },
  { kind: 'phone', source: PHONE_E164_SOURCE, flags: 'g' },
];

export function scanForLeaks(text: string, rules: RedactionRules): Leak[] {
  const leaks: Leak[] = [];

  for (const shape of SHAPES) {
    const pattern = new RegExp(shape.source, shape.flags);
    for (let m = pattern.exec(text); m !== null; m = pattern.exec(text)) {
      // A substitution this pipeline already made is not a finding. Without
      // this the gate fires on its own redactor's output and fails for ever on
      // correctly sanitized files — which is the same "trains you to ignore it"
      // hazard the reserved-domain rule exists to avoid.
      if (PLACEHOLDER_PATTERN.test(m[0])) continue;
      if (shape.kind === 'email' && RESERVED_EMAIL_DOMAIN.test(m[0])) continue;
      if (shape.valueFilter !== undefined && !shape.valueFilter(m[2])) continue;
      leaks.push({ kind: shape.kind, match: m[0] });
    }
  }

  for (const id of [...rules.accountIds, ...rules.emails]) {
    if (id.length === 0) continue;
    const pattern = new RegExp(`(?<![0-9A-Za-z_])${escapeRegExp(id)}(?![0-9A-Za-z_])`, 'g');
    for (let m = pattern.exec(text); m !== null; m = pattern.exec(text)) {
      leaks.push({ kind: id.includes('@') ? 'email' : 'account_id', match: m[0] });
    }
  }

  return leaks;
}
