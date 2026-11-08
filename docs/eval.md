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

**`(nothing parseable)` was the wrong label on the loudest finding here.** This
document said, for one commit, that those cases were harness noise scored as
misses, and that the scorer should stop counting them. That was wrong, and it was
wrong in the same way the `0 of 197` was wrong: a number read off a label instead
of the data under it.

The report stores `chosenActionId: null` and `note: null` for those cases. A null
note means extraction **succeeded** — the model returned well-formed JSON whose
`action_id` was `null`, which is the escape hatch the system prompt offers for
*"the task calls for an action that is not in the catalog"*. So the model did not
fail to answer. It answered that **this catalogue cannot do that** — for *"put
everyone from the Black Friday list into the VIP list too"*, and for *"remove
maria@example.com from Brevo entirely, she exercised her right to erasure"*,
where `contacts.delete_contact` not only exists but is one of the three entries
executed against a real account.

That is the most informative result the eval can produce and it had been printing
under a parser's error message for seven runs, because one label covered two
causes. The runner now says *"the model answered that no catalog action fits"*,
the case carries a `declinedNoAction` flag, and five tests hold the distinction
in place. It stays scored as a miss — the model did answer, and the answer was
wrong.

## The misses are concentrated in the destructive actions

Slicing the 19 tasks by whether the expected answer is flagged `destructive`:

| Expected action is | Correct | Missed |
|:--|:--|:--|
| `destructive` | **1** | **3** |
| everything else | 13 | 2 |

The two non-destructive misses are the two description problems documented below.
Which means **essentially the whole remaining error of this eval sits on the four
tasks whose answer is a destructive action**, and it fails in two different
shapes: twice the model answers that no action fits, and once it picks a safe
neighbour (`campaigns.list_campaigns` instead of `campaigns.send_now`). The one
destructive task that passes is `email_campaigns.send_test_email` — the only one
of the four whose blast radius is the operator's own inbox.

The suspect is this repository's own safety mechanism. `renderCatalog` appends
` [destructive]` to each flagged entry, so the model chooses from a list where
exactly those four carry a warning. A flag written to stop an agent deleting the
wrong contact may be stopping it from deleting the right one.

**That is a hypothesis, and it is one run away from being settled.**
`pnpm eval --no-risk-labels` renders the catalogue unmarked; published figures
always come from the default. If the tasks recover, the flag suppresses
selection, and risk has to be carried where an agent reads it as information
rather than as permission withheld — the schema's `destructive` field, consumed
by whatever executes, not prose in the selection prompt. If they stay missed, the
model is declining the *request*, no wording fixes it, and a catalogue for agents
needs an authorisation story rather than a vocabulary fix.

**The run has not happened.** The first attempt died with 15 of 19 tasks
returning `claude CLI exited 1` and scored 3 of 4, which measures nothing. It is
recorded here unfinished rather than guessed at, because both answers are
plausible and publishing either as a cause is how the `(nothing parseable)`
mistake happened in the first place.

## The eval cannot run on Groq at all

Decision #3 splits the providers by job — Groq for volume, headless Claude Code
for judgement — and the eval's own header claimed `--provider groq` stayed
available for when the Claude quota ran out. **That was false, and nobody had
tried it.**

One selection call ships the whole rendered catalog. Groq's counter puts it at
**14 846 tokens against an 8 000 tokens-per-minute ceiling** on this account's
tier, so it returns HTTP 413 before the model reads a word. Pacing cannot help:
a per-minute ceiling below the size of a single request is a size problem
wearing a rate problem's error code. A 2 000-character probe on the same key and
model succeeded in the same minute, which is what rules out an outage or a
drained day.

So the eval has exactly one provider, and the honest consequence is that **every
number in this document depends on one vendor's availability.** The paired
experiment below is blocked on it, not on anything about the catalog.

The split still holds for extraction, where a call carries one capture instead
of 197 entries. It was the fallback claim that was never true.

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
