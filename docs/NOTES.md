# Notes

The decisions behind the README, and the ones that were wrong first. Kept short
on purpose; the commit history has the full reasoning for each.

## Why crawl the app instead of generating from the public API

The two surfaces barely meet. Of Brevo's 292 published operations, 79 are
partner and reseller surface no ordinary user sees, and **none covers
automation, landing pages, forms, meetings or push** — all of which exist in the
product. 0 of the 197 endpoints this catalogue holds appear in the spec, matched
on method, path and host — the app runs on more than fifty internal hosts the
public `/v3` surface does not wrap, and matching without the host is how the two
false positives below got in.

**Cost accepted:** the typed inputs here are mostly inferred by a model from
captured traffic rather than taken from a published contract. Treat `inputs` on
an `observed` entry as a hypothesis about a request's shape.

## Crawling finds reads; only interaction finds writes

The first run produced 118 entries, 108 of them reads and exactly one write, and
the eval scored **0 of 20**. A coverage count would have reported 118 and read
as success. Every action the brief names as an example exists only in the
request a form submission causes, and a crawler clicks nothing.

The fix was not more engineering. Selector automation reached two of six target
routes; **four hand-driven DevTools recordings**, about fifteen minutes each,
took the capture from 3 097 requests to 38 132 and the write endpoints from 4 to
38. A human demonstrating a flow beats selector automation on wizards.

## Risk is a product fact, not an HTTP fact

Deriving `destructive` from the method shipped `get_count` as destructive,
because Brevo reads using POST. An agent that learns to ignore the flag on reads
will ignore it on deletes. It now means *irreversible, or visible outside the
account*: creating a contact is not destructive, sending a campaign is.

## The catalogue answers questions; it does not make requests

The agent this serves is telling a person what they can do, what it costs, and
what has to be true first. So replies lead with the capability and the
consequence, and the endpoint is evidence at the bottom.

This was assumed rather than decided, and the assumption cost half a day.
Measuring the captures found 51 hosts and no host field: `account.get_account`
says `GET /account` where the real request is
`GET https://editor-api.brevo.com/editor-api/account`. It was written up as the
most serious defect here and the fix was two hours of deterministic work — then
cancelled, because a missing host blocks a request nobody is going to make. The
code was deleted rather than shipped unused.

**Cost accepted:** this cannot be wired to anything that acts until that work is
done. The 20-25 verified executions in the plan all run through the real UI,
where the host is whatever the browser used, so the plan does not depend on it.

## Where the model was wrong, and how it was caught

Every one of these was caught by a check, not by reading the output.

| What | How |
|:--|:--|
| Invented 6 actions out of URLs I had made up myself | Noticed while reading for something else |
| Cited 41 action ids that do not exist | A checker written to look for exactly that; now gated at zero |
| Flagged safe reads as destructive, and a risky action as safe | Measuring the rule against all 197 |
| Leaked phone numbers and encoded emails past the gate | Grepping the committed files by hand |
| Answered "no action fits" while printing as a parser error | Reading the stored report instead of the console |

Two models, split by job: Groq for volume, headless Claude Code for judgement.
The eval runs on Claude only, because one call ships the whole catalogue and
Groq rejects it at 14 846 tokens against an 8 000 TPM ceiling. The header
claimed Groq was available as a fallback; nobody had tried it.

## Numbers that were published wrong

Worth stating, because the catalogue's argument is that measured claims beat
confident ones, and these are what that costs.

- **Public API overlap** read `0 of 197` unmeasured, was corrected to `2` by an
  audit, and is `0` again — but for a day the prose said `0` while the shipped
  JSON still said `2`, which is the worse of the two errors: a reader and an
  agent got different answers from the same repository. Both matches were false
  positives of a matcher that compared paths while ignoring hosts, so
  `GET /account` on `cdp-analytics-api.brevo.com` claimed the public
  `getAccount`. The matcher now gates on the host the spec declares, the two
  entries say `exists: false`, and one of them had inherited a `sort` parameter
  from the public operation that appears in no captured request — a wrong match
  does not just mislabel an entry, it invents inputs.
- **The eval** was published as `17 of 19` from a single run. Three runs the
  next day gave 15, 14 and 15. The badge carried 15 while the committed report
  said 14; the badge now carries 14, the run you can open, and the spread is 14
  to 17.
- **The plumbing count** was 23 by hand and is 27 by the table that now gates
  it.

## The pipeline, in order

Each stage writes what the next one reads, so any of them can be re-run alone.
Everything from `sanitize` onwards works from the committed captures with no
Brevo account; the browser stages need one of your own.

| Command | Does | Needs |
|:--|:--|:--|
| `pnpm brevo:login` | Saves a session to `.auth/` | a manual login |
| `pnpm crawl --login` | Walks the app, recording XHR | a live login |
| `pnpm explore` | Reports what each create control actually opens | a live login |
| `pnpm interact` | Write passes with throwaway `catalog-test-*` fixtures | a live login |
| `pnpm import:har` | Ingests a DevTools HAR export | a `.har` file |
| `pnpm sanitize` | `captures/raw` to `captures/clean`, redacted | captures |
| `pnpm extract` | Drafts catalogue entries | clean captures + a provider |
| `pnpm normalize` | Merges duplicates, enforces the risk rule | drafted actions |
| `pnpm fix:crossrefs` | Rewrites prose citing ids that do not exist | a catalogue + a provider |
| `pnpm validate` | **The gate**: schema, cross-references, flows, areas | actions |
| `pnpm build:index` | Writes `actions/index.json` | valid actions |
| `pnpm build:flows` | Re-derives `flows/index.json` from the captures | captures + actions |
| `pnpm build:schema` | Regenerates the JSON Schemas from the Zod contracts | nothing |
| `pnpm fetch:openapi` | Downloads and indexes Brevo's public spec | nothing |
| `pnpm verify --login` | Executes chosen actions, stamps `verified` | a live login |
| `pnpm eval` | Scores whether a model picks the right action | **provider quota** |
| `pnpm bench:search` | Scores the CLI search with no model at all | nothing |
| `pnpm catalog` | Answers what a user can do | nothing |
| `pnpm scan` | **Leak gate.** Run before any push | nothing |
| `pnpm test` / `pnpm typecheck` | 530 tests, strict TypeScript | nothing |

`pnpm eval` is the only command that spends money. A saved session does not work
against Brevo — `storageState` does not carry `sessionStorage` — so the browser
stages take `--login` and sign in inside the window they open.

## Known gaps

- `campaigns.send_now` is the most dangerous entry and is unverified, behind a
  five-call wizard. Its preconditions are written down and marked inferred.
- Sender creation is missing entirely — the one eval task with no answer.
- Three overlapping list reads cost one eval task; both descriptions were
  rewritten and the model's choice did not move, so it is a taxonomy problem.
- `ui.load_home` has a path of `/undefined`, a crawler artefact that survived
  into an entry.
- `plan_tier` is `unknown` for 192 of 197: the account is free tier.
- Automation, landing pages, forms, meetings and push are where an agent most
  needs a catalogue and where this one is least reliable — no public API to
  enrich from, and no interaction pass outside `contacts`.
