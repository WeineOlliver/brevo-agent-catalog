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

## Results — run 2, after the write passes

> **Not yet run.** The write passes need an interactive login that only the
> account holder can perform, and that has not happened yet. Nothing is reported
> here because nothing has been measured. See [gaps.md](gaps.md).

The comparison to fill in, which is the interesting claim — not the absolute
score but whether the feedback loop works:

| | Crawl only | After write passes | After description fixes |
|---|---|---|---|
| Correct action selected | 0 / 20 | — | — |
| Correct inputs | — | — | — |
| Unscoreable | 20 / 20 | — | — |

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
