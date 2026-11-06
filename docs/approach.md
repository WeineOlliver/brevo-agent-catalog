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

## Current state

The pipeline is complete and tested — 241 tests, strict TypeScript, clean
typecheck. The stages requiring an authenticated Brevo session have not run,
because they need a manual login that only the account holder can perform. No
document in this repository reports a number it has not measured; see
[gaps.md](gaps.md).
