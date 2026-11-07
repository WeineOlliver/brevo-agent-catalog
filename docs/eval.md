# Selection eval

## What it measures

Whether a model, given only `actions/index.json` and a task phrased the way a
user would phrase it, reaches the right action with the right inputs.

This exists because "designed for AI agents" is a claim and a score is a
measurement. It is also the cheapest available Reliability test: every miss is a
description an agent could not resolve, found before shipping rather than after.

## How it is set up

20 tasks in `data/eval-tasks.json`, written to two rules:

1. **Never reuse the catalog's own description wording.** Otherwise the eval
   measures retrieval of its own phrasing rather than comprehension. So the task
   is *"maria@example.com asked to stop receiving everything from us"*, not
   *"unsubscribe a contact"*.
2. **Include confusable pairs deliberately.** Four of them: create vs update
   contact, send now vs schedule, create a list vs add someone to a list, delete
   a contact vs unsubscribe a contact. A catalog that cannot separate these would
   have an agent deleting someone who asked to be unsubscribed — which is
   exactly the kind of error the `destructive` flag exists to prevent, and the
   kind a coverage count would never reveal.

Scoring: `correct` requires the exact expected action id. Inputs are compared as
a subset, so an agent supplying a sensible extra field is not penalised. A task
whose expected id is absent from the catalog is reported as **unscoreable**, not
as a miss — before the catalog exists those ids are predictions, and counting
them as failures would make the headline number meaningless.

A provider that rate-limits or answers in prose is recorded as a scored failure
with a note, never an exception. An eval that dies on one bad response measures
nothing.

## Results — run 1, against the crawl-only catalog

| | Result |
|---|---|
| Tasks | 20 |
| Correct action selected | **0** |
| Unscoreable (expected id absent from the catalog) | **20** |

Not a single task was even scoreable. The catalog held 118 entries and none of
them was any of the twenty things a user would ask for.

The reason is visible the moment you count verbs across those 118 entries:

| Leading verb | Count |
|---|---|
| `get` | 75 |
| `list` | 33 |
| `fetch` | 2 |
| everything else | 7 |
| **writes** | **1** |

**A navigation-only crawl produces a read-only catalog.** The crawler follows
links and clicks nothing, so it observes `GET` traffic almost exclusively. Every
action the brief itself names as an example — create a contact, add a contact to
a list, create an email campaign — exists only in the request a form submission
causes. None of them was ever on the wire.

### Why this is the most useful number in the submission

A coverage count would have reported 118 actions and looked like success. The
eval is what turned "118 entries" into "0 of 20 tasks", and that reframed the
whole project: the write passes stopped being a supporting stage and became the
coverage mechanism. The entire interaction stage was rewritten in response —
from one module to six, covering exactly where these twenty tasks live.

This is also precisely the failure the design reviewer predicted before any code
was written: *"a read-only link crawl does not observe the POST/PUT calls, which
are precisely the business actions the catalog is about."* It was recorded as a
known risk, the mitigation was designed in, and the eval then proved the risk was
real rather than theoretical.

## Results — runs 2 to 5

The interesting claim was never the absolute score, which 17 missing actions cap
at 3. It is whether the loop closes: does a miss name a real defect, does fixing
that defect move the number, and does the eval resist being gamed into passing.

| | Crawl only | + write passes | + id reconciliation | + description fixes |
|---|---|---|---|---|
| Correct action selected | — | 1 / 1 | 2 / 3 | 2 / 3 |
| Correct inputs | — | 1 / 1 | 1 / 1 | 1 / 1 |
| Scoreable of 20 tasks | 0 | 1 | 3 | 3 |

Four things it caught, in order:

1. **The scorer had never scored anything.** Run 2 existed only to find that
   out, with one scoreable task, before the catalog was large enough for a bad
   scorer to be discovered late. It worked: `contacts.create_contact` was
   selected from the prompt *"add john@example.com to my newsletter list"*,
   which shares no wording with the entry, and its inputs matched.

2. **Two of the 20 expected ids were predictions, not gaps.** `lists.list_lists`
   is `lists.get_lists`; `contacts.list_contacts` is `segments.query_contacts`,
   which Brevo serves with an empty `fe_query` — the captured request proves it
   returns the whole base. Both were reconciled in `data/eval-tasks.json`. Two
   others that looked reconcilable were **not**, and stayed gaps:
   `lists.add_contacts_to_list` (the catalog's neighbour acts on one contact, not
   list-to-list) and `campaigns.get_campaign_report` (the neighbour aggregates
   over a date range rather than reporting one campaign).

3. **A description that denied what the action does.** Before the fix,
   `segments.query_contacts` described itself as returning "contacts that belong
   to a specific segment", so no agent would pick it for *"show me everyone
   currently in Brevo"*. Corrected against the captured evidence, it scores.

4. **A confusable pair that is still a miss, on purpose.** For *"what audience
   groups do we have"* the model chose `contacts.get_lists_and_segments` over the
   expected `lists.get_lists`. Both descriptions were rewritten to say what the
   other returns and when to prefer it — and the model's choice did not change,
   which is evidence the defect is not wording: "audience groups" covers lists
   and segments both, and the entry returning both is a defensible answer. The
   honest reading is that the **task** is ambiguous.

   It stays a recorded miss. Sharpening the prompt after seeing which way the
   model went would make the number go up and the eval worth less.

### A failure that is not a failure

Run 4 reported 1 of 3 with two misses whose token counts were zero: a usage limit
hit mid-run. The harness was right not to throw, but counting that as a miss
presents infrastructure noise as a quality regression. Provider failures are now
recorded, excluded from the denominator, and always printed —
`src/eval/selection.ts` separates "the model answered badly", which is scored,
from "the provider never answered", which is not.

## What the failures will mean

Three distinct causes, worth separating when reading the output:

- **Wrong action chosen from a plausible neighbour** — the descriptions are not
  disambiguating. Fix: make the "use X instead if…" clause explicit in both
  entries.
- **Nothing parseable returned** — the index is too large or the prompt too
  loose. Fix the prompt, not the catalog.
- **Expected id unscoreable** — either a genuine coverage gap (record it in
  [gaps.md](gaps.md)) or a prediction in the task list that needs correcting
  against the real catalog. These are very different findings and the script
  prints them separately for that reason.
