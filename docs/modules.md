# Modules and routes

This file is **generated** by `pnpm build:docs` from `actions/index.json` and the
crawl's route inventory. Do not edit it by hand.

It is empty because the crawl has not run — that stage needs a manual login at
app.brevo.com, which only the account holder can perform. Once
`pnpm crawl` → `pnpm sanitize` → `pnpm extract` → `pnpm build:index` have run,
`pnpm build:docs` replaces this file with:

- one section per module, listing every action's id, name, verification status
  and destructive flag;
- the status totals;
- and a final section naming every route the crawl reached that produced **no**
  catalogued action — the honest coverage boundary.

See [gaps.md](gaps.md) for what is known to be missing and why.
