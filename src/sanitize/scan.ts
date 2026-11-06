/**
 * The leak gate.
 *
 * Deliberately an independent second opinion: it re-derives the patterns rather
 * than asking the redactor what it would have replaced. A gate implemented by
 * calling the thing it is checking cannot fail.
 */

import {
  API_KEY_SOURCE,
  COOKIE_SOURCE,
  EMAIL_SOURCE,
  JWT_SOURCE,
  SECRET_ASSIGNMENT_SOURCE,
  escapeRegExp,
} from './patterns.js';
import type { RedactionRules } from './redact.js';

export type LeakKind = 'api_key' | 'jwt' | 'cookie' | 'email' | 'account_id';

export type Leak = { kind: LeakKind; match: string };

const SHAPES: ReadonlyArray<{ kind: LeakKind; source: string; flags: string }> = [
  { kind: 'jwt', source: JWT_SOURCE, flags: 'g' },
  { kind: 'api_key', source: API_KEY_SOURCE, flags: 'g' },
  { kind: 'api_key', source: SECRET_ASSIGNMENT_SOURCE, flags: 'gi' },
  { kind: 'cookie', source: COOKIE_SOURCE, flags: 'gi' },
  { kind: 'email', source: EMAIL_SOURCE, flags: 'g' },
];

export function scanForLeaks(text: string, rules: RedactionRules): Leak[] {
  const leaks: Leak[] = [];

  for (const shape of SHAPES) {
    const pattern = new RegExp(shape.source, shape.flags);
    for (let m = pattern.exec(text); m !== null; m = pattern.exec(text)) {
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
