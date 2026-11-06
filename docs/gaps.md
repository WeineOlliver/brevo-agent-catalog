# Known gaps and limitations

What this does not do, stated plainly, and what more time would buy.

## The pipeline has not yet run against a live account

This is the largest gap and it is not a subtle one. Every stage is implemented
and tested, but the stages that need an authenticated Brevo session — `login`,
`crawl`, `interact`, `verify` — require a manual login that only the account
holder can perform. Consequently:

- `actions/` is empty. There is no catalog content yet, only the machinery that
  produces it and the contract it must satisfy.
- No entry has ever been stamped `verified`, because nothing has been executed.
- `docs/modules.md` and `docs/eval.md` have no measurements in them.
- The 20 expected action ids in `data/eval-tasks.json` are **predictions** about
  what the catalog will contain, written from the OpenAPI tag structure. They
  must be reconciled against the real catalog; `pnpm eval` reports any that are
  missing as unscoreable rather than scoring them as misses.

Nothing in this repository reports a result it has not measured, which is why
those documents are structured but empty rather than filled with plausible
numbers.

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

- **Reproducibility is partial by design.** Stages 0 and 4–8 run offline for
  anyone from the committed spec and clean captures. The crawl stages need a
  Brevo account of your own and are documented rather than runnable. The brief
  explicitly permits this ("if something needs a key to run, describe it
  instead").
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

1. **Run the pipeline.** Everything above about empty documents disappears with
   one login and a crawl.
2. **Interaction passes for the remaining core modules** — campaigns, lists,
   templates, senders. This is the single biggest lever on Reliability, because
   it converts write actions from `inferred` to `observed` with real request
   bodies behind them.
3. **More verification recipes**, chosen from the finished catalogue by which
   actions an agent is most likely to call and which would hurt most if wrong.
4. **Close the eval loop properly** — run it, fix the descriptions it defeats,
   re-run, and report both numbers. One pass of this is worth more than a dozen
   extra `inferred` entries.
5. **An MCP server** over the existing index (decisions #4 explains why it was
   demoted, not why it is worthless) — roughly a hundred lines, and then there is
   a live demo.
6. **`execute_action`**, which turns the catalog from a description into a
   capability. This is where the project would actually go next in production,
   and it is deliberately not a weekend task.
