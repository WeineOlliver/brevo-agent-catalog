# Approach

How the problem was framed. The decisions themselves, with what was rejected and
what it cost, are in [decisions.md](decisions.md).

## The framing that drove everything

The brief asks for a catalog an AI agent can **act** on. A catalog an agent can
read is easy. One it can act on without a human double-checking is the hard part.

So the question stopped being *"how many actions can I list?"* and became
**"for each action, what do I actually know, and how do I say so in a way a
machine can filter on?"**

That is why `verification.status` is an enforced field and not a footnote.

## What reconnaissance settled before any code

Brevo publishes 292 API operations. Of those:

- **79** are partner and reseller surface no ordinary user ever sees.
- **0** cover automation, landing pages, forms, meetings or push — all of which
  exist in the product.

The public API and the product overlap. Neither contains the other. That is why
the pipeline starts in a browser instead of in a specification.

## What was built first, and why

| Order | What | Why first |
|:--|:--|:--|
| 1 | The honesty mechanism: schema, three confidence levels, fail-safe risk flags | A catalog that over-claims is worse than a smaller honest one. Getting this wrong is unrecoverable; getting coverage wrong is just a smaller number |
| 2 | Determinism everywhere available | Endpoints, spec matches and proof are derived in code. The model is spent only on what cannot be derived |
| 3 | A second capture source (HAR import) | The crawl depends on a session Brevo can refuse at any moment. Cheap to build early, impossible to retrofit late |
| 4 | The eval | "Designed for agents" is a claim. A score against tasks phrased the way a user would phrase them is a measurement |

Deliberately **not** done: an MCP server (decision #4), and execution at runtime.
The catalog describes actions; it does not perform them.

## What running it taught

Two things only showed up once it ran against a real account.

**The public API and the product are different systems.** 0 of 197 catalogued
endpoints appear in Brevo's published spec. An earlier, smaller catalog managed
2 of 126 — tripling the capture and adding every write flow did not add one
match. The app runs on about 20 internal microservices the public `/v3` surface
does not wrap.

**A crawl that clicks nothing produces a read-only catalog.** The first run
produced 118 actions, 108 of them `get` or `list`, and exactly one write. The
eval scored **0 of 20**. This was predicted in review before any code was
written and mitigated by designing the interaction stage in — then it happened
anyway, because the mitigation had not been run yet.

**And the fix was not more engineering.** Four hand-driven DevTools recordings,
about fifteen minutes each, took the capture from 3 097 requests to 38 132 and
the write endpoints from 4 to 38. The selector automation built for that job
reached two of six target routes. `parseHar` had been written and tested in the
first week with no caller, and became the stage that mattered most.

The lesson: for this class of problem, interaction is the coverage mechanism and
crawling is only reconnaissance.

## Current state

470 tests, strict TypeScript, leak gate clean. Run end to end against a live
account: 38 routes crawled plus four HAR sessions, 38 132 requests observed and
2 147 committed, 197 actions validated and indexed, eval at **17 of 19**.

All 38 write endpoints in the capture have an entry — including the irreversible
`POST /marketing-campaign/api/campaign/2/send-now` that returned 204, the 5-call
campaign machine and the 3-call CSV import wizard. 3 entries are `verified` by
execution, including the destructive `delete_contact`. The other 194 are
`observed`. Sender creation is missing entirely.

The numbers that look bad are in [gaps.md](gaps.md) and [eval.md](eval.md)
rather than omitted.

## Every command

Node 20+ and pnpm. `pnpm install` first.

| Command | What it does | Needs |
|:--|:--|:--|
| `pnpm build:schema` | Regenerate `schema/action.schema.json` from `src/types.ts` | nothing |
| `pnpm fetch:openapi` | Download and index Brevo's public spec | nothing |
| `pnpm brevo:login` | Save an authenticated session to `.auth/` | **a manual login** |
| `pnpm crawl` | Walk the app, recording XHR | a saved session |
| `pnpm explore` | Check what a create control actually opens | a saved session |
| `pnpm interact` | Write passes with throwaway fixtures | a saved session |
| `pnpm import:har` | Ingest a DevTools HAR export | a `.har` file |
| `pnpm sanitize` | `captures/raw` to `captures/clean`, redacted | captures |
| `pnpm extract` | Draft catalog entries | clean captures + a provider |
| `pnpm normalize` | Merge duplicates, enforce the risk rule | drafted actions |
| `pnpm validate` | Schema gate and cross-reference gate | drafted actions |
| `pnpm build:index` | Write `actions/index.json` | valid actions |
| `pnpm verify` | Execute chosen actions, stamp `verified` | a saved session |
| `pnpm eval` | Score whether a model picks the right action | a catalog index |
| `pnpm fix:crossrefs` | Rewrite prose citing ids that do not exist | a catalog + a provider |
| `pnpm build:docs` | Regenerate [modules.md](modules.md) | a catalog index |
| `pnpm scan` | **Leak gate.** Run before any push | nothing |
| `pnpm test` / `pnpm typecheck` | 470 tests, strict TypeScript | nothing |

`captures/clean/` is committed, so everything from `extract` onward runs offline.
The capture stages need a Brevo account of your own.

**Credentials.** None are committed. `pnpm extract --provider groq` wants
`GROQ_API_KEY` in `.env`; `--provider claude` shells out to an authenticated
`claude` CLI and needs no key. There is no Brevo API key anywhere — verification
drives the real UI instead.
