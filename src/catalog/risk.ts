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
  // Both of these arrived with the second extraction pass, and both had been
  // drafted `destructive: true`. `suggest` is the worst of the pair:
  // `POST /import/suggest-mapping-from-file` uploads a CSV and returns a
  // proposed column mapping, importing nothing — a read-via-POST of exactly
  // the kind this module exists to stop being flagged as a mutation.
  "find",
  "suggest",
  // `POST /import/index` uploads the CSV and returns detected columns, sample
  // values and inferred types. It uploads, but it imports nothing, which is
  // the same shape as `suggest` above — so the two stay classified alike.
  "analyze",
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
  // Attaching a company to a contact adds an association and removes nothing.
  // Its partner `unlink` is in the irreversible group, so the real catalog id
  // `contacts.link_unlink_company` escalates on its worse half, which is the
  // whole-name scan working as designed.
  "link",
  // The inverse pair for a scheduled send. `schedule` is already here, and the
  // reason it is safe to call is that this undoes it: a suspended campaign
  // returns to draft and can be scheduled again. Flagging the undo as
  // destructive while calling the thing it undoes reversible is incoherent.
  //
  // `cancel` stays in the irreversible group and is not a synonym here. Cancel
  // is the word a product uses for terminating a plan or a subscription, which
  // does not come back; suspend is the word for a pause.
  "suspend",
  "resume",
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
  // Severing an association destroys the record of what it was. Re-linking is
  // possible only for someone who still knows, which an agent that just
  // unlinked the wrong company does not.
  "unlink",
  // Not a verb, and here on purpose. `POST /contact/backend/actions/list` is a
  // dispatcher: its payload names the operation, and the catalog entry for it
  // says "e.g., delete contacts from a list". A name cannot tell you what a
  // dispatcher will do, so every one of them escalates. Leaving it
  // unclassified would have been right by luck — the drafted flag happened to
  // be true — and luck is not a safety property.
  "bulk",
  // Ambiguous, and the ambiguity has compliance teeth. Unblocking a *sender*
  // re-enables an address we own and is reversible. Unblocking a *contact*
  // re-enables mail to someone who opted out, which is a violation and is not
  // undone by blocking them again. One verb, two objects, and the module rule
  // for that case is the fail-safe group.
  "unblock",
]);

/**
 * Tokens that mean an id names more than one operation.
 *
 * These are what separates `create_and_send_campaign`, where the name is a
 * promise about behaviour, from `list_unsubscribe_forms`, where the dangerous
 * word is part of the name of the thing being listed.
 */
const COMPOUND_TOKENS = new Set(['and', 'then', 'plus']);

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

  // A read verb in first position settles it, and a dangerous word later in
  // the name belongs to the OBJECT rather than to the operation. This runs
  // before the escalation scan because the scan got one wrong in the real
  // catalog: `forms.list_unsubscribe_forms` is `GET /editor-api/unsubscribe-
  // forms`, and it shipped `destructive: true` because "unsubscribe" is in the
  // name of the form being listed. That is the method-derived bug restated —
  // an agent refusing to list a form, and then learning to discount a flag it
  // has watched be wrong.
  //
  // "Escalation only errs towards a needless confirmation" was the argument
  // for scanning everything, and it is false. A read flagged destructive is
  // not a free click; it is the catalog teaching its consumer that the flag
  // does not mean anything.
  //
  // Unless the name says the action does two things, in which case the scan
  // still runs and still wins.
  const compound = tokens.some((token) => COMPOUND_TOKENS.has(token));
  if (!compound && READ_VERBS.has(first)) {
    // The reason is the audit trail an operator reads when a flag is
    // corrected, so it says which of the two things happened rather than
    // blaming Brevo's POST habit for a GET.
    const shadowed = tokens.slice(1).find((token) => IRREVERSIBLE_VERBS.has(token));
    return {
      destructive: false,
      idempotent: true,
      reason:
        shadowed === undefined
          ? `"${first}" reads; Brevo reads via POST`
          : `"${first}" reads; "${shadowed}" names the object, not the act`,
    };
  }

  // A dangerous verb anywhere else escalates, wherever it sits. This scans the
  // whole name because an id that says two things is as dangerous as its worst
  // part — `create_and_send_campaign` is a send.
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
  //
  // Two verbs in the real catalog are left here on purpose, because they mean
  // different things depending on their object and a table maps verbs only:
  //
  // - `validate` reads when the object is campaign content
  //   (`GET /marketing-campaign/api/:id/validate-content`) and leaves the
  //   account when the object is a sender, where validating emails a code.
  // - `open` reads when the object is a page (`GET /editor/newsletters/:id`)
  //   and creates when the object is a conversation or a ticket.
  //
  // Adding either would assert a safe idempotent read over a mutation the
  // first time the other object showed up — the original method-derived bug,
  // rebuilt by hand. An ambiguous verb is worth a rename, not a guess.
  return null;
}
