# Selection eval

## What it measures

Given only `actions/index.json` and a task phrased the way a user would phrase
it, does a model reach the right action with the right inputs?

"Designed for AI agents" is a claim. A score is a measurement. Every miss is a
description an agent could not resolve, found before shipping rather than after.

## How it is set up

20 tasks in `data/eval-tasks.json`, written to two rules:

1. **Never reuse the catalog's own wording.** Otherwise the eval measures
   retrieval of its own phrasing. So the task is *"maria@example.com asked to
   stop receiving everything from us"*, not *"unsubscribe a contact"*.
2. **Include confusable pairs on purpose.** Four of them: create vs update
   contact, send now vs schedule, create a list vs add someone to a list, delete
   a contact vs unsubscribe a contact. A catalog that cannot separate the last
   pair would have an agent deleting someone who asked to be unsubscribed.

Scoring rules that keep the number meaningful:

- **A task whose expected id is absent is `unscoreable`, not a miss.** Before the
  catalog exists those ids are predictions.
- **A provider that never answers is excluded from the denominator.** A rate
  limit says nothing about any description. A model answering *badly* is scored.
- **Inputs are compared as a subset**, so a sensible extra field is not punished.

## Results

| | Crawl only | + write passes | + id reconciliation | + HAR sessions | + fixture fix |
|:--|:--|:--|:--|:--|:--|
| Correct action | — | 1 / 1 | 2 / 3 | 15 / 19 | **17 / 19** |

That last column is a single run. Re-running it a day later gave 14–15; the
section below records why, and the badge follows the reproducible figure.
| Correct inputs | — | 1 / 1 | 1 / 1 | 1 / 1 | 1 / 1 |
| Scoreable of 20 | 0 | 1 | 3 | 19 | 19 |

**Run 1 scored 0 of 20, and it is the most useful number here.** The crawl-only
catalog held 118 actions, 108 of them `get` or `list`, and exactly one write.
Every action the brief names as an example — create a contact, add to a list,
create a campaign — exists only in the request a form submission causes, and the
crawler clicks nothing.

A coverage count would have reported 118 actions and read as success. The eval
is what turned "118 entries" into "0 of 20 tasks", and that reframed the
project: the write passes stopped being a supporting stage and became the
coverage mechanism.

## What it caught, run by run

**The scorer had never scored anything.** Run 2 existed only to find that out,
with one scoreable task, before the catalog was big enough for a broken scorer
to be discovered late.

**Two expected ids were predictions, not gaps.** `lists.list_lists` is
`lists.get_lists`; `contacts.list_contacts` is `segments.query_contacts`, which
Brevo serves with an empty `fe_query`. Both reconciled. Two others that looked
reconcilable were not, and stayed gaps.

**A description that denied what the action does.** `segments.query_contacts`
described itself as returning "contacts that belong to a specific segment", so
no agent would pick it for *"show me everyone currently in Brevo"*. Corrected
against the captured evidence, it scores.

**A failure that was not a failure.** Run 4 reported 1 of 3 with two misses
whose token counts were zero — a usage limit mid-run. Counting that as a miss
presents infrastructure noise as a quality regression, which is why provider
failures are now excluded from the denominator and always printed.

**A miss that was provider flakiness.** Run 6 scored *"put everyone from the
Black Friday list into the VIP list"* as a miss with `(nothing parseable)`. Run 7
passed it with no change to the catalog or the fixture. The fix for a flaky
result is a second run, not a patch to a description that was never at fault.

**A task with two correct answers, and my expectation was one of them.** For
*"take maria off the Black Friday list but keep her in Brevo"* the fixture
expected `contacts.update_contact` and the model chose
`contacts.bulk_modify_list`. The capture holds **both**, on the same single
contact: `PATCH /contact/backend/contacts/update` with `unlinkListIds: [5]` from
the contact form, and `POST /contact/backend/actions/list` with
`DELETE_FROM_LIST, ids: [3]` from the listing row. Scoring either as wrong
measures the fixture, so `acceptableActionIds` exists, is used on this one task,
and every pass through it prints as `(accepted alternative to ...)` so the
widening is never quiet.

## Re-measured on 2026-11-08: 15 of 19, not 17

The 17 came from one run on 2026-11-07. Four runs the next day, against a
catalogue whose only change was prose on one entry, scored **15, 14, and 15**,
plus one run abandoned with three provider failures. So the reproducible figure
is **14–15 of 19** and the badge now carries 15.

`data/eval-report.json` holds the **most recent** run, not the best one, so it
currently reads `correct: 14` while the badge reads 15. Pinning the report to the
run that flatters the badge is how a measurement stops being one.

Nothing was patched to recover the 17. Two findings came out of re-running
instead:

**`campaigns.send_now` is a third recurring miss, and it is the stats failure
again.** For *"the spring sale email is ready — push it out to everyone right
now"* the model chose `campaigns.list_campaigns`. The task names the campaign in
words; `send_now` takes an `id`; so the model reaches for the listing that turns
a name into an id. That is the same two-step shape as the campaign-stats miss
below, on a different task, which makes it a property of a one-shot selection
eval rather than two unlucky descriptions.

It was briefly misdiagnosed as self-inflicted. The audit that hardened this
entry's preconditions also rewrote its description to say the preconditions were
inferred and that the call is the last of five; the next run missed, which looked
like cause and effect. Restoring the original description verbatim and re-running
missed again. **The description was never the variable** — and a one-run
before/after is not evidence of a regression, which is the same lesson the
provider-flakiness run already taught in the other direction.

**`(nothing parseable)` is scored as a miss, and it should not be.** It appeared
on 3 of 4 runs, on `contacts.bulk_modify_list` and once on
`contacts.delete_contact` — entries nothing touched. The scorer excludes a
provider that *never answers*, on the stated grounds that infrastructure noise
measures nothing about a description, then counts a provider whose answer arrives
truncated as a wrong choice. Those are the same event. The rule that a model
answering *badly* is scored is right, and an unparseable answer is not a bad
choice; it is no choice. Until that is separated, every published figure here is
depressed by roughly one task of noise, and the honest reading of 15 of 19 is
"15 right, 2 known description problems, and about 2 the harness could not
score".

That is a defect in the measuring instrument, found by re-running it on a day it
had nothing new to measure.

## The two misses that remain

**One is a limit of the eval, not the catalog.** For *"how did the spring sale
email do — opens, clicks"* the model chose `campaigns.list_campaigns` over
`campaigns.get_campaign_stats`. The stats entry's own description ends *"use the
campaign listing action first if you still need to discover campaign IDs"* — and
the prompt names the campaign, not its id. The model followed our guidance and
picked the right **first** action for a two-step task.

It stays a miss. The bar for an accepted alternative is that it performs the same
user action, and `list_campaigns` returns no open or click counters: it is a
prerequisite, not an equivalent. A one-shot selection eval cannot fairly score a
two-step task, which is worth knowing before reading any of these numbers as a
ceiling. `campaigns.send_now` fails the same way, and that is recorded above.

**One is an ambiguous task, kept on purpose.** For *"what audience groups do we
have"* the model chose `contacts.get_lists_and_segments` over `lists.get_lists`.
Both descriptions were rewritten to say what the other returns, and the choice
did not change — so the defect is not wording. "Audience groups" covers lists and
segments both. Sharpening the prompt after seeing which way the model went would
raise the number and make the eval worth less.

## What the eval cannot see

41 invented action ids, cited 42 times across the descriptions. The eval scores
the action a model picks, not the guidance it reads on the way — a selector can
choose the right entry and still be sent nowhere by the next sentence. That is
why `pnpm validate` counts them, and they are now at 0. See [gaps.md](gaps.md).
