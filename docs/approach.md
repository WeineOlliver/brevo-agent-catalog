# Approach

How the problem was framed and what was prioritized. The decisions themselves,
with their rejected alternatives and costs, are in
[decisions.md](decisions.md) — this document does not repeat them.

## Framing

The brief asks for a catalog of business actions that an AI agent could pick up
and act on. The interesting word is *act*. A catalog an agent can read is easy;
a catalog an agent can act on without a human double-checking is the whole
difficulty, and it is what the Reliability axis is asking about.

That reframing drove everything. The question stopped being "how many actions can
I list?" and became **"for each action, what do I actually know, and how do I say
so in a way a machine can filter on?"** Hence `verification.status` as a
first-class, enforced field rather than a footnote, and hence the decision that
spec-derived entries do not get promoted above `inferred`.

The second framing came from reconnaissance rather than from the brief. Before
writing any code I checked what Brevo publishes, and the numbers settled the
architecture: 292 public operations, of which 79 are partner/reseller surface a
user never sees, and no public coverage at all for automation, landing pages,
forms, meetings or push. The public API and the product overlap; neither
contains the other. That is the brief's premise made concrete, and it is why the
pipeline starts in a browser.

## What was prioritized, and why

**First: the honesty mechanism.** The schema, the three confidence levels with
written rules, and the fail-safe risk flags were built before anything that
produces volume. A catalog that over-claims is worse than a smaller one that
does not, because an agent acting on a fabricated precondition or a wrong
`destructive` flag fails in a way no amount of coverage compensates for. Getting
this wrong is unrecoverable; getting coverage wrong is just a smaller number.

**Second: determinism wherever it was available.** Every field that can be
derived from evidence is derived in code — `internal_endpoint` from the capture,
`public_api` from the spec match, `verification` from what was executed. The
model is spent only on what genuinely cannot be derived: the agent-facing
description, preconditions, side effects, and the risk judgments. Asking a model
for facts you already hold is the main source of fabricated documentation, and
it is free to avoid.

**Third: the thing that would sink the weekend.** The crawl depends on a live
session that Brevo can refuse at any moment. A capture-source abstraction was
built in from the start so a hand-exported HAR feeds the identical pipeline.
Cheap on Friday, impossible to retrofit on Sunday.

**Fourth: measurement over assertion.** The selection eval exists because
"designed for agents" is a claim, and a score against tasks phrased the way a
user would phrase them is a measurement. Its failures are not curiosities — each
one is a description an agent could not resolve, which is a Reliability bug found
before shipping rather than after.

## What was deliberately not done

An MCP server was planned and then dropped (decisions #4). Execution is out of
scope: the catalog describes actions, and nothing here performs them against
Brevo at runtime. Automated deletion of test fixtures was skipped even though the
mutation bounds permit it, because a mis-aimed selector on a delete control is
the one mistake in this project that cannot be undone.

## Sequencing

Deliberately waterfall, because the deadline rewards it. A design document was
written and reviewed before any code; a fresh engineer then read that document
cold and reported what they would have had to guess at, which surfaced five real
gaps — most importantly that the three confidence levels were undefined beyond
`verified`, and that the crawl as specified would see almost no write traffic.
Both were fixed in the design rather than discovered in the implementation. The
implementation plan that followed was executed task by task under TDD, with every
deviation from the plan recorded as a ruling at the time it was made.

## What running it actually taught

Two findings changed how I'd describe this problem, and both only appeared once
the pipeline ran against a real account.

**The public API and the product are different APIs.** Not overlapping subsets —
different. **0 of 197** catalogued endpoints map onto an operation in Brevo's
published spec. The earlier, smaller catalog managed 2 of 126; tripling the
capture and adding every write flow did not add one. The overlap is not small
because coverage was thin. The app runs on ~20 internal microservices the public `/v3` surface does
not wrap. The brief's premise is not a hypothetical about legacy systems; it is
true of a modern SaaS product with a well-documented API.

**A crawl that clicks nothing produces a read-only catalog.** 118 actions
captured, 108 of them `get` or `list`, exactly one write. The selection eval
scored 0 of 20 against the tasks a user would ask for. This was predicted as a
risk in review before any code was written, mitigated by designing the
interaction stage in — and then it happened anyway at full strength, because the
mitigation had not been run yet. The lesson I would carry forward is that for
this class of problem, interaction is the coverage mechanism and crawling is
only reconnaissance.

The second finding is also the clearest argument for having built the eval. A
coverage count would have reported 118 actions and read as success.

**And the mechanism that fixed it was not more engineering.** Four hand-driven
DevTools recordings, about fifteen minutes each, imported through the same
pipeline, took the capture from 3 097 requests to 38 132 and the write endpoints
from 4 to 38. `parseHar` had been written and tested in the first week and had no
caller; it became the stage that mattered most. The selector work that was meant
to do this job reached two of six target routes. Knowing which of your own
components is load-bearing is apparently not something design tells you — the
measurement did.

## Current state

The pipeline is complete and tested — 461 tests, strict TypeScript, clean
typecheck, leak gate clean across every tracked file. It has run end to end
against a live account: 38 routes crawled plus four hand-driven HAR sessions,
38 132 requests observed and 2 147 committed after sanitizing, 197 actions
catalogued, validated and
indexed, and a selection eval scored at **17 of 19 scoreable tasks**.

Every one of the 38 distinct write endpoints in the capture has a catalog entry,
including the irreversible `POST /marketing-campaign/api/campaign/2/send-now`
that returned 204, and the 5-call campaign machine and 3-call CSV import wizard
behind it. 3 entries are now `verified` by execution rather than by reading
traffic, including the destructive `delete_contact`. The other 194 are
`observed`, and sender creation is still missing entirely.
No document here reports a
number it has not measured; the ones that look bad are in
[gaps.md](gaps.md) and [eval.md](eval.md) rather than omitted.
