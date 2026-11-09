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
npm install -g pnpm     # if you do not have it
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

Then `area <id>`, `show <id>`, `flow <id>`. Everything runs offline from a fresh
clone — the sanitized captures are committed, so no Brevo account is needed.

```bash
pnpm test        # 527 tests
pnpm validate    # schema, cross-references, flows re-derived, areas complete
pnpm scan        # leak gate
```

## Approach

Brevo publishes an API with 292 operations. **None of them appear in the 197
endpoints the app actually calls** — the public API and the product are
different systems. So this starts in a browser, not in a specification.

**The first version was a reconnaissance crawl, and it was a trap.** It produced
118 entries, 108 of them reads and exactly one write. A coverage count would
have reported "118 actions" and read as success. The eval scored **0 of 20** —
every action the brief names as an example exists only in the request a form
submission causes, and a crawler clicks nothing.

**The fix was not more automation.** I built selector-driven write passes for
six target routes; they reached two. What worked was **four hand-driven DevTools
recordings**, about fifteen minutes each, imported through a HAR parser that had
been written and tested in the first week with no caller. That took the capture
from 3 097 requests to 38 132 and the write endpoints from 4 to 38 — and it is
the decision I would defend hardest: **on wizards, a human demonstrating the
flow beats any selector I can guess at**, and the stage nobody designed as
load-bearing was the one that carried the project.

**Then the question changed what the thing had to be.** This catalogue is read
by an agent answering a person — *can I do this, what does it cost, what has to
be true first* — not by code issuing requests. That reframing is why:

- replies lead with the capability and the consequence, and the endpoint is
  evidence at the bottom;
- `destructive: true` renders as **CANNOT BE UNDONE**, because a field name
  cannot warn anyone;
- the 27 entries that are the app drawing itself are excluded from answers,
  since listing a font loader beside contacts presents the two as equivalent;
- the read-versus-change split is the headline — an area holding only reads says
  so, which is how an agent learns it can describe someone's automations and
  cannot help them build one;
- and the instruction lives in `AGENTS.md` and `pnpm catalog help`, not in a
  prompt, because an agent that clones this repository will not be handed one.

## What I built

- **197 entries, 170 of them things a user can do.** All 38 distinct write
  endpoints in the capture are covered.
- **Nine areas and three flows, both gated.** A module with no area fails the
  build; a flow's steps are re-derived from its capture window, so it cannot
  drift into a story someone remembers.
- **A selection eval**: 19 tasks phrased as a user would phrase them, never
  reusing the catalogue's wording. **15 of 19.**
- **Confidence as a required field.** `verified` means executed against a real
  account — **3 of 197**. The other 194 are real traffic never executed, so
  their inputs are a hypothesis and the entry says so.

## Trade-offs

**Risk is a product fact, not an HTTP fact.** Brevo reads using POST, so
deriving `destructive` from the verb shipped `get_count` as destructive. It now
means *irreversible, or visible outside the account*.

**No execution, and no host on any entry.** The catalogue describes; it does not
act. I built the host derivation before stating the question plainly, then
deleted it: a missing host blocks a request nobody is going to make.

**No retrieval layer.** The index is 18 519 tokens against the ~200 000 under
which published guidance says to skip retrieval. Measured, not assumed:
`pnpm bench:search` puts the right answer in the search's top three **5 of 19**
times against 15 of 19 for a model reading everything. Browse beats search here.

**3 of 197 verified is the weakest number.** Each proof is a hand-written
browser recipe; the three that exist took four runs each. Some entries fire six
at a time on page load and cannot be attributed to a click, some sit behind
five-screen wizards, some are paid-plan features a free account cannot reach.

## With more time

**First, the open question.** Of the 19 eval tasks, the 4 whose answer is
destructive score **1**; the other 15 score 13. A flag written to stop an agent
deleting the wrong contact may be stopping it from deleting the right one.
`pnpm eval --no-risk-labels` settles it in one run; provider quota has not
allowed it.

**Then production**, in order: verified coverage of 20-25 chosen by consequence
instead of 197; `execute_action`, at which point the missing host becomes a
defect rather than a decision; hybrid retrieval with reranking if this grows an
order of magnitude; and the eval on a second model, because a score from one
model is a property of that model.

**And what is broken:** `campaigns.send_now` is the most dangerous entry and is
unverified, sender creation is missing entirely — the one eval task with no
answer — and `ui.load_home` carries a path of `/undefined`, a crawler artefact
that survived into an entry.

[docs/NOTES.md](docs/NOTES.md) has the reasoning, the pipeline commands, and the
three numbers this repository published wrong before measuring them again.
