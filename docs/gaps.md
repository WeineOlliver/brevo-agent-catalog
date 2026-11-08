# Gaps and limitations

What this does not do, and what more time would buy. Every number here is
measured.

## The big one: 194 of 197 entries are unproven

| Status | Means | Count |
|:--|:--|:--|
| `verified` | Executed against a real account; the request matched the entry | **3** |
| `observed` | Seen in real traffic, never executed | **194** |

`observed` means a model drafted the entry from traffic it saw. The endpoint,
method and body shape are factual. Everything else is a good hypothesis.

The three proven ones are one lifecycle, not three unrelated wins:
`create_contact` returned `{"contact_id":8}`, `delete_contact` then deleted
contact 8, `create_list` returned 201.

**What it cost is the real finding.** All three are flat forms or row actions,
and each took four runs to get right. `campaigns.send_now` — the most dangerous
entry in the catalog — sits behind a five-call wizard and is still unverified.
That is hours of selector work, not the afternoon the flat forms took.

Verification also does not scale: each one needs a hand-written Playwright
recipe, and recipes break when Brevo changes its markup. Verified coverage will
stay a small, deliberately chosen subset.

## The write surface is covered; the read surface still dominates

| | Before the HAR sessions | Now |
|:--|:--|:--|
| Records observed | 3 097 | 38 132 |
| Records committed as evidence | 3 097 | 2 147 in 68 files |
| Actions | 136 | 197 in 62 modules |
| Distinct write endpoints | 4 | 38 |
| Write endpoints with an entry | 4 | **38** |
| Eval tasks with an answer | 3 of 20 | 19 of 20 |

Of 197 entries, 104 are `get` and 43 are `list`; 30 carry a mutating verb and 7
are destructive. That ratio is honest about Brevo rather than about the method —
a marketing app reads far more than it writes.

**Sender creation is missing entirely.** It is the one eval task with no answer.
The flow was never demonstrated, so the eval reports it as a coverage gap on
every run instead of being satisfied by a near miss.

## Why only 2 147 records are committed

A fifteen-minute DevTools recording is mostly not Brevo. Of 35 035 records in the
four HAR sessions, **1 324 were Brevo and 33 711 were analytics and trackers** —
2.8 MB against 67.8 MB.

`pnpm sanitize` drops the rest before redacting. Committing it would have put
77 MB in a public repository's permanent history, 96% of it traffic every stage
already discards.

Nothing any claim rests on is lost, and that was measured before the filter was
written: every entry cites a capture *file* rather than a record id, no file is
emptied, all 197 evidence paths resolve, and all 38 write endpoints survive. The
unfiltered logs stay in gitignored `captures/raw/`.

## Fixed: descriptions citing action ids that do not exist

**41 invented ids, cited 42 times, now 0.** The prompt asked each description to
name the neighbouring action by id, while drafting every entry in isolation with
no list of which ids exist. Guessing was the only behaviour available.

The schema cannot catch this — an invented id is a well-formed string in a
free-text field. So two changes:

- the prompt now asks for the neighbour **by what it does**, in words;
- `pnpm validate` counts them and fails if the count rises. It sits at zero, so
  it is a gate rather than a tolerance.

The fix was **not** `pnpm extract --force`. A re-draft asks for the whole entry
including the `id`: a model picking a different id leaves an orphan file beside
the old one, and it overwrites `verification`, which would have quietly
un-verified the three actions executed an hour earlier.

So it replaces `description`, `preconditions` and `side_effects` and nothing
else, and that restriction lives in `rewriteProse` with tests on it. Measured
afterwards: exactly 39 files changed, none of them a verified entry.

A first naive scan reported 47 ids and 52 citations. The real figures are 41 and
42 — the difference is a rule that only counts a citation whose module prefix is
a real module, without which prose like "appended to `document.head`" scores as
a missing action. A checker is only as good as its false-positive rate, and the
first number quoted was its own kind of wrong.

## The public API barely overlaps the product

**2 of 197** catalogued endpoints appear in Brevo's published spec:
`account.get_account` (`getAccount`) and `ecommerce.list_categories`
(`getCategories`). Both are reads; no write matches. The earlier, smaller
catalog matched the same 2 of 126 — tripling the capture did not add one.

This document said **0 of 197** until an audit ran the figure back against
`public_api.exists` in the 197 files and found 2. The conclusion survives at 1%;
the number did not. A measured claim is only as good as the last time anyone
measured it.

Brevo's web app talks to about twenty internal microservices — `contacts-api`,
`crm-backend-api`, `segments-api`, `workflow-apis`, `email-campaigns-backend`,
`transactional-app-backend`, `unified-objects`, `account-management-backend` —
under their own prefixes. The public `/v3` API is a different API, not a wrapper.

**This has a cost worth stating.** The deterministic enrichment this design
leans on — inherit required fields, enums and limits from Brevo's own contract —
almost never fires. So **the typed inputs here are mostly inferred by a model
from captured traffic, not taken from a published contract.** Treat `inputs` on
an `observed` entry as a hypothesis about a request's shape, not a spec.

## 27 of the 197 are app plumbing, not business actions

The catalogue is what the app calls, and an app calls things that are not
business actions. **27 entries are the shell rather than the product** — static
reference assets, feature flags, editor furniture, UI view config, and two
endpoints that belong to the brevo.com marketing site rather than to the app at
all. They are the `platform` area in `src/catalog/areas.ts`, which is where the
number now comes from.

**This said 23 for one commit, counted by hand.** The table puts it at 27: the
hand count missed `objects.get_plan`, `objects.get_user_info`,
`objects.get_view`, `agent.get_organization` and
`conversations.load_chat_widget_script`, and wrongly included
`editor.open_newsletter_editor`, which is a user opening the newsletter editor
and belongs to `campaigns`. A hand count is a guess with a number on it; the
difference is exactly why the grouping is a table the build checks.

The list below is that hand count, kept because its two defect findings still
stand.

```
ui.load_home                       navigation.get_header_menu
marketing_site.get_footer          locales.fetch_english
countries.list                     reference.list_countries
localization.list_languages        editor.list_fonts
editor.list_modules                editor.get_localization_settings
editor.open_newsletter_editor      homepage.list_user_widgets
widgets.list                       views.list
views.list_hidden                  views.get_visible_listing
client.get_feature_toggles         user.get_feature_toggles
features.get                       features.check_accessibility
branding.get_brand                 phone.get_auth
analytics.get_live_updates_token
```

**So the honest headline is 170 product features, not 197.** All 27 are reads
and none is destructive, so the write figures are untouched: 38 of 38 write
endpoints still have an entry, and the 3 verified actions are all product
actions.

Two of them are defects rather than noise. `ui.load_home` has
`internal_endpoint.path` of `/undefined` — a crawler artifact that should not
have survived into a catalogue entry. And `countries.list`
(`/js/countries.json`) and `reference.list_countries`
(`/js/countries-production.json`) are the same static asset in two modules,
which is the near-duplicate problem the eval already found on the list reads,
showing up again under two different module names.

They are still in the catalogue, flagged here rather than quietly deleted, for
one reason: every count in this repository — 197, 38/38, the eval, the badges —
was measured against this exact file set, and deleting entries the night before
a deadline would have re-stated eight numbers to make one of them prettier. The
cost of keeping them is that an agent selecting over `index.json` reads 23
entries it will never need.

**This split is now a gate.** It began as a hand classification that nothing
enforced. It is the `platform` area in `src/catalog/areas.ts`, every action
resolves to exactly one area, and a module with no area fails `pnpm validate`
and `pnpm build:index` rather than defaulting into the catch-all.

## Why there is no retrieval layer, and what one would look like

The catalog is read whole. `pnpm catalog search` exists and is weak on purpose
(2 of 19 first, 5 of 19 in the top three), and the recommended path is
browse-then-read with the model doing the narrowing. That is a decision against
the obvious engineering instinct, so here is the reasoning and the evidence.

**The whole index is 18 519 tokens.** Anthropic's own guidance is that a
knowledge base under roughly 200 000 tokens can go into the prompt without
retrieval at all. This one is eleven times under that line, and the measurement
agrees with the guidance rather than contradicting it:

| Path | Right answer found |
|:--|:--|
| Model reads all 197 entries | **15 of 19** |
| Lexical search, top 3 | 5 of 19 |
| Lexical search, anywhere in 10 | 8 of 19 |

Building retrieval here would spend a day to make the answer worse. The reason
it would be worse is the eval's first design rule: a task never reuses the
catalog's wording, so *"I need a new audience group"* has to reach
`lists.create_list` without sharing a word with it. Bridging that is what a
model is for.

**The honest counter-argument is cost, not accuracy.** Reading everything costs
18 500 input tokens per decision, and that scales linearly with how often an
agent decides. Retrieval is how that becomes flat. With prompt caching it is
mostly moot at this size; without it, and at high query volume, the crossover
arrives.

**What the upgrade looks like, if the catalog grows an order of magnitude.** Not
invented here — this is the current consensus shape, and it is deliberately
written down so the question "what if it scales?" has an answer that is not a
guess:

1. **Hybrid retrieval, not one or the other.** BM25 for exact identifiers and
   rare tokens, dense embeddings for a person's phrasing. Embeddings alone
   handle ids badly; lexical alone is what this repository just measured.
2. **Fuse by rank, not by score.** Reciprocal Rank Fusion with k=60 is the
   default, because BM25 scores are unbounded and cosine similarity is not, so
   averaging the two raw lets BM25 dominate. RRF uses only positions, so no
   normalisation is needed.
3. **Rerank the fused top 20 to a top 3–5** with a cross-encoder, which is where
   most of the precision comes from.
4. **Route obvious queries.** A query that is plainly an id lookup goes straight
   to BM25 and skips the embedding call.
5. **Expose it as a search meta-tool, not as a bigger prompt.** Progressive
   discovery — the agent searches, then loads only the schemas it needs — is
   what Claude Code's own tool search does, returning about five results per
   search. Anthropic reports selection accuracy degrading past roughly 30–50
   *tools* loaded at once; a 2026 cloud-scale study found naive exposure
   degrading as the pool grew while a hybrid retriever held about 82% accuracy
   at ~3 600 tools.

Worth noting where that 30–50 figure does and does not apply: it is about tool
*definitions* occupying the model's context, while these 197 entries are data
the model reads once per decision. That is why 197 scores 15 of 19 here instead
of collapsing, and it is also why the same 197 would collapse if they were
turned into 197 live tools. Any `execute_action` work should start from that
distinction.

**And the caveat every source repeats:** retrieval does not fix bad
descriptions. This catalog's two remaining selection misses are three
near-duplicate list reads and a two-step task, and no reranker repairs either.

Sources: [Claude tool search](https://platform.claude.com/docs/en/agents-and-tools/tool-use/tool-search-tool),
[Claude Code tool search](https://code.claude.com/docs/en/agent-sdk/tool-search),
[MCP client best practices](https://modelcontextprotocol.io/docs/2026-07-28/develop/clients/client-best-practices),
[Scalable LLM Agent Tool Access in the Cloud](https://arxiv.org/pdf/2607.15593),
[ScaleMCP](https://arxiv.org/pdf/2505.06416),
[OpenSearch hybrid search](https://opensearch.org/blog/building-effective-hybrid-search-in-opensearch-techniques-and-best-practices/),
[Hybrid search for RAG](https://denser.ai/blog/hybrid-search-for-rag/),
[When not to use RAG](https://ai-tldr.dev/learn/rag/rag-fundamentals/when-not-to-use-rag/).

## Deliberately out of scope

- **Partner and reseller APIs.** 79 of the spec's 292 operations are
  master-account, balance, program, reward, tier and wallet surface. Not part of
  the product experience.
- **Paid-plan features.** The account is free tier. `plan_tier` records what it
  cannot reach, and `unknown` is the honest default, so expect a lot of it.
- **Execution.** The catalog describes actions; nothing performs them at runtime.

## Where the catalog is weakest

- **Automation, landing pages, forms, meetings, push.** No public API coverage at
  all, so nothing enriches them deterministically. Simultaneously where an agent
  most needs a catalog and where this one is least reliable.
- **Writes in modules with no interaction pass.** Only `contacts` has one, so
  write actions elsewhere have no captured bodies, no real enums and no
  validation-error evidence. Each new module is one file.
- **`plan_tier`.** Inferred from upsell screens on a free-tier account. Treat
  anything other than `free` with suspicion.
- **Near-duplicate reads.** The eval missed "what audience groups do we have" by
  choosing `contacts.get_lists_and_segments` over `lists.get_lists`, and
  `segments.get_lists` is a third overlapping entry. Three entries answering one
  question is a description problem, and the eval found it, not a reviewer.

## Structural limits

- **Reproducibility is partial by design.** The 68 sanitized capture files are
  committed, so anyone can re-run extraction, normalisation, validation,
  indexing and the eval against real Brevo traffic with no Brevo account. Only
  an LLM provider is needed. The browser stages need an account of your own.
- **`inferred` is unreachable today.** Extraction drafts only from captured
  traffic, so every entry is `observed`. The status exists for UI-only actions
  found without a capture; nothing produces those yet.
- **The Claude half needs an authenticated `claude` CLI.** No Anthropic API key
  is used — good for secret hygiene, bad for third-party reproduction.
- **The leak gate skips one file.** `data/brevo-openapi.yml` is Brevo's own
  public document, and scanning it produces permanent false positives from
  Brevo's example addresses. Nothing writes to it.
- **Selector fragility.** The passes prefer accessible roles over CSS and warn
  rather than crash, but a renamed button silently reduces coverage. The printed
  write count is how that becomes visible.

## What more time would buy, in order

1. **Settle whether the `destructive` label is suppressing selection.** The
   sharpest open question in this repository, and the cheapest: one run of
   `pnpm eval --no-risk-labels`. Of 19 eval tasks, the 4 whose answer is
   destructive score 1 while the other 15 score 13, and the failures come in two
   shapes — twice the model answers that no action fits, once it picks a safe
   neighbour. Either the marker in the rendered catalogue is losing those tasks,
   in which case risk has to be carried where an agent reads it as information
   rather than as permission withheld, or the model is declining the request
   itself, in which case a catalogue for agents needs an authorisation story and
   no wording fixes it. **This is a safety question, not a score question**, and
   it is first because a catalogue whose risk flags cost it the risky actions is
   failing at the thing it was most careful about. The first attempt died with
   15 of 19 tasks returning `claude CLI exited 1`; see [eval.md](eval.md).
2. **Verify `campaigns.send_now`.** The most dangerous entry in the catalogue
   and the only risk class nothing has proved. Behind a five-call wizard, so
   hours of selector work rather than an afternoon. Its preconditions are
   written down and marked inferred, which is not the same as proved.
3. **Record the sender-creation flow.** Fifteen minutes of capture closes the
   last eval task, the only one with no answer in the catalogue at all.
4. **Resolve the three overlapping list reads.** A taxonomy call, not a wording
   tweak — both descriptions were already rewritten and the model's choice did
   not move. Costs one eval task today.
5. **More flows.** Three exist, covering 16 steps. The capture holds more —
   segment creation, the import mapping, company setup — and each is a window
   plus six lines of prose, since the steps derive themselves.
6. **Delete `ui.load_home`.** Its `internal_endpoint.path` is `/undefined`, a
   crawler artefact that should never have become an entry. It is documented
   above rather than removed because deleting it restates eight measured
   numbers; doing it properly means doing it with the other taxonomy cleanups.
7. **A documentation gate.** Two published numbers were wrong for one commit
   each — `0 of 197` for the public-API overlap and `17 of 19` for the eval —
   and both were found by hand. A script that checks every count and link in
   the docs against the data would have caught both before a reader did.
8. **An MCP server** over the existing index — about a hundred lines, and then
   there is a live demo. [Decision 4](decisions.md#4-no-mcp-server) explains why
   it was demoted, not why it is worthless, and `pnpm catalog` now covers most
   of what it would have shown.
9. **`execute_action`.** Turns the catalogue from a description into a
   capability. Where this goes next in production, and deliberately not a
   weekend task. Start from the distinction in
   [decision 16](decisions.md#16-no-retrieval-layer-because-the-whole-index-fits-in-a-prompt):
   197 rows read as data behave nothing like 197 tools loaded into context.

## Already done, and what it cost

- **Four hand-driven HAR sessions**, which took write endpoints from 4 to 38 and
  the eval from 0 of 20 to a scoreable 19. The selector automation built for the
  same job reached two of six target routes.
- **The 42 dangling cross-references**, now 0 and gated at zero.
- **Nine areas** over the 62 URL-derived modules, gated: an unmapped module
  fails the build rather than defaulting into the catch-all
  ([decision 14](decisions.md#14-two-groupings-modules-for-reading-the-capture-areas-for-finding-a-feature)).
- **Three flows**, derived from capture windows and re-derived by
  `pnpm validate`, so a flow cannot drift into a story
  ([decision 15](decisions.md#15-flows-are-derived-from-the-capture-never-authored)).
- **`pnpm catalog` and `pnpm bench:search`.** The query command settled the
  assumption it was built to test, in the uncomfortable direction: narrowing the
  context is not free, and browse-then-read beats search-then-trust at this size
  ([decision 16](decisions.md#16-no-retrieval-layer-because-the-whole-index-fits-in-a-prompt)).
