# How AI was used

Tools, models, workflow, and what had to be corrected by hand. Split between
**AI inside the product** (the extraction pipeline) and **AI used to build it**,
because the brief asks about the system, not only the output.

## AI inside the pipeline

### Two models, split by the shape of the job

| Pass | Model | Why |
|---|---|---|
| Breadth — draft an entry for every discovered route | **Groq** (`llama-3.3-70b-versatile` by default) | A throughput problem: ~200 candidates, cheap and fast, paced at ~28 req/min for the free tier |
| Core — the judgment-heavy fields | **Headless Claude Code** (`claude -p`) | Disambiguating neighbouring actions, inferring preconditions, judging destructiveness. These are what Reliability is scored on |

Both sit behind one interface (`src/providers/types.ts`) with injected
transports, so every provider test runs offline and a reviewer can substitute
their own provider. The Claude adapter shells out to the authenticated `claude`
CLI, so **no Anthropic API key exists in this repository**.

### What the model is and is not asked for

The model is asked only for semantics: `id`, `module`, `name`, `description`,
`preconditions`, `inputs`, `outputs`, `side_effects`, `ui_path`, `plan_tier`, and
the risk flags for read actions.

Everything derivable is derived in code (`src/extract/draft.ts`):
`internal_endpoint` from the capture, `public_api` from the OpenAPI join,
`verification` from what was actually executed. Asking a model for facts you
already hold is the main source of fabricated documentation, and declining to do
it is free.

Where a captured endpoint matched a public operation, the spec's required fields
and enums are given to the model as **authoritative over anything it might infer
from the samples** — a captured example shows one valid call, not the contract.

### Three guardrails that do not trust the model

1. **ajv is a hard gate.** A draft that does not validate never reaches
   `actions/`. On failure the validation errors are appended to the prompt and
   the draft is retried once; a draft that fails twice is recorded in
   `data/extract-failures.json` with its raw output, never silently dropped.
2. **The risk flags are clamped in code.** Any non-read action becomes
   `destructive: true, idempotent: false` regardless of what the model claimed.
   The prompt asks for the rule; code enforces it, because a prompt is a request
   and this needs to be a guarantee.
3. **Output parsing assumes the worst.** `extractJsonObject` handles bare JSON,
   markdown fences, and JSON buried in prose, with a string-aware brace scanner
   so a `}` inside a string value does not truncate the span. A response with no
   JSON returns a *reason*, not an exception, because the repair loop needs the
   reason.

### Measuring the model rather than trusting it

Two mechanisms exist specifically to catch the model being wrong:

- **Verification** (`pnpm verify`) executes an action for real and compares what
  the drafted entry claimed against what happened. This is not only a stamp — it
  is how the pipeline's error rate gets measured.
- **The selection eval** (`pnpm eval`) checks whether a model can resolve a
  naturally-phrased task to the right entry with the right inputs. Each failure
  is a description an agent could not resolve.

> **Not yet measured.** Both require a live account and a built catalog, and
> neither has run. The error-rate numbers that belong here — how many drafted
> entries had wrong required fields or invented preconditions, and what changed
> in the prompts as a result — are the single most valuable thing missing from
> this submission. See [gaps.md](gaps.md).

## AI used to build this

Built with Claude Code, deliberately as a staged process rather than a chat.

**Brainstorming before design.** The problem was interrogated before anything was
written — which produced the two reframings in [approach.md](approach.md). One
recommendation was reversed mid-conversation under challenge: an MCP server was
proposed, argued for, then dropped on the realization that the
context-pressure justification did not survive arithmetic (200 entries is ~8k
tokens) and that a selection eval buys the same proof more directly. That
reversal is recorded in [decisions.md](decisions.md) #4 rather than quietly
dropped.

**Reconnaissance before architecture.** Brevo's spec was downloaded and counted
before the design was written — 292 operations, 208 paths, 79 partner-surface
operations, five product areas with no coverage. Those numbers chose the
architecture; without them the plan would have been a guess.

**A design document, reviewed cold.** The design was written, then a fresh agent
with no conversation context read it as a builder and reported what it would have
had to guess. Five findings were real and changed the design before any code:
the three confidence levels were undefined beyond `verified`; the crawl as
specified would observe almost no write traffic (which would have made every
write action `inferred`, violating the project's own anti-goal); verification had
three incompatible possible mechanisms and the document picked none; the
redaction policy covered secrets but not identifiers; and the unverifiable risk
flags had no defined default.

**TDD throughout, with rulings recorded.** Every one of the 268 tests was written
and watched fail before its implementation. Where the plan turned out to be
wrong — and it was wrong in several places, including a function signature that
could not work and a library target that does not exist — the deviation was
decided, recorded with its cost, and carried forward rather than silently
patched.

### What had to be fixed by hand

Honest list, from this build:

- The plan specified `zod-to-json-schema`'s `jsonSchema2020-12` target, which
  does not exist. Resolved by generating at 2019-09, setting `$schema` to
  2020-12, and *proving* the result compiles under Ajv's 2020 build rather than
  asserting it.
- The plan's `attachRecorder(page, getRoute): CaptureRecord[]` signature could
  not work: reading a response body is asynchronous, so no record is complete
  when the event handler returns. Became `{ records, drain() }`.
- `applyOutcome(action, outcome)` could not express "clear the fail-safe flag
  only when execution proved it". Gained a third, verified-only parameter.
- A hand-written test fixture declared a byte size one larger than its own
  content, which the truncation rule correctly flagged — a fixture bug that would
  have looked like a code bug.
- `pnpm` 12 moved `onlyBuiltDependencies` out of `package.json` and renamed it;
  two wrong guesses before reading the CLI's own help text. Fixed in
  `pnpm-workspace.yaml` as configuration, not as a local workaround.
- The design's non-goal list said "not an execution engine" but the plan's file
  layout still implied an `mcp/` directory; resolved by demoting it explicitly to
  a stretch goal with the reasoning written down.
