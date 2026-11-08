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

    return {
      id: area.id,
      name: area.name,
      does: area.does,
      count: entries.length,
      destructive: entries.filter((entry) => entry.destructive).length,
      flows: related,
    };
  });
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
export function search(index: CatalogIndexFile, query: string, limit = 10): SearchHit[] {
  const wanted = terms(query);
  if (wanted.length === 0) return [];

  const hits: SearchHit[] = [];

  for (const entry of index.actions) {
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

/** The brief as lines of text, for a person reading over the agent's shoulder. */
export function renderBrief(brief: ActionBrief): string[] {
  const lines: string[] = [];
  const flags = [
    brief.destructive ? 'DESTRUCTIVE' : null,
    brief.idempotent ? 'idempotent' : 'not idempotent',
  ]
    .filter(Boolean)
    .join(', ');

  lines.push(`${brief.id}  —  ${brief.name}   [${flags}]`);
  lines.push(`trust: ${brief.trust.status} — ${brief.trust.means}`);
  lines.push('');
  lines.push(`${brief.call.method} ${brief.call.path}`);
  if (brief.call.body_example) lines.push(`body example: ${brief.call.body_example}`);
  lines.push('');
  lines.push(brief.description);

  if (brief.inputs.length > 0) {
    lines.push('');
    lines.push('inputs:');
    for (const input of brief.inputs) {
      lines.push(
        `  ${input.name}${input.required ? '*' : ''}  ${input.type}` +
          (input.description ? `  — ${input.description}` : ''),
      );
    }
  }
  if (brief.returns.length > 0) {
    lines.push('');
    lines.push(`returns: ${brief.returns.join(', ')}`);
  }
  if (brief.before.length > 0) {
    lines.push('');
    lines.push('before:');
    for (const item of brief.before) lines.push(`  - ${item}`);
  }
  if (brief.after.length > 0) {
    lines.push('');
    lines.push('after:');
    for (const item of brief.after) lines.push(`  - ${item}`);
  }
  for (const flow of brief.flows) {
    lines.push('');
    lines.push(`flow ${flow.id}: step ${flow.step} of ${flow.of} — pnpm catalog flow ${flow.id}`);
  }
  return lines;
}
