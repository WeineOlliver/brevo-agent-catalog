# Decisions

Every architectural decision, the alternatives rejected, and **the cost
accepted**. That last part is the point: a decision record without costs is a
list of claims.

| # | Decision | Jump |
|:--|:--|:--|
| 1 | Crawl the app; do not generate from the public API | [read](#1-discover-by-crawling-the-app-not-by-reading-the-public-api) |
| 2 | Verify by driving the real UI, not by replaying endpoints | [read](#2-verify-by-driving-the-real-ui-not-by-replaying-captured-endpoints) |
| 3 | Two model providers, split by job | [read](#3-two-model-providers-split-by-job) |
| 4 | No MCP server | [read](#4-no-mcp-server) |
| 5 | ~~Risk flags derived from the HTTP method~~ **superseded by #12** | [read](#5-fail-safe-risk-flags-enforced-in-code) |
| 6 | Commit the sanitized captures; gate them independently | [read](#6-commit-the-sanitized-captures-gate-them-independently) |
| 7 | A second capture source, so the crawler is not a single point of failure | [read](#7-a-capture-source-abstraction-so-the-crawler-is-not-a-single-point-of-failure) |
| 8 | Zod as the source of truth; JSON Schema generated | [read](#8-zod-as-the-source-of-truth-json-schema-generated) |
| 9 | Core actions chosen after the crawl, not before | [read](#9-core-actions-chosen-after-the-crawl-not-before) |
| 10 | Crawl in the signed-in context, not from a saved session | [read](#10-crawl-in-the-signed-in-browser-context-not-from-a-saved-session) |
| 11 | Interaction is the coverage mechanism; crawling is reconnaissance | [read](#11-interaction-is-the-coverage-mechanism-crawling-is-reconnaissance) |
| 12 | Risk is a fact about the product, not about the HTTP method | [read](#12-risk-is-a-fact-about-the-product-not-a-property-of-the-http-method) |
| 13 | Eval expectations are reconciled against the capture, never the model | [read](#13-the-evals-expected-ids-are-reconciled-against-the-catalog-never-against-the-models-answer) |
| 14 | Two groupings: modules for the capture, areas for people | [read](#14-two-groupings-modules-for-reading-the-capture-areas-for-finding-a-feature) |
| 15 | Flows are derived from the capture, never authored | [read](#15-flows-are-derived-from-the-capture-never-authored) |
| 16 | No retrieval layer, because the index fits in a prompt | [read](#16-no-retrieval-layer-because-the-whole-index-fits-in-a-prompt) |

Each section carries what it cost. If you read one, read #12 — it is the only
one that reversed an earlier decision after measurement.

---

## 1. Discover by crawling the app, not by reading the public API

**Decided:** The pipeline starts in an authenticated browser. Brevo's published
OpenAPI spec is used only as *enrichment*, joined onto endpoints the crawl
actually observed.

**Rejected:** Generating the catalog from the OpenAPI spec alone. It would have
taken an hour instead of a weekend.

**Why:** The two surfaces only overlap. Of the spec's 292 operations, **79 are
master-account, balance, program, reward, tier and wallet** — partner and
reseller APIs no ordinary user ever meets. Meanwhile the spec has **no tagged
coverage for automation and workflows, landing pages, forms, meetings or push**,
all of which exist in the product. A spec-derived catalog would simultaneously
over-report capability the user does not have and miss the surfaces where an
agent most needs help. It would also answer the wrong question: the brief is
about systems whose public API does not cover enough.

**Cost accepted:** Far more work, a dependency on a live session, and a crawl
that can be blocked. Coverage is bounded by what the crawl reaches in a weekend
rather than by what a document lists.

---

## 2. Verify by driving the real UI, not by replaying captured endpoints

**Decided:** `pnpm verify` executes an action through the interface with
Playwright and stamps `verified` only when a matching request actually succeeded.

**Rejected — replaying the captured internal endpoint:** brittle against CSRF
tokens and session expiry, and it proves the *endpoint* works, not that the
business action a user performs works.

**Rejected — calling the public API:** cheap, but it only reaches the subset of
actions that already have public coverage — precisely the subset that least needs
proving. `verified` would have become a near-worthless signal, concentrated
exactly where the catalog adds least.

**Why:** UI execution proves the business action as a user performs it, and it is
the only mechanism that reaches the UI-only surfaces (automation, landing pages,
forms) where this catalog is worth the most. It also means **no Brevo API key
exists in this project at all.**

**Cost accepted:** A verification recipe is hand-written per action, so verified
coverage grows slowly. Recipes break when Brevo's markup changes. Verification
cannot run unattended.

---

## 3. Two model providers, split by job

**Decided:** Groq for the high-volume breadth pass; headless Claude Code
(`claude -p`) for the core tier and the judgment-heavy fields. One interface,
two adapters.

**Rejected — one provider for everything:** simpler, and the honest default if
only one were available.

**Why:** The two halves of this problem are genuinely different. Drafting
entries across ~200 routes is a throughput problem: cheap, fast, parallel.
Writing a description that disambiguates `create_contact` from `update_contact`,
inferring a precondition, and judging whether an action is destructive is a
judgment problem, and those fields are exactly what Reliability is scored on.
Using `claude -p` also means the Claude half needs **no API key** — it rides the
machine's existing authenticated session.

**Cost accepted:** Two code paths and two failure modes. Headless Claude Code is
slow and not built for fan-out, so it cannot be used for breadth. The pipeline
requires the operator to be logged into Claude Code, which makes end-to-end
reproduction by a third party impossible — documented rather than hidden.

---

## 4. No MCP server

**Decided:** The deliverable is JSON files plus `actions/index.json`. A selection
eval, not a server, demonstrates that the format works for agents. An MCP server
is a stretch goal only.

**Rejected:** Shipping an MCP server exposing `search_actions` / `get_action`.

**Why:** It scores on none of the three evaluation axes. Coverage is how much was
found; Reliability is whether entries are accurate; "Use of AI" is explicitly the
*system designed to get there*, not an AI-facing endpoint that ships with it. The
context-pressure argument for a search server also does not hold at this scale:
200 entries of id plus description is roughly 8k tokens, which fits in any modern
context window without strain. An agent with file access and an index has no
discovery problem here. And a polished server in front of a thin catalog reads as
padding.

What the server *would* have bought — proof that the descriptions actually
resolve a task to the right action — is bought more directly by the selection
eval, which produces a number instead of an assertion.

**Cost accepted:** No live demo to click through. If a reviewer wants to see an
agent consuming the catalog, they see a score and a task list rather than a
session.

---

## 5. Fail-safe risk flags, enforced in code

> **Superseded by [#12](#12-risk-is-a-fact-about-the-product-not-a-property-of-the-http-method).**
> The principle held — risk is clamped in code, never taken from the model — but
> deriving it from the HTTP method was wrong, because Brevo reads using POST.
> Kept here because the replacement only makes sense against what it replaced.

**Decided:** Any action whose method is not GET/HEAD/OPTIONS is
`destructive: true, idempotent: false` until execution proves otherwise. Applied
in `src/extract/draft.ts` after schema validation, overwriting whatever the model
claimed. Only a `verified` outcome can relax either flag.

**Rejected — trusting the model's judgment:** it is asked for these fields and
usually right.

**Rejected — a third `unknown` state:** more honest in the abstract, but a
harness needs a definite answer to the question "do I stop and ask a human?", and
`unknown` just moves the decision into every consumer.

**Why:** A wrong `destructive: false` on a send-or-delete action is the single
most expensive error this catalog can ship — it is the value a harness uses to
decide whether to interrupt a human. The prompt asks for the rule; code enforces
it, because a prompt is a request and this needs to be a guarantee. Provenance is
carried by `verification.status` instead of by a third flag value.

**Cost accepted:** Genuinely safe writes are over-gated until verified, so an
agent asks for confirmation more often than strictly necessary. That is the
correct direction to be wrong in.

---

## 6. Commit the sanitized captures; gate them independently

**Decided:** `captures/raw/` is never committed; `captures/clean/` is, because
`verification.evidence` points into it. Redaction uses structure-preserving
placeholders. A separate scanner re-derives the patterns and gates every push.

**Rejected — committing nothing:** then no evidence is checkable and `verified`
is just a word.

**Rejected — stripping identifiers entirely:** `internal_endpoint.body_example`
stops being usable by an agent, which guts the most useful field in the entry.

**Why:** Evidence a reviewer cannot open is not evidence. Placeholders keep the
body shape intact — `{"listIds":["{{LIST_ID}}"]}` still tells an agent the field
is an array. The scanner is deliberately *not* implemented by calling the
redactor: a gate that asks the thing it is checking whether it did its job cannot
fail.

**Cost accepted:** Committed captures are a permanent surface for a leak, so the
gate has to be right. It skips one file by design — Brevo's own 1.2 MB public
spec, which carries Brevo's example addresses and would otherwise produce
permanent false positives that train the operator to ignore the gate.

---

## 7. A capture-source abstraction, so the crawler is not a single point of failure

**Decided:** Everything downstream consumes `CaptureRecord`. The Playwright crawl
is one source; a DevTools HAR exported by hand is another.

**Rejected:** Coupling extraction directly to Playwright.

**Why:** Brevo may present 2FA, a captcha, device verification or bot detection
at any point, and the session can expire mid-crawl. Without this, a blocked crawl
on the Sunday of a weekend deadline takes the entire deliverable with it. With
it, the operator browses by hand, exports a HAR, and stages 3–8 run unchanged.

**Cost accepted:** One more type and one more parser than a direct coupling would
have needed.

---

## 8. Zod as the source of truth, JSON Schema generated

**Decided:** `src/types.ts` defines the contract in Zod;
`schema/action.schema.json` is generated from it; a test fails if they drift.

**Rejected:** Hand-writing the JSON Schema, or maintaining both.

**Why:** Two hand-maintained copies of a contract diverge, and the divergence
shows up as entries that pass one validator and fail the other.

**Cost accepted:** `zod-to-json-schema` has no draft-2020-12 target, so the
schema is generated at 2019-09 and `$schema` is set to 2020-12. Every construct
used here is identical across the two drafts, and the sync test compiles the
result with Ajv's 2020 build — so the claim is proven rather than asserted.

---

## 9. Core actions chosen after the crawl, not before

**Decided:** Which actions count as "core", and which are worth verifying, is
decided from the finished catalogue. The verify harness is therefore generic,
with recipes added per chosen action.

**Rejected:** Fixing a list of core actions up front.

**Why:** "Core" means the actions that make up the main platform experience, and
what that actually is in Brevo is an empirical question the crawl answers. A list
written beforehand would have been a guess dressed as a requirement.

**Cost accepted:** Verified coverage cannot be planned or promised in advance,
and the verify recipe set starts almost empty.

---

## 10. Crawl in the signed-in browser context, not from a saved session

**Decided:** `pnpm crawl --login` and `pnpm interact` sign in and work in one
browser context. Nothing is serialised and restored.

**Rejected:** Playwright's `storageState`, which is the obvious approach and was
the original design.

**Why:** It does not work against Brevo. Login detected the dashboard and saved
state; the crawl, starting seconds later in a fresh context, landed on
`login.brevo.com`. `storageState` carries cookies and localStorage but **not
`sessionStorage`**. Rather than reverse-engineer which token Brevo keeps where —
interesting, but not what this project is about — the restore step was removed.

**Cost accepted:** The crawl must run headed and attended, and cannot be
scheduled. For a stage that requires a human login anyway, that was already true.

---

## 11. Interaction is the coverage mechanism; crawling is reconnaissance

**Decided:** Six write passes (contacts, lists, segments, campaigns, templates,
senders) are the primary source of business actions. The crawl's job is to map
the route surface and the read API.

**Rejected:** Treating the crawl as the main discovery mechanism with write
passes as a supplement, which is how the original plan was weighted.

**Why:** Measured. The crawl produced 118 actions of which 108 are `get`/`list`
and one is a write, and the selection eval scored 0 of 20 on the tasks a user
would actually ask for. A crawler that follows links and clicks nothing observes
`GET` traffic; every action the brief names as an example lives behind a form
submission. This was flagged as a risk in design review before any code existed,
and then occurred at full strength because the mitigation had not been run.

**Cost accepted:** Coverage now depends on hand-written interaction passes, which
do not scale and break when Brevo's markup drifts. Each new module is a
development task, not a crawl parameter. That is a real ceiling on Coverage and
it is the honest trade: a smaller catalog of actions that are actually actions.

---

## 12. Risk is a fact about the product, not a property of the HTTP method

**Decided:** `destructive` means **irreversible or observable outside the
account**, and is derived in normalisation from the action's verb
(`src/catalog/risk.ts`), with precedence rather than position: the most
dangerous verb in an id wins. Our crawler's permission to click destructive
controls (`ExplorePolicy`) is a separate decision and stays separate.

**Rejected:** Deriving it from the method, which decision #5 effectively did —
anything not `GET` was `destructive: true` until execution proved otherwise.

**Why:** Measured, twice over. Brevo reads through POST, so the first extraction
produced `segments.get_count`, `segments.paginated_count`,
`segments.query_contacts` and `transactional.fetch_email_logs` all flagged
destructive — an agent obeying the flag refuses four harmless reads, and an
agent that learns to ignore it on reads will ignore it on `delete`. The method
rule also fails in the opposite direction: `create_contact` mutates and is safe
(reversible, our own data), while `campaigns.send_now` creates nothing and is the
most dangerous action in the product, because it mails real people and has no
undo. "Not a read" and "destructive" are not the same question.

Measured a third time once the hand-driven HAR sessions tripled the write
set. 163 of 168 ids classified; the five that fell through to the fail-safe
draft were worth the look, and they split three ways:

- Two were reads shipping as destructive, the original bug in a new costume.
  `POST /import/suggest-mapping-from-file` returns a proposed CSV column
  mapping and imports nothing, and `segments.paginated_count` is a count. So
  `find` and `suggest` joined the read verbs.
- One was right only by luck. `POST /contact/backend/actions/list` is a
  dispatcher whose payload names the operation — the entry itself says "e.g.,
  delete contacts from a list" — and no name can classify that, so `bulk`
  escalates. The drafted flag had been correct; a different draft would not
  have been, and luck is not a safety property.
- One needed the whole-name scan rather than a new rule.
  `contacts.link_unlink_company` is one endpoint doing both halves, so `link`
  is reversible and `unlink` is not, and the id escalates on its worse half.

`segments.paginated_count` was fixed by **renaming** it to
`segments.count_paginated`, not by teaching the rule to find a verb in third
position. The rule still returns null for a verb that is not first, and the
test asserting that is still there: an id whose verb is buried is a naming
defect, and the fix for a naming defect is the name. Parsing English here
would make every future mis-named action a silent safety guess.

The account under test is disposable, which removes the risk from *our* clicking
but not from the flag: the catalog is the contract the final product maps, so the
flag has to be true of Brevo regardless of which account observed it.

**Cost accepted:** Three, all stated rather than hidden.

1. The verb table is hardcoded, which every other rule in `normalize.ts`
   deliberately avoids. Risk cannot be derived from the catalog's shape — no
   amount of captured traffic says that a send cannot be taken back.
2. Ambiguous verbs are over-flagged on purpose. `remove` is reversible for a
   list membership and not for a contact, so it counts as destructive. A
   needless confirmation costs a click; a missing one costs data.
3. **`contacts.add_contact_to_lists` is classified reversible, and that is
   arguably wrong.** Adding a contact to a list can trigger a Brevo automation,
   which sends real email — an external effect by this decision's own
   definition. It stays reversible because the effect depends on the account
   having an active workflow, which is not a property of the action; the right
   home for it is `side_effects`, not the flag. This is the clearest known hole
   in the rule.

## 13. The eval's expected ids are reconciled against the catalog, never against the model's answer

**Decision:** When an eval task names an action id the catalog does not have,
the id is corrected to the entry that the *captured traffic* proves answers the
prompt. It is never corrected to whatever the selector happened to choose.

**Why this needed stating:** The fixture was written before the catalog existed,
with ids following the `module.verb_object` convention as a guess. After
extraction, 12 of 20 named nothing. That is the planned step — the fixture's own
note said the ids "must be reconciled against the real catalog after
extraction" — but it is also the single easiest place in this project to cheat,
and the cheat is invisible in the final number.

So the rule is the source of the correction, not the direction of it. Each of the
11 reconciled ids is justified by the catalog entry or the request body:

| Guessed | Corrected to | Evidence |
|---|---|---|
| `campaigns.send_campaign` | `campaigns.send_now` | `POST /marketing-campaign/api/campaign/:id/send-now`, the irreversible send |
| `contacts.import_contacts` | `contacts.analyze_import_file` | first call of the 3-step wizard; `save_import_mapping` needs its output |
| `campaigns.get_campaign_report` | `campaigns.get_campaign_stats` | per-campaign open/click counters; `get_statistics` is a date-range aggregate |
| `contacts.unsubscribe_contact` | `contacts.update_contact` | the capture sends `emailBlacklisted: true` to `PATCH /contact/backend/contacts/update` |
| `lists.add_contacts_to_list` | `contacts.bulk_modify_list` | `POST /contact/backend/actions/list` carries `action: ADD_TO_LIST` |
| 6 others | module renames | normalisation moved the module; same action |

`senders.create_sender` was deliberately **not** reconciled. The flow was never
demonstrated, so no entry exists, and the eval reports it as a coverage gap on
every run. Mapping it to a near neighbour would have raised the score by hiding
the one thing the eval knows that the catalog does not.

**The one widening, and why it is not the cheat it resembles:** `EvalTask` gained
`acceptableActionIds`, used on exactly one task. Brevo removes a single contact
from a single list two ways, and the capture holds both on the same contact —
`PATCH /contact/backend/contacts/update` with `unlinkListIds: [5]` from the
contact form, and `POST /contact/backend/actions/list` with
`action: DELETE_FROM_LIST, ids: [3]` from the listing row. The selector chose the
second; the fixture expected the first. Neither is wrong, so scoring one as a
miss measures the fixture rather than the catalog.

The guard is that this cannot be done quietly: a pass through an alternative
prints as `✓ <id> (accepted alternative to <expected>)`, so widening is visible
in the run output every time it happens.

**Rejected:** Scoring the task as a miss and leaving it. Tempting, because a
lower number looks more honest. It is not more honest — it is a known-wrong
measurement kept for appearances, and the next person to read the eval would have
to rediscover that one of its four misses was never a defect.

**Cost accepted:** `acceptableActionIds` is a mechanism that *could* be used to
inflate a score, and nothing in the code prevents that. The defences are social
rather than technical: the bar written into the type's docstring, the printed
marker, and the fact that the only entry today cites two request bodies.


---

## 14. Two groupings: modules for reading the capture, areas for finding a feature

**Decision:** Keep `module`, and add `area`. Every action carries both. Modules
stay as they are — derived from the first segment of the internal URL — and nine
areas named after what a person does in the app are stamped onto every index
entry from a table in `src/catalog/areas.ts`.

**Why this needed stating:** The module grouping looked like a taxonomy and was
not one. 62 modules hold 197 actions, **34 of them hold exactly one**, and the
single act of sending a campaign crosses `email_campaigns`, `editor` and
`marketing_campaign`. Nobody asks for a feature by hostname. But modules are not
wrong either — they are exactly right for reading a capture, where the question
is which service answered. Two questions, two axes.

**Rejected: replacing modules with areas.** It would have destroyed the only
grouping that matches the evidence, and every `module` in every entry, doc and
generated listing traces back to a URL that really was called.

**Rejected: asking a model to assign the areas.** Naming is a judgement, and a
judgement belongs somewhere it can be argued with and diffed. The table is 60
lines and reads as an opinion, which is what it is.

**The rule that makes it a grouping rather than a label:** a module with no area
is fatal in `buildIndex` and fails `pnpm validate`. It does not fall into the
catch-all. A catch-all that fills itself becomes the largest box in the taxonomy
without anyone choosing that, and the first new module would have started it.

**Cost accepted:** Two groupings is two things to keep straight, and the
`platform` area is a judgement call about 27 entries that someone could
reasonably draw differently — `settings.list_timezones` is a static reference
list that a form genuinely needs. The 23-versus-27 correction in
[gaps.md](gaps.md) is what that costs when it is done by hand instead.

---

## 15. Flows are derived from the capture, never authored

**Decision:** A flow names a capture file and a time window, and its steps are
the write calls Brevo's UI made inside that window, in that order. `pnpm
validate` re-derives every flow and fails on any difference. The prose — what
the flow is for, why each step exists — is written by hand.

**Why this needed stating:** The catalog's remaining selection misses are both
tasks that take more than one call, and on both the model reached for the
listing action that would have been step one. It was not choosing badly; the
catalog had no way to say *this is step 8 of 8*. The fix is ordering, and
ordering is the easiest thing in this repository to invent convincingly.

**Rejected: writing the step lists by hand.** It would have been faster and it
would have produced the only artefact here with no evidence behind it. A flow
that is a story someone remembers about the product is worse than no flow,
because it reads exactly like one that was observed.

**Rejected: a schema field for "step N of M" on each action.** An action belongs
to more than one flow, and a number on an entry cannot say which.

**Two judgements inside the derivation, named in the code rather than hidden:**
the contacts grid reloads itself after every mutation through `/segment/count`,
`/segment/query` and `/segment/paginated_count` — writes only because Brevo
reads over POST — and three consecutive `PATCH /contacts/update` are one person
filling three fields. Both are filtered, and both are arguable.

**Cost accepted:** Three flows cover 16 steps. The capture holds more, and each
one still needs a human to pick the window and write the reasons, so the set
grows by hand even though the steps do not. A flow also breaks if Brevo reorders
its own wizard — which is the gate working, not the gate failing.

---

## 16. No retrieval layer, because the whole index fits in a prompt

**Decision:** `pnpm catalog` narrows by browsing — areas, then an area listing,
then one entry — and the recommended path hands the model names it can see. The
lexical `search` subcommand exists, is weak, and says so in its own output. No
embeddings, no BM25 index, no reranker.

**Why this needed stating:** Building retrieval is the obvious instinct, and
here it is measurably the wrong one. The whole index is **18 519 tokens**,
against published guidance putting the line for skipping retrieval at roughly
200 000. And the measurement agrees with the guidance rather than contradicting
it: a model reading all 197 entries finds the answer **15 of 19** times, while
the lexical search puts it in the top three **5 of 19** times
(`pnpm bench:search`, which costs nothing to run because no model is involved).

The reason a lexical layer cannot close that gap is the eval's own first rule: a
task never reuses the catalog's wording, so *"I need a new audience group"* has
to reach `lists.create_list` without sharing a word with it. Bridging vocabulary
is what the model is for.

**Rejected: embeddings now.** It would add a dependency and an index-build step
to beat a baseline that is already winning, and the repository's constraint is
that everything after capture runs offline.

**Rejected: deleting the search subcommand.** A weak tool that reports its own
weakness is more useful than no tool, and the benchmark only exists because the
search does.

**Cost accepted:** Reading everything is ~18 500 input tokens per decision, and
that scales with how often an agent decides, where retrieval would be flat.
Prompt caching defers the problem rather than solving it. [gaps.md](gaps.md) has
the upgrade shape — hybrid BM25 plus dense, fused by Reciprocal Rank Fusion at
k=60, reranked to 3–5, exposed as a search meta-tool — with sources, so the
answer to *"what if it scales?"* is written down rather than improvised.
