<div align="center">

# brevo-agent-catalog

**What can a user do in this app? Ask the app, not its docs.**

![capabilities](https://img.shields.io/badge/user%20capabilities-170-2563eb)
![coverage](https://img.shields.io/badge/write%20endpoints-38%2F38-16a34a)
![eval](https://img.shields.io/badge/selection%20eval-15%2F19-ca8a04)
![verified](https://img.shields.io/badge/verified-3%2F197-ca8a04)
![tests](https://img.shields.io/badge/tests-527-2563eb)

</div>

> **If you are an agent:** read [AGENTS.md](AGENTS.md) or run `pnpm catalog help`.
> Answer product questions with `pnpm catalog`, not by reading `actions/*.json`.

## Quickstart

```bash
pnpm install
pnpm catalog
```

```
A user can do 170 things in this app, across 8 areas.
31 of them change something; the other 139 only look.

Contacts and audiences  —  12 to change, 52 to look at, 3 of them cannot be undone
  Hold the people you market to, and cut them into lists and segments.
  for example: Add contact to lists · Create contact · Delete contact
  takes more than one step: onboard_contact, erase_contact
  -> pnpm catalog area contacts

Automation  —  6, all read-only — nothing here changes anything
```

Then `area <id>`, `show <id>`, `flow <id>`. Every command takes `--json`, and
every reply ends with the next one. Nothing needs credentials: the sanitized
captures are committed, so the whole thing runs offline from a fresh clone.

```bash
pnpm test        # 527 tests
pnpm validate    # schema, cross-references, flows re-derived, areas complete
pnpm scan        # leak gate
```

## What I built

Brevo publishes an API with 292 operations. **None of them appear in the 197
endpoints the app actually calls** — the public API and the product are
different systems. So this starts in a browser, not in a specification: drive
the real app, capture its traffic, and turn that into a catalogue an agent can
answer questions from.

- **197 entries**, of which **170 are things a user can do**. The other 27 are
  what the web app calls to render itself — fonts, locales, feature flags — kept
  but excluded from answers, because listing them beside contacts would present
  them as equivalent.
- **Every one of the 38 distinct write endpoints** in the capture has an entry.
- **Nine areas** named after what a person does, because the 62 URL-derived
  modules are the wrong axis: 34 hold a single entry, and sending one campaign
  crosses three of them. A module with no area fails the build.
- **Three multi-step flows**, derived rather than written. Each names a capture
  file and a time window, and its steps are the calls Brevo's own UI made in
  that window, in order. `pnpm validate` re-derives them, so a flow cannot drift
  into a story.
- **A selection eval**: 19 tasks phrased the way a user would phrase them, never
  reusing the catalogue's wording. **15 of 19.** It scored 0 of 20 on the first
  run, which is what turned "118 entries" into a reframing of the whole project.

Confidence is a required field, not a footnote. `verified` means executed
against a real account — **3 of 197**. `observed` means seen in real traffic but
never executed, so its inputs are a hypothesis — the other 194.

## Trade-offs

**Risk is a fact about the product, not about the HTTP method.** Brevo reads
using POST, so deriving `destructive` from the verb shipped `get_count` as
destructive. It now means *irreversible, or visible outside the account*.

**The catalogue answers; it does not act.** No `execute_action`, no Brevo API
key, and entries deliberately record no host — so they are not callable. Half a
day went into adding one before the question was stated plainly.

**No retrieval layer.** The whole index is 18 519 tokens, against the ~200 000
under which published guidance says to skip retrieval. Measured rather than
assumed: `pnpm bench:search` puts the right answer in the search's top three
**5 of 19** times, against 15 of 19 for a model reading everything. Browse beats
search at this size.

**3 of 197 verified is the weakest number here.** Each proof is a hand-written
browser recipe, and the three that exist took four runs each. Some entries fire
six at a time on page load and cannot be attributed to a click; some sit behind
five-screen wizards; some are paid-plan features a free account cannot reach.

**The eval has one provider.** Groq cannot run it — one call is 14 846 tokens
against an 8 000 TPM ceiling — so every number in it depends on one vendor.

## With more time

1. **Settle whether the `destructive` label is suppressing selection.** Of the
   19 eval tasks, the 4 whose answer is destructive score 1; the other 15 score
   13. A flag written to stop an agent deleting the wrong contact may be
   stopping it from deleting the right one. One run of
   `pnpm eval --no-risk-labels` answers it.
2. **Verified coverage of 20-25, chosen by consequence** — every destructive
   action, one per flow, one per response shape. Not 197: representative
   coverage is the reachable goal, and `campaigns.send_now` is the entry that
   matters most and is still unproven.
3. **Record the sender-creation flow.** Fifteen minutes of capture closes the
   one eval task with no answer in the catalogue.
4. **`execute_action`.** Where this goes in production, and the point at which
   the missing host becomes a defect rather than a decision.

[NOTES.md](docs/NOTES.md) has the decisions behind the above, including the ones
that were wrong first. The commit history carries the rest: every number in this
README was measured, and three of them were published wrong before they were
measured again.
