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

## Results

> **Not yet run.** This requires a built catalog (`pnpm build:index`), which
> requires the crawl, which requires a manual login. Nothing is reported here
> because nothing has been measured.

When it runs, this section should contain, in order:

| | Before description fixes | After |
|---|---|---|
| Correct action selected | — | — |
| Correct inputs (of tasks declaring them) | — | — |
| Unscoreable (expected id not in catalog) | — | — |

Plus, for each failure: the task, the action chosen instead, and what changed in
the description. The **before/after pair is the point** — a single number says
how good the catalog happened to be, while the pair says the pipeline has a
working feedback loop, which is the more interesting claim.

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
