# For an agent working in this repository

This repository answers one question: **what can a user do in Brevo?**

Brevo is an email marketing platform. This is a catalogue of 170 things a user
can do in it, derived from watching the real application rather than from its
documentation. You are expected to answer questions about the product from it.

## Use the command, not the files

```bash
pnpm catalog                  # the areas, and how many capabilities each holds
pnpm catalog area <id>        # the capabilities in one area, by name
pnpm catalog show <id>        # one capability: what it does, what it costs
pnpm catalog flow <id>        # the order, when something takes several steps
pnpm catalog search "<task>"  # a weak keyword guess; browse instead when you can
pnpm catalog help             # this, from inside the tool
```

Every command takes `--json`.

**Do not read `actions/*.json` or `flows/index.json` directly.** Not because
they are secret — they are the source of everything above — but because the
whole index is 18 500 tokens and the three commands cost about a twentieth of
that for the same answer. Each reply ends with the next command to run, so you
can walk from a question to one capability in three steps.

`pnpm catalog show <id> --full` gives the stored record, with the evidence and
the UI path, if you need to check a claim.

## How to answer from it

**Say when something is not here.** The honest answer to "can I build an
automation that waits three days" is no: `pnpm catalog` reports the Automation
area as read-only, so this catalogue can describe automations and cannot create
one. Do not assemble a capability out of parts that look close. If the catalogue
does not hold it, say so.

**Pass on the irreversibility.** An entry that says `CANNOT BE UNDONE` is
irreversible or visible outside the account: deleting a contact, sending a
campaign to real recipients. Tell the person before they ask for it, not after.

**Separate looking from changing.** 31 of the 170 change something; 139 only
look. An agent that confuses the two promises things the account cannot do.

**When a request has two readings, ask.** "Take Maria off our base" might mean
unsubscribe her, which is reversible, or delete her, which is not. Both exist,
`pnpm catalog flow erase_contact` shows them as step one and step two of the
same flow, and choosing on the person's behalf is how the expensive mistake
happens.

**Quote the confidence.** Each capability says how sure the catalogue is.
`verified` means it was executed against a real account. `observed` means it was
seen in real traffic but never executed, so its inputs are a hypothesis — 194 of
197 entries are `observed`, and saying so is part of the answer.

## What this repository does not do

**Nothing here performs an action.** The catalogue describes what a user can do;
it does not do it. There is no `execute_action`, by decision rather than
omission, and no Brevo API key exists anywhere in it. If someone wants an action
performed, your answer is how it is done in the product, not a request you send.

Entries record the internal endpoint the app calls, as the evidence that the
capability is real. They deliberately do **not** record which host serves it, so
they are not callable, and that is a known gap rather than an oversight — see
[docs/gaps.md](docs/gaps.md).

## If you are working on the repository rather than answering from it

Read [README.md](README.md) first, then
[docs/decisions.md](docs/decisions.md) — 16 decisions with what was rejected and
what it cost. Before changing anything, know that:

- `actions/index.json`, `flows/index.json` and `docs/modules.md` are generated.
  Edit the pipeline, never the output: `pnpm build:index`, `pnpm build:flows`,
  `pnpm build:docs`.
- `pnpm validate` is the gate — schema, cross-references at zero, flows
  re-derived from their captures, every action in exactly one area.
- `pnpm scan` is the leak gate and runs before any push.
- `pnpm eval` costs LLM provider quota. `pnpm test`, `pnpm validate` and
  `pnpm bench:search` cost nothing.
