# Known gaps and limitations

What this does not do, stated plainly, and what more time would buy.

## The catalog is still mostly read actions

This is the largest gap by far, and it is measured rather than suspected.

136 catalogued actions from 3097 captured requests, of which **4 are writes**:
`contacts.create_contact`, `contacts.add_contact_to_lists`,
`account.enable_sms_campaigns_app` and `lists.sync_list_counts`. The rest are 85
`get` and 36 `list`. Of the eval's 20 tasks, 17 name an action that does not
exist here, and nearly all of those are writes.

The cause is no longer a missing login — that happened, and the write passes have
run three times. The cause is that **driving writes by selector only works on
flat forms.** Reconnaissance over the six targeted routes measured it:

| Route | What a create control opens | Usable by a pass? |
|---|---|---|
| `/contact/list` | dialog, `email` field, submit `Create` | yes |
| `/contact/list-listing` | dialog, `create-listName` field | yes |
| `/contact/segment` | navigates to a multi-step builder | no |
| `/campaigns/listing` | channel split-button, no create control matched | no |
| `/templates/listing` | opens the drag-and-drop editor | no |
| `/settings/senders` | error page — the route is wrong | no |

Two of six. Each wizard is hours of selector work that breaks on Brevo's next
release, and a person performs the same flow in about thirty seconds.

**So the remaining coverage comes from `pnpm import:har`.** Perform the actions
in your own browser with DevTools recording, export the HAR, and the same
sanitize → extract → normalize path ingests it. No login timeout, no selectors,
no locale. `parseHar` had been tested since the first week and had no caller;
it is now the stage that matters most.

Until that session happens:

- the catalog maps Brevo's read surface well and its write surface barely;
- no entry is `verified`, because verification needs a recipe per action and
  only `create_contact` has the captured evidence to build one from.

## The public API barely overlaps the product

Also measured, and the single most interesting finding here: **2 of 126**
captured endpoints map onto an operation in Brevo's published OpenAPI spec.

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

1. **One recorded HAR session.** Perform the twenty flows the eval names, once,
   by hand, and ingest the log. This is not a refinement: it is the difference
   between a read-only map and a catalog of business actions, and it reaches the
   wizards no selector pass can. Everything below matters less than this step.
2. **More write passes for the flat forms only** — attributes, senders, folders.
   Worth automating where a dialog with a name field exists; not worth it for
   anything shaped like a wizard, which is what measurement showed most of them
   are.
3. **Verification recipes** for whichever write actions step 1 surfaces, chosen
   by what an agent is most likely to call and what would hurt most if wrong.
   `create_contact` is the only one with captured evidence to build from today.
4. **Close the eval loop** — re-run, fix the descriptions it defeats, re-run, and
   report both numbers. The before/after pair says the pipeline has a working
   feedback loop, which is a stronger claim than any single score.
5. **Normalise the module taxonomy further.** 118 actions currently spread across
   51 modules, many with a single entry (`ui`, `widgets`, `locales`, `countries`).
   Singular/plural pairs are merged automatically; the rest needs a judgement
   call about what counts as a product area.
6. **An MCP server** over the existing index (decisions #4 explains why it was
   demoted, not why it is worthless) — roughly a hundred lines, and then there is
   a live demo.
7. **`execute_action`**, which turns the catalog from a description into a
   capability. Where this would actually go next in production, and deliberately
   not a weekend task.
