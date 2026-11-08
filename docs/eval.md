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
two-step task, which is worth knowing before reading 17/19 as a ceiling.

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
