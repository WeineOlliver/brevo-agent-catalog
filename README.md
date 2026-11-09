<div align="center">

# brevo-agent-catalog

**What can a user do in this app? Ask the app, not its docs.**

![capabilities](https://img.shields.io/badge/user%20capabilities-170-2563eb)
![coverage](https://img.shields.io/badge/write%20endpoints-38%2F38-16a34a)
![eval](https://img.shields.io/badge/selection%20eval-14%2F19-ca8a04)
![verified](https://img.shields.io/badge/verified-3%2F197-ca8a04)
![tests](https://img.shields.io/badge/tests-530-2563eb)

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

`pnpm test` (530) · `pnpm validate` (the gate) · `pnpm scan` (leak gate)

## Approach

Spec and plan came before the code, and the plan ran test-first, task by task.
Both are in the history at commit `f7618f6`.

Brevo's public API has 292 operations. **None of them serve the 197 endpoints
the app calls** — measured on method, path and host. The host is the part that
matters: two entries claimed a public API until the matcher learned that
`cdp-analytics-api.brevo.com/account` is not `api.brevo.com/v3/account`.

So I watched the app instead of reading the spec. The first attempt was a
crawler: 118 entries, 108 reads, one write, and an eval of **0 of 20**. A
coverage count would have called 118 a success.

Selectors clicking the forms reached two of six routes. What worked was **four
hand-driven DevTools recordings**, fifteen minutes each: 3 097 requests to
38 132, writes from 4 to 38. On a wizard, a human demonstrating the flow beats
any selector I can guess.

Then the question changed the shape of the thing. An agent reads this to tell a
person *can I do this, what does it cost* — not to send requests. So answers
lead with the consequence and the endpoint is evidence at the bottom;
`destructive: true` prints as **CANNOT BE UNDONE**, because a field name warns
nobody; the 27 entries that are the app drawing itself leave the answer, because
a font loader is not something a user does; and the instructions live in
`AGENTS.md`, not in a prompt nobody will hand the agent.

## What I built

- 197 entries, **170 of them things a user can do**, covering all 38 write
  endpoints in the capture. **9 areas and 3 flows, both gated** — flow steps are
  re-derived from the capture, so a flow cannot drift from what the app did.
- **An eval**: 19 tasks worded like a user would. **14 of 19**, the run in
  `data/eval-report.json`. An earlier run scored 17 and three the next day gave
  15, 14 and 15; the badge carries the one you can open, spread 14 to 17.
- **Confidence is required.** `verified` means we ran it — **3 of 197**, and
  that is the weak spot: each proof is a hand-written browser script, and the
  three that exist took four runs each. The other 194 are traffic we saw and
  never ran, and say so.

## Trade-offs

- **Risk is a product fact, not an HTTP fact.** Brevo reads with POST, so a
  method-based rule marked `get_count` destructive. It now means *no undo, or
  visible outside the account*.
- **No execution, no host.** This describes; it does not act. I built the host
  lookup, then deleted it — nobody is sending these requests.
- **No search layer.** The index is 18 519 tokens against the ~200 000 where
  retrieval starts to pay. Measured: search puts the answer in its top three
  **5 of 19** times; a model reading everything gets 15 of 19.

## With more time

**The open question first.** The four eval tasks whose answer is destructive
score **1**; the other fifteen score 13. The warning label may be scaring the
model off the right action. `pnpm eval --no-risk-labels` answers it in one run;
quota blocked it.

**The renderer, before more data.** `pnpm catalog` is what an agent touches and
the thinnest part of the work: an entry says what a capability costs without
giving the agent the words to carry that to a person. A day there moves every
answer; twenty more verified entries move twenty.

**Then coverage, by the route that worked:** more hand-driven recordings, aimed
at the nested flows the first four missed. Fifteen minutes and a HAR import each
is what took writes from 4 to 38.

**Then:** 20-25 verified instead of 197, picked by risk; `execute_action`, which
is when the missing host becomes a bug; hybrid search if this grows tenfold; a
second model, because one model's score is a fact about that model.

**Broken and known:** `campaigns.send_now` is the most dangerous entry and
unverified. Sender creation is missing — the one eval task with no answer.
`ui.load_home` has a path of `/undefined`.

## On the timing

The brief gives 24 hours. I received it on Friday and the recruiter said Monday,
so I took Monday as the deadline and used that time. Written down rather than
left to be noticed, which is what the brief asks.

[docs/NOTES.md](docs/NOTES.md) has the reasoning and the commands.
