/**
 * Verification.
 *
 * This is where `verified` stops being a word and becomes a claim backed by a
 * request that actually happened. The two rules from the design are enforced
 * here in code rather than stated in prose:
 *
 * - Partial execution does not earn `verified`. A 4xx response means the action
 *   was attempted, not that it works.
 * - The fail-safe risk flags are only relaxed when execution proved them. An
 *   `observed` outcome cannot clear `destructive`.
 */

import type { Action } from '../types.js';
import type { CaptureRecord } from '../capture/types.js';
import { normalizeRoute } from '../crawl/links.js';
import { isBrevoHost } from '../util/hosts.js';
import { redactText, type RedactionRules } from '../sanitize/redact.js';
import type { Page } from 'playwright';
import type { FixtureBag } from '../interact/types.js';

const NO_REDACTION: RedactionRules = { emails: [], accountIds: [] };

export type VerifyOutcome =
  | { status: 'verified'; evidence: string[]; verified_at: string }
  | { status: 'observed'; evidence: string[]; reason: string };

/** Corrections the operator may apply, honoured only on a verified outcome. */
export type FlagCorrections = { destructive?: boolean; idempotent?: boolean };

/** One action's execution script. Cleans up whatever it created. */
export type VerifyRecipe = {
  actionId: string;
  run(page: Page, fx: FixtureBag): Promise<void>;
  cleanup?(page: Page, fx: FixtureBag): Promise<void>;
};

function hostOf(url: string): string {
  try {
    return new URL(url).hostname;
  } catch {
    return '(unparseable url)';
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

/**
 * @param rules Redaction rules. Evidence produced here is written into
 * `actions/*.json`, which is committed and public — and the sanitizer only ever
 * touches `captures/`. So this path must redact for itself; a raw response body
 * reaching an entry would publish whatever the server happened to echo back.
 */
export function assessOutcome(
  action: Action,
  observed: CaptureRecord[],
  rules: RedactionRules = NO_REDACTION,
): VerifyOutcome {
  const endpoint = action.internal_endpoint;
  const clean = (text: string): string => redactText(text, rules);

  if (endpoint === null) {
    return {
      status: 'observed',
      evidence: [],
      reason:
        'The action declares no internal endpoint, so there is nothing to match an executed request against.',
    };
  }

  const wantedPath = normalizeRoute(endpoint.path);
  const pathMatches = observed.filter(
    (record) =>
      record.method === endpoint.method && normalizeRoute(pathOf(record.url)) === wantedPath,
  );

  if (pathMatches.length === 0) {
    return {
      status: 'observed',
      evidence: [],
      reason: `No request matching ${endpoint.method} ${endpoint.path} was executed.`,
    };
  }

  // Without this, a third-party widget answering the same path during the run
  // is enough to stamp the action verified.
  const matches = pathMatches.filter((record) => isBrevoHost(record.url));

  if (matches.length === 0) {
    const hosts = [...new Set(pathMatches.map((m) => hostOf(m.url)))].join(', ');
    return {
      status: 'observed',
      evidence: [],
      reason: `A request to ${endpoint.method} ${endpoint.path} was seen, but only on a non-Brevo host (${hosts}); that cannot verify a Brevo action.`,
    };
  }

  const succeeded = matches.find((record) => record.status >= 200 && record.status < 300);

  if (succeeded === undefined) {
    const codes = [...new Set(matches.map((m) => m.status))].join(', ');
    return {
      status: 'observed',
      evidence: matches.map((m) => clean(`${m.method} ${pathOf(m.url)} -> ${m.status}`)),
      reason: `The request was executed but responded ${codes}; partial execution does not earn verified.`,
    };
  }

  return {
    status: 'verified',
    evidence: [
      clean(`executed ${succeeded.method} ${pathOf(succeeded.url)} -> ${succeeded.status}`),
      ...(succeeded.sourceFile === undefined ? [] : [succeeded.sourceFile]),
      ...(succeeded.responseBody === null
        ? []
        : [clean(`response: ${succeeded.responseBody.slice(0, 200)}`)]),
    ],
    verified_at: new Date().toISOString(),
  };
}

export function applyOutcome(
  action: Action,
  outcome: VerifyOutcome,
  corrections: FlagCorrections = {},
): Action {
  const verified = outcome.status === 'verified';

  // Never demote. A re-run that fails to re-prove an action — because Brevo's
  // markup moved, or the recipe broke — has learned nothing about the original
  // execution, and overwriting that evidence destroys it for no gain.
  if (!verified && action.verification.status === 'verified') return action;

  return {
    ...action,
    // Only execution can relax a fail-safe flag.
    destructive: verified && corrections.destructive !== undefined
      ? corrections.destructive
      : action.destructive,
    idempotent: verified && corrections.idempotent !== undefined
      ? corrections.idempotent
      : action.idempotent,
    verification: verified
      ? {
          status: 'verified',
          evidence: outcome.evidence,
          verified_at: outcome.verified_at,
        }
      : {
          status: 'observed',
          evidence: [...outcome.evidence, outcome.reason],
          verified_at: null,
        },
  };
}
