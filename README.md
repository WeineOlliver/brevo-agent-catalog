<div align="center">

# brevo-agent-catalog

**What can a user do in this app? Ask the app, not its docs.**

![capabilities](https://img.shields.io/badge/user%20capabilities-170-2563eb)
![coverage](https://img.shields.io/badge/write%20endpoints-38%2F38-16a34a)
![eval](https://img.shields.io/badge/selection%20eval-15%2F19-ca8a04)
![verified](https://img.shields.io/badge/verified-3%2F197-ca8a04)
![tests](https://img.shields.io/badge/tests-527-2563eb)

</div>

> **Agents:** read [AGENTS.md](AGENTS.md) or run `pnpm catalog help`. Answer from
> `pnpm catalog`, not from `actions/*.json`.

## Quickstart

```bash
npm install -g pnpm   # if you need it
pnpm install
pnpm catalog
```

```
A user can do 170 things in this app, across 8 areas.
31 of them change something; the other 139 only look.

Contacts and audiences  —  12 to change, 52 to look at, 3 of them cannot be undone
  for example: Add contact to lists · Create contact · Delete contact
  takes more than one step: onboard_contact, erase_contact
  -> pnpm catalog area contacts

Automation  —  6, all read-only — nothing here changes anything
```

Then `area <id>`, `show <id>`, `flow <id>`. No Brevo account needed: the
sanitized captures are committed, so a fresh clone runs offline.

`pnpm test` (527) · `pnpm validate` (the gate) · `pnpm scan` (leak gate)

## Approach

Brevo's public API has 292 operations. **None of them appear in the 197 the app
actually calls.** So I watched the app instead of reading the spec.

The first attempt was a crawler. It found 118 entries: 108 reads, one write. The
eval scored **0 of 20**. A coverage count would have called 118 a success.

Writing selectors to click the forms reached two of six target routes. What
worked was **four hand-driven DevTools recordings**, fifteen minutes each. The
capture went from 3 097 requests to 38 132, writes from 4 to 38. On a wizard, a
human demonstrating the flow beats any selector I can guess.

Then the question changed the shape of the thing. An agent reads this to answer
a person — *can I do this, what does it cost* — not to send requests. So:

- answers lead with the consequence; the endpoint sits at the bottom as evidence
- `destructive: true` prints as **CANNOT BE UNDONE**, because a field name warns
  nobody
- the 27 entries that are the app drawing itself are out of the answer; a font
  loader is not something a user does
- an area with only reads says so
- the instructions live in `AGENTS.md` and `pnpm catalog help`, not in a prompt
  the agent will never be handed

## What I built

- 197 entries, **170 of them things a user can do**. All 38 write endpoints in
  the capture are covered.
- **9 areas and 3 flows, both gated.** Flow steps are re-derived from the
  capture, so a flow cannot drift from what the app did.
- **An eval**: 19 tasks worded like a user would word them. **15 of 19.**
- **Confidence is required.** `verified` means we ran it — **3 of 197**. The
  other 194 are traffic we saw and never ran, and say so.

## Trade-offs

- **Risk is a product fact, not an HTTP fact.** Brevo reads with POST, so a
  method-based rule marked `get_count` destructive. It now means *no undo, or
  someone outside the account sees it*.
- **No execution, no host.** This describes; it does not act. I built the host
  lookup, then deleted it — nobody is sending these requests.
- **No search layer.** The index is 18 519 tokens, and guidance says skip
  retrieval under ~200 000. Measured: search puts the answer in its top three
  **5 of 19** times; a model reading everything gets 15 of 19.
- **3 of 197 verified is the weak spot.** Each proof is a hand-written browser
  script, and the three that exist took four runs each.

## With more time

**The open question, first.** The four eval tasks whose answer is destructive
score **1**. The other fifteen score 13. The warning label may be scaring the
model off the right action. `pnpm eval --no-risk-labels` answers it in one run;
quota blocked it.

**Production:** 20-25 verified instead of 197, picked by risk. Then
`execute_action` — that is when the missing host becomes a bug. Then hybrid
search if this grows tenfold. Then a second model, because one model's score is
a fact about that model.

**Broken and known:** `campaigns.send_now` is the most dangerous entry and
unverified. Sender creation is missing — the one eval task with no answer.
`ui.load_home` has a path of `/undefined`.

[docs/NOTES.md](docs/NOTES.md) has the reasoning and the commands.
