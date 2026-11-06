# Decisions

Every architectural decision, the alternatives rejected, and **the cost
accepted**. That last column is the point: a decision record without costs is a
list of claims.

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
