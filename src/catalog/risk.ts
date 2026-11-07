/**
 * What an action risks, as a property of the product rather than of our crawl.
 *
 * Two things were being confused by one boolean:
 *
 * - **May our harness click this?** That is `ExplorePolicy` in
 *   `src/interact/controls.ts`, and on a disposable test account the answer is
 *   mostly yes. It is a decision about our courage.
 * - **Must the agent consuming this catalog confirm first?** That is this
 *   module. It is a fact about Brevo and has to be true whatever account we
 *   crawled from, because the catalog is the contract the final product maps.
 *
 * The first extraction derived the second from the HTTP method, which Brevo
 * breaks: it reads through POST (`segment/count`, `segment/query`,
 * `segment/paginated_count`, `api/email/logs`). That produced entries named
 * `get_count` and `fetch_email_logs` flagged `destructive: true` — an agent
 * obeying the flag refuses a harmless read, and an agent learning to ignore it
 * on reads will ignore it on `delete` too.
 *
 * It also conflated *mutating* with *destructive*. Those come apart in both
 * directions, which is the whole reason this file exists:
 *
 * - `create_contact` mutates and is **not** destructive: reversible, and it
 *   touches only data we own.
 * - `send_campaign` creates nothing and **is** destructive: it mails real
 *   people, and there is no undo.
 *
 * So `destructive` here means **irreversible or visible outside the account**,
 * not "not a read".
 *
 * Verbs are a hardcoded table on purpose. Everything else in normalisation is
 * derived from the catalog's own shape, but risk cannot be: no amount of
 * captured traffic tells you that a send cannot be taken back. Where a verb is
 * ambiguous (`remove` is reversible for a list membership, not for a contact)
 * it goes in the destructive group, because the two errors are not symmetric —
 * a needless confirmation costs a click, a missing one costs data.
 */

/** Reads. Safe to call, safe to retry. */
const READ_VERBS = new Set([
  "get",
  "list",
  "query",
  "fetch",
  "count",
  "search",
  "check",
  "detect",
  "load",
  "show",
  "preview",
  "export",
  "describe",
  "read",
]);

/** Mutations confined to the account and undoable by another action. */
const REVERSIBLE_VERBS = new Set([
  "create",
  "add",
  "update",
  "set",
  "rename",
  "duplicate",
  "clone",
  "copy",
  "move",
  "assign",
  "unassign",
  "import",
  "enable",
  "disable",
  "save",
  "upload",
  "tag",
  "untag",
  "schedule",
  "unschedule",
  "calculate",
  "sync",
  "refresh",
  "recalculate",
]);

/** Irreversible, or observable by someone outside the account. */
const IRREVERSIBLE_VERBS = new Set([
  "delete",
  "remove",
  "destroy",
  "purge",
  "wipe",
  "erase",
  "archive",
  "send",
  "publish",
  "broadcast",
  "activate",
  "deactivate",
  "revoke",
  "reset",
  "regenerate",
  "rotate",
  "unsubscribe",
  "blocklist",
  "block",
  "cancel",
  "close",
  "invite",
  "charge",
  "refund",
]);

export type Risk = { destructive: boolean; idempotent: boolean };

export type RiskVerdict = Risk & {
  /** Why, in the words the catalog's own docs use. Printed by the run. */
  reason: string;
};

/**
 * The verb of an id shaped `module.verb_object`.
 *
 * Returns null for an id that does not have one, which is a normalisation
 * problem rather than a risk problem and is left to the caller.
 */
export function verbOf(id: string): string | null {
  const local = id.split(".")[1];
  if (local === undefined || local.length === 0) return null;
  const verb = local.split("_")[0];
  return verb === undefined || verb.length === 0 ? null : verb.toLowerCase();
}

/**
 * Every token of an id's local part, lowercased.
 *
 * The first token is not always the verb: the real extraction produced
 * `segments.paginated_count`, whose verb is `count` in third position behind
 * an adjective. Reading only the first token left that entry on the fail-safe
 * default and flagged a count as destructive, so the whole local name is
 * scanned. A malformed id is still a naming defect worth fixing; this only
 * stops one from becoming a safety defect too.
 */
function tokensOf(id: string): string[] {
  const local = id.split(".").slice(1).join(".");
  return local
    .split(/[_.-]+/)
    .map((token) => token.toLowerCase())
    .filter((token) => token.length > 0);
}

/**
 * The risk a known verb implies, or null when the verb is not in any table.
 *
 * Null means "keep whatever was drafted": an unrecognised verb is exactly where
 * the fail-safe default earns its place, and overriding it here with a guess
 * would be the original bug in a new costume.
 */
export function classifyRisk(id: string): RiskVerdict | null {
  const tokens = tokensOf(id);
  const first = tokens[0];
  if (first === undefined) return null;

  // A dangerous verb anywhere escalates, wherever it sits. This scans the whole
  // name because an id that says two things is as dangerous as its worst part —
  // `create_and_send_campaign` is a send — and because escalation only ever
  // errs towards a confirmation nobody needed.
  const irreversible = tokens.find((token) => IRREVERSIBLE_VERBS.has(token));
  if (irreversible !== undefined) {
    return {
      destructive: true,
      idempotent: false,
      reason: `"${irreversible}" is irreversible or leaves the account`,
    };
  }

  // Everything else is decided by the FIRST token, because that is the only
  // position the `module.verb_object` convention promises is a verb. A scan
  // here matches nouns and gets the answer backwards: `check_duplicate_contact`
  // is a read whose second token is a mutation verb, and `sync_list_counts` is
  // a mutation whose second token is a read verb. The dry run caught both, the
  // second of which had labelled a state change as a safe idempotent read.
  if (REVERSIBLE_VERBS.has(first)) {
    return {
      destructive: false,
      idempotent: false,
      reason: `"${first}" mutates reversibly, inside the account`,
    };
  }

  if (READ_VERBS.has(first)) {
    return {
      destructive: false,
      idempotent: true,
      reason: `"${first}" reads; Brevo reads via POST`,
    };
  }

  // An unrecognised first token keeps the fail-safe draft. `paginated_count`
  // lands here: its verb is third, which is a naming defect in the id and is
  // fixed by renaming the action, not by teaching this to parse English.
  return null;
}
