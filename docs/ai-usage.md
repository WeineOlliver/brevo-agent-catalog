# How AI was used

Split between **AI inside the product** and **AI used to build it**, because the
brief asks about the system, not only the output.

## AI inside the pipeline

### Two models, split by the shape of the job

| Pass | Model | Why |
|:--|:--|:--|
| Breadth — draft an entry for every discovered route | **Groq** (`openai/gpt-oss-120b`) | A throughput problem: ~200 candidates, cheap and fast |
| Judgment — descriptions, preconditions, risk | **Headless Claude Code** (`claude -p`) | Separating neighbouring actions is what Reliability is scored on |

Both sit behind one interface (`src/providers/types.ts`) with injected
transports, so every provider test runs offline and a reviewer can substitute
their own. The Claude adapter shells out to the authenticated `claude` CLI, so
**no Anthropic API key exists in this repository**.

### What the model is not asked for

The model is asked for semantics only — names, descriptions, preconditions,
inputs, outputs, side effects.

Everything derivable is derived in code: `internal_endpoint` from the capture,
`public_api` from the OpenAPI join, `verification` from what actually executed.
Asking a model for facts you already hold is the main source of fabricated
documentation, and declining to do it is free.

### Four guardrails that do not trust the model

1. **The schema is a hard gate.** A draft that does not validate never reaches
   `actions/`. Validation errors are appended to the prompt and the draft is
   retried once; a second failure is recorded in `data/extract-failures.json`
   with its raw output, never silently dropped.
2. **Risk flags are decided in code**, in `src/catalog/risk.ts`, from the action
   id rather than from what the model claimed. The prompt asks for the rule;
   code enforces it, because a prompt is a request and this needs to be a
   guarantee.
3. **Cross-references are gated.** A description may not name an action id the
   catalog does not have. `pnpm validate` fails if the count rises above zero.
4. **Output parsing assumes the worst.** The extractor handles bare JSON,
   markdown fences and JSON buried in prose, with a string-aware brace scanner so
   a `}` inside a value does not truncate the span. No JSON returns a *reason*,
   not an exception, because the repair loop needs the reason.

### Measuring the model instead of trusting it

- **Verification** (`pnpm verify`) executes an action for real and compares what
  the entry claimed against what happened. 3 of 197 so far.
- **The selection eval** (`pnpm eval`) checks whether a model resolves a
  naturally-phrased task to the right entry. **17 of 19.**
- **The leak gate** (`pnpm scan`) re-derives its patterns instead of asking the
  redactor what it would have replaced, because a gate implemented by calling
  the thing it checks cannot fail. It has caught the redactor twice.

## Where the model was wrong

Every one of these was caught by a check, not by reading the output. That is the
point: the output always reads well.

| What happened | How it surfaced | What changed |
|:--|:--|:--|
| **6 fabricated actions.** I had suggested fetching `/mark_NN_<flow>` URLs as session markers; the extractor treated them as endpoints and the model wrote confident entries with invented outputs | Noticed while reading the catalog for something else | Deleted, plus a noise filter with a test that a real `/marketing/*` route still survives |
| **41 invented action ids, cited 42 times** — "Use `contacts.import_contacts` instead", which does not exist | A checker written to look for exactly that | The prompt now asks for the neighbour *by what it does*; `pnpm validate` gates it at zero |
| **Risk flags wrong in both directions.** Reads shipped as destructive; a bulk dispatcher that can delete was safe only by luck | Measuring the rule against all 197 ids | A read verb in first position beats the dangerous-token scan; `bulk` escalates because no name can classify a dispatcher |
| **Two PII leak classes the gate called clean.** Phone numbers had no rule; `%40`-encoded emails defeated a literal-`@` regex | Grepping the committed captures by hand | A keyed phone rule, encoded-email shapes, and a redact-then-scan round-trip test |
| **An error message that hid its cause.** `withDeadline` swallowed the provider's error, so a 429, a dead key and a malformed response read identically | Printing the error being discarded | The real cause was Groq's **tokens-per-day** cap, not per-minute — so no amount of pacing could have fixed it. One run spent 3h04m proving that |

The last one is the most useful. I had diagnosed it confidently and wrongly
twice, and the fix was not a smarter guess — it was instrumenting the thing that
was throwing the evidence away.

## AI used to build this

Built with Claude Code, as a staged process rather than a chat.

**Brainstorming before design.** One recommendation was reversed mid-conversation
under challenge: an MCP server was proposed, argued for, then dropped once the
context-pressure justification did not survive arithmetic — 200 entries is about
8k tokens — and a selection eval buys the same proof more directly. Recorded as
decision #4 rather than quietly dropped.

**Reconnaissance before architecture.** Brevo's spec was downloaded and counted
before the design was written: 292 operations, 208 paths, 79 partner-surface
operations, five product areas with no coverage. Those numbers chose the
architecture.

**A design document, reviewed cold.** A fresh agent with no conversation context
read the design as a builder and reported what it would have had to guess. Five
findings changed the design before any code — most importantly that the three
confidence levels were undefined beyond `verified`, and that the crawl as
specified would observe almost no write traffic. The second one happened anyway,
at full strength, because the mitigation had not been run yet.

**TDD throughout.** All 470 tests were written and watched fail first. Where the
plan was wrong — and it was, in several places — the deviation was recorded with
its cost rather than silently patched.

### What had to be fixed by hand

The ones that only existed once real data arrived. No amount of unit testing
would have produced them.

- **`storageState` does not carry Brevo's session.** Login reported success, then
  the crawl landed on `login.brevo.com` seconds later. Playwright serialises
  cookies and localStorage but not `sessionStorage`. Fixed by crawling in the
  context that signed in.
- **The dead-session guard skipped the first route**, so an invalid session
  crawled one login page and exited *successfully*: "visited 1 route, 40
  requests". A silent false success is worse than a crash — the next stage would
  have built a catalog out of login-page traffic.
- **`loadConfig` used `??`**, which does not fall back on an empty string, and
  `.env.example` ships every key blank. The pipeline requested the model named
  `""` and got 126 identical 404s. Anyone copying the example file would have hit
  it.
- **The default Groq model did not exist for this account.** Picked from general
  knowledge instead of asking the API. `/models` settled it in one call.
- **Two extraction runs left 127 files for 118 endpoints.** The model named some
  endpoints differently the second time, so overwriting by id left both. Two ids
  for one action is an agent choosing a synonym at random; fixed with a tested
  normalisation step.
- **The crawler followed `/forgot-password`**, which redirects to the login host
  and tripped the expired-session guard, ending a run after two routes.
- **A verification recipe looked for a button that does not exist.** It searched
  for "add a contact"; the button reads "Create a contact". The recipe could
  never have opened the form it was written to submit. Fixed by using the
  selectors reconnaissance had already measured, instead of the ones that
  sounded right.

And one from the build itself, worth keeping because it is a category: the plan
specified a `zod-to-json-schema` target that does not exist, and a function
signature that could not work — reading a response body is asynchronous, so no
record is complete when the event handler returns. Plans written by a model are
as reviewable as its code, and need to be reviewed the same way.
