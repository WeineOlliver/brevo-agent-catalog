# Known gaps and limitations

What this does not do, stated plainly, and what more time would buy.

## The catalog is almost entirely read actions

This is the largest gap by far, and it is measured rather than suspected.

The crawl ran: 38 routes, 1176 requests, 118 catalogued actions. But of those
118, **75 begin `get`, 33 begin `list`, and exactly one is a write.** The
selection eval scored **0 of 20** — the catalog contains none of the twenty
tasks a user would actually ask for.

The cause is structural. The crawler follows links and deliberately clicks
nothing, so it sees `GET` traffic. Creating a contact, adding one to a list,
creating a campaign — the brief's own examples — exist only in the request a
form submission causes.

**The fix is built and not yet run.** Six interaction passes (contacts, lists,
segments, campaigns, templates, senders) drive the real UI and capture those
write requests. They need an interactive login that only the account holder can
perform, and that has not happened yet. Until it does:

- the catalog is a usable map of Brevo's *read* surface and little else;
- no entry has ever been stamped `verified`, because nothing has been executed;
- the 20 ids in `data/eval-tasks.json` remain predictions. `pnpm eval` reports
  them as unscoreable rather than scoring them as misses, which is why the
  headline is "0 of 20 scoreable" and not a quality score.

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

- **Reproducibility is partial by design, and currently thinner than intended.**
  Stage 0 runs offline for anyone. Stages 4–8 are *built* to run offline from
  committed clean captures, but none are committed yet — the crawl has not run —
  so right now only stage 0 does anything for a third party. The crawl stages
  need a Brevo account of your own and are documented rather than runnable,
  which the brief explicitly permits ("if something needs a key to run, describe
  it instead").
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

1. **Run the six write passes.** This is not a refinement, it is the difference
   between a read-only map and a catalog of business actions. Everything below
   matters less than this one step.
2. **More write passes** — automation workflows, forms, meetings, ecommerce.
   These are also the surfaces with no public API coverage at all, so they are
   where a catalog is worth the most and where this one is weakest.
3. **Verification recipes** for whichever write actions step 1 surfaces, chosen
   by what an agent is most likely to call and what would hurt most if wrong.
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
