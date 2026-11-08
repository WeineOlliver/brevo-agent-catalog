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

## 23 of the 197 are app plumbing, not business actions

The catalogue is what the app calls, and an app calls things that are not
business actions. Counted by hand, **23 entries are the shell rather than the
product** — static reference assets, feature flags, editor furniture, UI view
config, and two endpoints that belong to the brevo.com marketing site rather
than to the app at all.

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

**So the honest headline is 174 product actions, not 197.** All 23 are reads and
none is destructive, so the write figures are untouched: 38 of 38 write endpoints
still have an entry, and the 3 verified actions are all product actions.

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

**This split is a hand classification, not a gate.** Unlike the cross-reference
count or the schema check, nothing in `pnpm validate` enforces it, so it can
drift as the catalogue grows. Making `surface: product | plumbing` a schema
field is how it would stop drifting.

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

1. **Verify `campaigns.send_now`.** The most dangerous entry in the catalog and
   the only risk class nothing has proved. Behind a five-call wizard.
2. **Record the sender-creation flow.** Fifteen minutes closes the last eval
   task.
3. **Resolve the three overlapping list reads.** A taxonomy call, not a wording
   tweak.
4. **More flows.** Three exist (`flows/index.json`), covering 16 steps. The
   capture holds more — segment creation, the import mapping, company setup —
   and each is a window and six lines of prose, since the steps derive
   themselves. Flows are also the better answer to the taxonomy problem below:
   sending one campaign crosses three modules, so intent and URL prefix are
   different axes and only one of them is what an agent asks for.
5. **Normalise the module taxonomy.** 62 modules for 197 actions, many with a
   single entry (`ui`, `widgets`, `locales`, `countries`).
6. **A query command** over the index and the flows — `search` and `show`, so an
   agent asks for three entries instead of reading 197. This is the cheaper
   half of what an MCP server would provide, runs anywhere a shell does, and
   tests an assumption the eval currently hides: today the eval hands the model
   all 197 entries at once, which is not how an agent with a search tool works.
7. **An MCP server** over the existing index — about a hundred lines, and then
   there is a live demo. Decision #4 explains why it was demoted, not why it is
   worthless.
8. **`execute_action`.** Turns the catalog from a description into a capability.
   Where this goes next in production, and deliberately not a weekend task.

Done since the first draft of this document: the HAR sessions (four of them,
which took writes from 4 to 38), and the 42 dangling cross-references (now 0).
