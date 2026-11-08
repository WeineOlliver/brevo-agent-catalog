# Known gaps and limitations

What this does not do, stated plainly, and what more time would buy.

## The write surface is covered; the read surface is still the bulk of it

This was the largest gap and is now the smallest. It is worth keeping the before
and after side by side, because the fix was not more engineering.

| | Before the HAR sessions | Now |
|---|---|---|
| Records observed | 3 097 | 38 132 |
| Records committed as evidence | 3 097 | 2 147 across 68 files |
| Catalogued actions | 136 | 197 across 62 modules |
| Distinct write endpoints in the capture | 4 | 38 |
| Write endpoints with a catalog entry | 4 | 38 |
| Eval tasks naming an action that exists | 3 of 20 | 19 of 20 |

**Driving writes by selector only worked on flat forms.** Reconnaissance over six
targeted routes measured two of six usable: a segment builder, a campaign
split-button, the drag-and-drop template editor and a wrong senders route all
defeated it. Each wizard is hours of selector work that breaks on Brevo's next
release, and a person performs the same flow in about thirty seconds.

So the coverage came from `pnpm import:har`: four hand-driven DevTools recordings
of about fifteen minutes each, exported and fed through the same sanitize →
extract → normalize path. No login timeout, no selectors, no locale. `parseHar`
had been tested since the first week and had no caller; it became the stage that
mattered most.

What is left is a real but narrower shape problem. Of 197 entries, 104 are `get`
and 43 are `list`; 30 carry a mutating or flow verb, and **7 are destructive.**
That ratio is honest about Brevo rather than about the method: a marketing app
reads far more than it writes, and a fifteen-minute session touching four
screens loads dozens of panels per form submitted.

Two things the sessions did not get:

- **Sender creation.** The only eval task with no answer in the catalog. The
  flow was deferred and never demonstrated, so there is no entry, and the eval
  reports it as a coverage gap every run rather than being quietly satisfied by
  a near miss.
- **`verified` is 3 of 197.** Verification executes an action against the live
  account and matches the request that actually happened, so the three that
  carry it are claims rather than readings: `contacts.create_contact` returned
  `{"contact_id":8}`, `contacts.delete_contact` then deleted contact 8, and
  `lists.create_list` returned 201. The create-then-delete pair is the useful
  part — the same contact id appears on both sides, so the lifecycle is proved
  rather than inferred.

  The remaining 194 are `observed`, which means a model drafted them from
  traffic it saw. That is the claim this project exists to distrust, and the
  ratio is the honest statement of how far the distrust has been answered.

  What it cost is the real finding. All three are flat forms or row actions, and
  even those took four runs each to get right — see the commentary in
  `src/verify/recipes/lists.ts`, where three consecutive failures were three
  different wrong beliefs of mine and the dialog had been printing the answer
  the whole time. A recipe for the 5-call campaign wizard is a different order
  of work, which is why `campaigns.send_now` — the most dangerous entry in the
  catalog — is still unverified.

### Why the committed record count is far below the observed one

`captures/clean/` holds 2 147 records, not 38 132. A fifteen-minute DevTools
recording is mostly not Brevo: of the 35 035 records in the four HAR sessions,
1 324 were Brevo's own traffic and 33 711 were analytics, CDN assets and
third-party trackers — 2.8 MB against 67.8 MB.

`pnpm sanitize` drops the latter before redacting. Committing it would have put
77 MB in a public repository's permanent history, 96% of it traffic every stage
of this pipeline already discards, since extraction and the coverage
measurements all run through `isAppTraffic`.

Nothing any claim rests on is lost, and that was measured rather than assumed
before the filter was written: every action cites a capture *file* rather than a
record id, no file is emptied by the filter, all 197 evidence paths still
resolve, and all 38 distinct write endpoints are still present afterwards. The
unfiltered logs stay in gitignored `captures/raw/`, so the observed number is
reproducible from a local run; the committed number is what a reviewer can audit.

## Descriptions cite action ids that do not exist

Measured, and the cause is in our own prompt rather than in the model.

**Fixed: 42 citations down to 0.** The original measurement was 41 invented
action ids cited 42 times. The extraction prompt asked each
description to "name the neighbouring action to use instead", while drafting
every candidate in isolation with no list of which ids exist. So the model
guessed plausible ones. An agent that reads "Use `contacts.import_contacts`
instead" and looks it up finds nothing.

The schema cannot catch this: an invented id is a well-formed string in a field
allowed to hold any text. So two changes, neither of which is a hand-edit of 42
descriptions:

- the prompt now asks for the neighbour **by what it does**, in words, because
  an id the drafter cannot verify is worth less than a phrase an agent can
  search the index for;
- `pnpm validate` counts them every run and fails if the count goes **up**. It
  is a ratchet, not an allowance — a measured defect that cannot grow back while
  nobody is looking.

The 39 entries already written down were cleared by `pnpm fix:crossrefs`, and
the ratchet now sits at **zero** — so it has stopped being a tolerance and
become an ordinary gate: any entry naming an action the catalog does not have
fails the build.

Clearing them did **not** go through `pnpm extract --force`, and the reason is
the interesting part. A re-draft asks the model for the whole entry including
the `id`, so a model that picks a different id leaves an orphan file beside the
old one — 39 of them — and it overwrites `verification`, which would have
quietly un-verified the three actions that had just been executed against the
live account. Neither is a price worth paying to fix a sentence.

So the fix is surgical: it replaces `description`, `preconditions` and
`side_effects` and nothing else, and that restriction lives in
`rewriteProse` with tests on it rather than in a comment. The model was also
given something it never had on the first pass — the real ids in the same
module — which is why the rewrites name a real neighbour or describe the
capability in words instead of inventing one. Measured afterwards: exactly 39
action files changed, and none of the three verified entries was among them.

A first naive scan of this reported 47 ids and 52 citations. The real figures are
41 and 42; the difference is a rule that only counts a citation whose module
prefix is a module the catalog actually has, without which prose like
"appended to `document.head`" scores as a missing action. The gap between the
two numbers is the point: a checker is only as good as its false-positive rate,
and the first number quoted was its own kind of wrong.

## The public API barely overlaps the product

Also measured, and the single most interesting finding here: **0 of 197**
catalogued endpoints map onto an operation in Brevo's published OpenAPI spec.
The earlier, smaller catalog managed 2 of 126; tripling the capture and adding
every write flow did not add one more. The overlap is not small because coverage
was thin. It is small because these are different APIs.

Brevo's web app talks to roughly twenty internal microservices —
`contacts-api`, `crm-backend-api`, `segments-api`, `workflow-apis`,
`email-campaigns-backend`, `transactional-app-backend`, `unified-objects`,
`account-management-backend` — under their own prefixes (`/sidebar`, `/crm`,
`/feApi`, `/api`, `/v1`). The public `/v3` API is a *different* API, not a
wrapper over this one.

That is the brief's premise demonstrated about as sharply as it could be. It also
has a cost worth stating plainly: the deterministic enrichment this design leans
on (inherit required fields, enums and limits from Brevo's own contract) almost
never fires. **The typed inputs in this catalog are overwhelmingly inferred by a
model from captured traffic, not taken from a published contract.** Treat
`inputs` on an `observed` entry as a hypothesis about the shape of a request,
not as a specification.

## Scope deliberately excluded

- **The partner and reseller API surface.** 79 of the public spec's 292
  operations are master-account, balance, program, reward, tier and wallet
  operations. They are not part of the product experience and are out of scope.
- **Paid-plan features.** The account is free tier. What a free-tier account
  cannot reach is recorded in `plan_tier` rather than guessed at — and `unknown`
  is the honest default, so expect a lot of it.
- **Execution.** The catalog describes actions; nothing here performs them
  against Brevo at runtime. This is the most obvious next step.

## Where the catalog will be weakest, and why

**Automation, landing pages, forms, meetings and push.** These have *no* public
API coverage, so there is nothing to enrich them with deterministically — every
field comes from the UI and from model judgment. They are simultaneously where an
agent most needs a catalog and where this catalog will be least reliable. Expect
`inferred` throughout.

**Write actions in modules without an interaction pass.** A link-only crawl sees
GET traffic. Only `contacts` currently has a write pass
(`src/interact/contacts.ts`), so write actions elsewhere will have no captured
request bodies, no real enums, and no validation-error evidence. They will land
as `inferred` and should be read that way. Each additional module is a new
`InteractionPass` in its own file and no other code change.

**`plan_tier` generally.** Inferring which plan reaches an action from upsell
screens observed during a free-tier crawl is weak evidence. Treat anything other
than `free` with suspicion.

## Structural limitations

- **Reproducibility is partial by design, and better than first written.**
  Stage 0 runs offline for anyone, and stages 4–8 now genuinely do too: the 61
  sanitized capture files under `captures/clean/` are committed, so a third
  party can re-run extraction, normalisation, validation, indexing and the eval
  against real Brevo traffic with no Brevo account at all. Only an LLM provider
  is needed. The browser stages still require an account of your own and are
  documented rather than runnable, which the brief explicitly permits ("if
  something needs a key to run, describe it instead").
- **`inferred` is unreachable today.** The extraction pipeline drafts only from
  captured traffic, so every drafted entry is `observed`. The status exists for
  UI-only actions discovered without a capture, and nothing produces those yet.
  The schema, the index and the docs all support it; the producer does not.
- **The Claude half of the pipeline needs an authenticated `claude` CLI.** No
  Anthropic API key is used. That is good for secret hygiene and bad for
  third-party reproduction.
- **Verification does not scale.** Each verified action needs a hand-written
  Playwright recipe, and recipes break when Brevo's markup changes. Verified
  coverage will stay a small, deliberately chosen subset.
- **The leak gate skips one file.** `data/brevo-openapi.yml` is Brevo's own
  public document; scanning it produces permanent false positives from Brevo's
  example addresses. Nothing in this pipeline writes to it.
- **Selector fragility.** The interaction and verification passes prefer
  accessible roles and names over CSS, and degrade with a warning rather than
  crashing — but Brevo's markup is not ours, and a renamed button silently
  reduces coverage. The printed write count is how that becomes visible.

## What more time would buy, in order

~~1. One recorded HAR session.~~ **Done** — four of them, and it was the
   difference between a read-only map and a catalog of business actions, exactly
   as predicted. Everything that follows was reordered by what those sessions
   then showed.

1. **Verification recipes.** The one remaining structural claim this project
   `verified` is 3 of 197, and `contacts.delete_contact` is one of them. What
   remains is the expensive half: `campaigns.send_now` is the most dangerous
   entry in the catalog and sits behind a five-call wizard, which is hours of
   selector work rather than the afternoon the flat forms took.
~~2. Re-draft the 42 dangling cross-references.~~ **Done** — 0 remain, and the
   ratchet in `scripts/validate.ts` is now a gate at zero.
3. **The sender-creation flow**, the eval's one unanswered task. One more
   fifteen-minute recording closes it.
4. **Resolve the near-duplicate reads the eval exposed.** It missed "what
   audience groups do we have" by choosing `contacts.get_lists_and_segments`
   over `lists.get_lists`, and the catalog holds a third overlapping entry in
   `segments.get_lists`. Three entries answering one question is a description
   problem, and the eval found it rather than a reviewer.
5. **Normalise the module taxonomy further.** 197 actions across 62 modules,
   many with a single entry (`ui`, `widgets`, `locales`, `countries`).
   Singular/plural pairs are merged automatically; the rest needs a judgement
   call about what counts as a product area.
6. **An MCP server** over the existing index (decisions #4 explains why it was
   demoted, not why it is worthless) — roughly a hundred lines, and then there is
   a live demo.
7. **`execute_action`**, which turns the catalog from a description into a
   capability. Where this would actually go next in production, and deliberately
   not a weekend task.
