/**
 * Action ids cited in prose that do not exist.
 *
 * The extraction prompt asks each description to point at the neighbouring
 * action to use instead, and each candidate is drafted alone, with no list of
 * which ids exist. So the model guessed: the first full run produced 41
 * distinct invented ids, cited 42 times, and every one is a dead end for an
 * agent that reads "Use `contacts.import_contacts` instead" and looks it up.
 *
 * A naive scan said 47 and 52. The difference is this module's module-prefix
 * rule, and the gap is the point: a checker is only as good as its false
 * positive rate, and the first number quoted was its own kind of wrong.
 *
 * The prompt now asks for the neighbour by what it does rather than by id,
 * which stops new ones. This finds the ones already written down, and exists
 * mainly so the count can only go down: a dangling id is invisible to the
 * schema validator, since it is a perfectly well-formed string in a field that
 * is allowed to contain anything.
 *
 * A citation is only counted when its module prefix is a module the catalog
 * actually has. Without that rule prose like "the document.head element" scores
 * as a missing action, and a checker that cries wolf gets switched off.
 */

export type ActionText = { id: string; module: string; text: string };

/** Looks like `module.local`, lower snake case on both sides. */
const CITATION = /\b([a-z][a-z0-9_]*)\.([a-z][a-z0-9_]{2,})\b/g;

/** Things shaped like a citation that are not one. */
const NOT_AN_ID = /^(?:com|org|net|io|dev|json|csv|html|js|ts|mjs|cjs|yml|yaml|md|txt|png|brevo|me|co|uk)$/;

export function findDanglingRefs(actions: ActionText[]): Map<string, string[]> {
  const ids = new Set(actions.map((a) => a.id));
  const modules = new Set(actions.map((a) => a.module));
  const dangling = new Map<string, string[]>();

  for (const action of actions) {
    const seen = new Set<string>();
    for (const match of action.text.matchAll(CITATION)) {
      const [citation, module, local] = match;
      if (module === undefined || local === undefined) continue;
      if (NOT_AN_ID.test(local)) continue;
      // Only ids whose module the catalog has. See the note above.
      if (!modules.has(module)) continue;
      if (ids.has(citation)) continue;
      // An entry citing itself by id is odd but not dangling.
      if (citation === action.id) continue;
      if (seen.has(citation)) continue;
      seen.add(citation);

      const citedBy = dangling.get(citation);
      if (citedBy === undefined) dangling.set(citation, [action.id]);
      else citedBy.push(action.id);
    }
  }

  return dangling;
}

/** Every string field an agent reads as guidance. */
export function textOf(action: Record<string, unknown>): string {
  const parts: string[] = [];
  const push = (value: unknown): void => {
    if (typeof value === 'string') parts.push(value);
    else if (Array.isArray(value)) for (const v of value) push(v);
  };
  push(action.description);
  push(action.preconditions);
  push(action.side_effects);
  push(action.name);
  return parts.join('\n');
}
