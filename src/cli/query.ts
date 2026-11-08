/**
 * Reading the catalog the way an agent actually reads it.
 *
 * The selection eval hands a model all 197 entries with their full descriptions
 * — about 18 500 tokens — and then measures whether it picks the right one.
 * That is not how an agent with a search tool works, and the gap matters:
 * working with everything in context says nothing about working with three
 * results. This module is the narrow path, and it is deliberately three steps:
 *
 *   areas            9 lines, ~100 tokens       which part of the app
 *   area <id>        names only, ~790 worst     what is in that part
 *   show <id>        one full entry, ~400       inputs, risk, proof
 *
 * Measured against the whole index, that is roughly twenty times less text for
 * the same decision — and the descriptions, which are the expensive part, are
 * only paid for on the one entry that gets chosen.
 *
 * Group listings are names only, on purpose. `contacts` holds 64 entries and
 * 5 773 tokens of description; the names are 787. An agent that needs more
 * than a name to tell two entries apart has found a description defect worth
 * fixing rather than a listing worth enlarging.
 */

import { isRead } from '../catalog/risk.js';

export type IndexEntry = {
  id: string;
  module: string;
  area: string;
  name: string;
  description: string;
  status: string;
  destructive: boolean;
};

export type CatalogIndexFile = {
  count: number;
  by_status: Record<string, number>;
  by_area: Record<string, number>;
  actions: IndexEntry[];
};

export type FlowStep = { action_id: string; why: string; optional: boolean };

export type FlowFile = {
  count: number;
  flows: {
    id: string;
    name: string;
    goal: string;
    when_to_use: string;
    evidence: { capture: string; from: string; to: string };
    steps: FlowStep[];
    notes: string[];
  }[];
};

export type AreaSummary = {
  id: string;
  name: string;
  does: string;
  count: number;
  destructive: number;
  /** Flows whose steps land mostly in this area, so the next hop is visible. */
  flows: string[];
  /**
   * A few capability names, so the reader can tell whether what they want is
   * in here without opening it.
   *
   * A count and a sentence are not enough to route on: "38 things, compose and
   * send marketing messages" does not answer "can I schedule one for Friday".
   * Three names do.
   *
   * Chosen deterministically rather than alphabetically, because the first
   * three ids in a module are an accident of naming. Flow steps come first —
   * they are the canonical journeys through the area — then anything
   * irreversible, which is what a reader most needs to know exists, then the
   * rest in id order to fill the gap.
   */
  examples: string[];
  /**
   * How many of them change something, and how many only look.
   *
   * The decisive fact for the question this catalogue answers, and it was
   * missing. `automation` holds 6 entries and every one of them is a read:
   * an agent can tell someone what their automations are doing and cannot help
   * them build one. "6 things" hides that; "6, all read-only" is the answer.
   */
  canChange: number;
  canSee: number;
};

export type AreaListing = {
  area: string;
  count: number;
  entries: { id: string; name: string; destructive: boolean; status: string }[];
};

export type SearchHit = {
  id: string;
  name: string;
  area: string;
  destructive: boolean;
  score: number;
};

/**
 * Words that carry no signal in a task phrased by a person.
 *
 * Without this, "someone asked to be deleted" scores every entry whose
 * description happens to say "the" or "for", and the ranking is noise with a
 * number on it.
 */
const STOPWORDS = new Set([
  'the', 'and', 'for', 'from', 'with', 'that', 'this', 'into', 'out', 'all',
  'any', 'our', 'their', 'you', 'your', 'can', 'want', 'wants', 'need', 'needs',
  'asked', 'asks', 'ask', 'someone', 'somebody', 'please', 'how', 'did', 'does',
  'was', 'were', 'has', 'have', 'had', 'but', 'not', 'now', 'get', 'got',
  'everything', 'everyone', 'entirely', 'sort', 'thing', 'things', 'who',
  'what', 'when', 'where', 'why', 'right', 'ready', 'instead', 'about', 'his',
  'her', 'him', 'them', 'they', 'she', 'its', 'are', 'off', 'put', 'keep',
  'let', 'see', 'start', 'new', 'already',
]);

/** Words worth matching on: three letters or more, lowercased, not stopwords. */
function terms(text: string): string[] {
  return text
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((word) => word.length >= 3 && !STOPWORDS.has(word));
}

/**
 * Whether two words are the same word for ranking purposes.
 *
 * Substring matching fails on inflection, and it fails in the direction that
 * matters: "deleted" does not contain "delete_contact" and
 * "delete_contact" does not contain "deleted", so the one entry a deletion
 * request needs scored zero while an unrelated entry won on a stopword. Prefix
 * agreement in either direction catches delete/deleted, send/sending,
 * campaign/campaigns without a stemmer, and four characters is enough to stop
 * "con" matching "contact", "config", "consent" and "conversion" at once.
 */
function sameWord(a: string, b: string): boolean {
  if (a === b) return true;
  const shorter = a.length <= b.length ? a : b;
  const longer = a.length <= b.length ? b : a;
  return shorter.length >= 4 && longer.startsWith(shorter);
}

/** Does any word in `text` agree with `word`? */
function hasWord(text: string, word: string): boolean {
  return terms(text).some((candidate) => sameWord(candidate, word));
}

/**
 * The area that holds what the app calls to draw itself.
 *
 * Named here because it has to be excluded from the default answer. The
 * question this catalogue exists to answer is what a *user* can do, and
 * fetching a font list or an English locale file is not something a user does.
 * Listing those 27 entries beside contacts and campaigns presents them as
 * equivalent, which is a wrong answer rather than a long one.
 *
 * They stay reachable — `pnpm catalog --all`, or `area platform` — because they
 * are real traffic and the catalogue's job is to be faithful about what the app
 * calls. They are just not an answer to "what can I do".
 */
export const NOT_A_USER_CAPABILITY = 'platform';

export function summariseAreas(
  index: CatalogIndexFile,
  areas: { id: string; name: string; does: string }[],
  flows: FlowFile,
): AreaSummary[] {
  return areas.map((area) => {
    const entries = index.actions.filter((entry) => entry.area === area.id);
    const related = flows.flows
      .filter((flow) =>
        flow.steps.some((step) => {
          const entry = index.actions.find((candidate) => candidate.id === step.action_id);
          return entry?.area === area.id;
        }),
      )
      .map((flow) => flow.id);

    const inFlows = new Set(
      flows.flows.flatMap((flow) => flow.steps.map((step) => step.action_id)),
    );
    const ranked = [
      ...entries.filter((entry) => inFlows.has(entry.id)),
      ...entries.filter((entry) => !inFlows.has(entry.id) && entry.destructive),
      ...entries.filter((entry) => !inFlows.has(entry.id) && !entry.destructive),
    ];

    return {
      id: area.id,
      name: area.name,
      does: area.does,
      count: entries.length,
      destructive: entries.filter((entry) => entry.destructive).length,
      flows: related,
      examples: ranked.slice(0, 3).map((entry) => entry.name),
      canChange: entries.filter((entry) => !isRead(entry.id)).length,
      canSee: entries.filter((entry) => isRead(entry.id)).length,
    };
  });
}

/**
 * The opening answer: how many things a user can do, and where they live.
 *
 * This is the first thing an agent reads, and its only job is to route the
 * next question. So each area carries the human name, the count, how many of
 * them cannot be undone, a sentence on what the area is for, three real
 * capability names as anchors, and the command for going in.
 */
export function renderAreas(summaries: AreaSummary[], total: number): string[] {
  const lines: string[] = [];
  const change = summaries.reduce((n, area) => n + area.canChange, 0);
  const look = summaries.reduce((n, area) => n + area.canSee, 0);

  // The split belongs in the first sentence. "170 things" reads as 170
  // capabilities; most of them are ways to look at the account, and an agent
  // that knows the ratio asks a better second question.
  lines.push(
    `A user can do ${total} things in this app, across ${summaries.length} areas.`,
  );
  lines.push(`${change} of them change something; the other ${look} only look.`);

  for (const area of summaries) {
    lines.push('');
    const caution =
      area.destructive > 0 ? `, ${area.destructive} of them cannot be undone` : '';
    const split =
      area.canChange === 0
        ? `${area.count}, all read-only — nothing here changes anything`
        : `${area.canChange} to change, ${area.canSee} to look at${caution}`;
    lines.push(`${area.name}  —  ${split}`);
    lines.push(`  ${area.does}`);
    if (area.examples.length > 0) {
      lines.push(`  for example: ${area.examples.join(' · ')}`);
    }
    if (area.flows.length > 0) {
      lines.push(`  takes more than one step: ${area.flows.join(', ')}`);
    }
    lines.push(`  -> pnpm catalog area ${area.id}`);
  }

  return lines;
}

export function listArea(index: CatalogIndexFile, areaId: string): AreaListing | null {
  const known = new Set(index.actions.map((entry) => entry.area));
  if (!known.has(areaId)) return null;

  const entries = index.actions
    .filter((entry) => entry.area === areaId)
    .map((entry) => ({
      id: entry.id,
      name: entry.name,
      destructive: entry.destructive,
      status: entry.status,
    }));

  return { area: areaId, count: entries.length, entries };
}

/**
 * Ranked substring search over id, name and description.
 *
 * Deliberately not an embedding: this has to run offline with no provider, and
 * a lexical ranking that an agent can reason about beats a similarity score it
 * cannot. An id or name hit outranks a description hit, because a description
 * mentioning "list" is weaker evidence than a name containing it.
 */
export function search(
  index: CatalogIndexFile,
  query: string,
  limit = 10,
  includePlumbing = false,
): SearchHit[] {
  const wanted = terms(query);
  if (wanted.length === 0) return [];

  const hits: SearchHit[] = [];

  for (const entry of index.actions) {
    // A font list is never the answer to what a user wants to do.
    if (!includePlumbing && entry.area === NOT_A_USER_CAPABILITY) continue;
    let score = 0;
    let covered = 0;

    for (const word of wanted) {
      const inId = hasWord(entry.id, word);
      const inName = hasWord(entry.name, word);
      const inDescription = hasWord(entry.description, word);

      if (inId) score += 6;
      if (inName) score += 4;
      if (inDescription) score += 1;
      if (inId || inName || inDescription) covered += 1;
    }

    // Every word of the task landing somewhere beats one word landing twice:
    // "delete contact" should outrank an entry that only says "contact" often.
    if (covered === wanted.length && wanted.length > 1) score += 3;

    if (score > 0) {
      hits.push({
        id: entry.id,
        name: entry.name,
        area: entry.area,
        destructive: entry.destructive,
        score,
      });
    }
  }

  return hits
    .sort((a, b) => (b.score !== a.score ? b.score - a.score : a.id.localeCompare(b.id)))
    .slice(0, limit);
}

export function findFlow(flows: FlowFile, flowId: string): FlowFile['flows'][number] | null {
  return flows.flows.find((flow) => flow.id === flowId) ?? null;
}

/** Flows that contain a given action, so `show` can point at the next step. */
export function flowsContaining(flows: FlowFile, actionId: string): string[] {
  return flows.flows
    .filter((flow) => flow.steps.some((step) => step.action_id === actionId))
    .map((flow) => flow.id);
}

/**
 * What an agent needs in order to act, and nothing else.
 *
 * `show` used to print the whole stored entry: 2 606 characters for
 * `contacts.delete_contact`, of which the agent can act on about a quarter. The
 * rest is provenance — `ui_path`, `public_api`, `plan_tier: unknown`, the
 * evidence list, a local Playwright trace path, a timestamp. All of it earns
 * its place in the file, because the file is the record. None of it belongs in
 * the answer to "what do I call and what do I send".
 *
 * Trimming this is not cosmetic. An agent reads the reply it is given, and
 * padding a reply with fields that cannot be acted on is how the operative
 * parts — the risk flag, the preconditions — get skimmed past.
 *
 * `--full` still prints the stored entry verbatim, because the provenance is
 * the point of the catalogue and has to stay one keystroke away.
 */
export type StoredAction = {
  id: string;
  name: string;
  description: string;
  preconditions?: string[];
  inputs?: { properties?: Record<string, { type?: string; description?: string }>; required?: string[] };
  outputs?: { properties?: Record<string, unknown> };
  side_effects?: string[];
  destructive?: boolean;
  idempotent?: boolean;
  internal_endpoint?: { method?: string; path?: string; body_example?: string | null };
  verification?: { status?: string };
};

const TRUST: Record<string, string> = {
  verified: 'executed against a real account; the request matched this entry',
  observed: 'seen in real traffic, never executed — treat inputs as a hypothesis',
  inferred: 'no traffic behind it; guessed from the UI',
};

export type ActionBrief = {
  id: string;
  name: string;
  description: string;
  call: { method: string; path: string; body_example?: string | null };
  inputs: { name: string; type: string; required: boolean; description: string }[];
  returns: string[];
  destructive: boolean;
  idempotent: boolean;
  trust: { status: string; means: string };
  before: string[];
  after: string[];
  flows: { id: string; step: number; of: number }[];
};

export function briefOf(action: StoredAction, flows: FlowFile): ActionBrief {
  const props = action.inputs?.properties ?? {};
  const required = new Set(action.inputs?.required ?? []);
  const status = action.verification?.status ?? 'observed';

  return {
    id: action.id,
    name: action.name,
    description: action.description,
    call: {
      method: action.internal_endpoint?.method ?? '?',
      path: action.internal_endpoint?.path ?? '?',
      ...(action.internal_endpoint?.body_example
        ? { body_example: action.internal_endpoint.body_example }
        : {}),
    },
    inputs: Object.entries(props).map(([name, spec]) => ({
      name,
      type: spec?.type ?? 'unknown',
      required: required.has(name),
      description: spec?.description ?? '',
    })),
    returns: Object.keys(action.outputs?.properties ?? {}),
    destructive: action.destructive === true,
    idempotent: action.idempotent === true,
    trust: { status, means: TRUST[status] ?? 'unknown' },
    before: action.preconditions ?? [],
    after: action.side_effects ?? [],
    flows: flows.flows
      .map((flow) => {
        const step = flow.steps.findIndex((s) => s.action_id === action.id);
        return step === -1 ? null : { id: flow.id, step: step + 1, of: flow.steps.length };
      })
      .filter((x): x is { id: string; step: number; of: number } => x !== null),
  };
}

/**
 * The brief as lines of text, answering what the user can do.
 *
 * The order is the whole point and it was wrong once. This used to open with
 * `DELETE /contact/backend/contacts/:id`, which is the least useful line on the
 * screen for the question actually being asked: an agent consulting this
 * catalogue wants to know whether the user *can* do something and what it
 * costs, not what to POST. Nothing here performs an action.
 *
 * So: what it is, then whether it can be undone, then what it does, then what
 * has to be true first, then what changes afterwards. The endpoint stays, at
 * the bottom, labelled as evidence — it is what makes the entry checkable, and
 * it is not the answer.
 */
export function renderBrief(brief: ActionBrief): string[] {
  const lines: string[] = [];

  lines.push(`${brief.name}  (${brief.id})`);

  // Reversibility first, in words rather than as a flag name. "destructive:
  // true" is a field; "cannot be undone" is a consequence.
  lines.push(
    brief.destructive
      ? '  CANNOT BE UNDONE — irreversible, or visible outside the account.'
      : '  Reversible.',
  );
  if (!brief.idempotent) {
    lines.push('  Doing it twice is not the same as doing it once.');
  }

  lines.push('');
  lines.push('What it does');
  lines.push(`  ${brief.description}`);

  if (brief.before.length > 0) {
    lines.push('');
    lines.push('What has to be true first');
    for (const item of brief.before) lines.push(`  - ${item}`);
  }
  if (brief.after.length > 0) {
    lines.push('');
    lines.push('What changes afterwards');
    for (const item of brief.after) lines.push(`  - ${item}`);
  }
  if (brief.inputs.length > 0) {
    lines.push('');
    lines.push('What it needs to know (* required)');
    for (const input of brief.inputs) {
      lines.push(
        `  ${input.name}${input.required ? '*' : ''}  ${input.type}` +
          (input.description ? `  — ${input.description}` : ''),
      );
    }
  }

  lines.push('');
  lines.push('How sure we are');
  lines.push(`  ${brief.trust.status} — ${brief.trust.means}`);

  for (const flow of brief.flows) {
    lines.push('');
    lines.push(
      `Part of: ${flow.id}, step ${flow.step} of ${flow.of}` +
        ` — pnpm catalog flow ${flow.id}`,
    );
  }

  lines.push('');
  lines.push(
    `Evidence: the app calls ${brief.call.method} ${brief.call.path}` +
      (brief.returns.length > 0 ? ` and gets back ${brief.returns.join(', ')}` : ''),
  );
  return lines;
}
