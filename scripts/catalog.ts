/**
 * `pnpm catalog` — what can a user do in this app?
 *
 * That is the question, and it is worth stating because it decides the shape of
 * every answer here. An agent consulting this catalogue is not about to call
 * Brevo; it wants to tell someone whether a thing is possible, what it costs,
 * and what has to be true first. So replies lead with the capability and the
 * consequence, and the endpoint appears at the bottom as the evidence that the
 * capability is real.
 *
 * Decision #4 demoted an MCP server, and this is the cheaper half of what one
 * would have provided: an agent already has a shell, so a server adds a
 * protocol and a lifecycle to a problem that needed neither. Nothing here
 * performs an action — it reads the catalogue, it never calls Brevo.
 *
 * Every subcommand takes --json, because the text output is for a person
 * reading over the agent's shoulder and the JSON is for the agent.
 *
 *   pnpm catalog                      the nine areas
 *   pnpm catalog area contacts        what is in one area, names only
 *   pnpm catalog show <id>            what you need to call it (--full for the record)
 *   pnpm catalog search "<task>"      ranked guesses across every area
 *   pnpm catalog flows                the multi-step recipes
 *   pnpm catalog flow <id>            one recipe, in order
 */

import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { AREAS } from '../src/catalog/areas.js';
import {
  NOT_A_USER_CAPABILITY,
  briefOf,
  findFlow,
  flowsContaining,
  listArea,
  renderAreas,
  renderBrief,
  search,
  summariseAreas,
  type CatalogIndexFile,
  type FlowFile,
  type StoredAction,
} from '../src/cli/query.js';

const args = process.argv.slice(2);
const json = args.includes('--json');
/**
 * `--full` prints the stored entry verbatim. Without it, `show` answers the
 * question an agent asked — what to call, what to send, what it costs if wrong
 * — and leaves out the provenance it cannot act on.
 */
const full = args.includes('--full');
/**
 * `--all` includes the `platform` area: what the web app calls to render
 * itself. Excluded by default because it is not something a user does.
 */
const all = args.includes('--all');
const positional = args.filter((arg) => !arg.startsWith('--'));
const [command = 'areas', ...rest] = positional;

const INDEX = join('actions', 'index.json');
const FLOWS = join('flows', 'index.json');

if (!existsSync(INDEX)) {
  console.error(`No ${INDEX}. Run "pnpm build:index" first.`);
  process.exit(1);
}

const index = JSON.parse(readFileSync(INDEX, 'utf8')) as CatalogIndexFile;
const flows: FlowFile = existsSync(FLOWS)
  ? (JSON.parse(readFileSync(FLOWS, 'utf8')) as FlowFile)
  : { count: 0, flows: [] };

function emit(value: unknown): void {
  console.log(JSON.stringify(value, null, 2));
}

function risk(destructive: boolean): string {
  return destructive ? '  [destructive]' : '';
}

/**
 * The tool has to explain itself.
 *
 * An agent arrives having cloned a repository and been asked what a user can
 * do. It has no instruction layer beyond what it finds here, and in an
 * evaluation it will not be given one. AGENTS.md is the first half of the
 * answer, because agent tooling reads it on sight; this is the second, because
 * a tool that only makes sense alongside a document is a tool that will be used
 * wrongly the first time the document is skipped.
 *
 * So every reply ends with the next command, and `help` states the rules that
 * cannot be inferred from a reply: say when something is absent, pass on
 * irreversibility, ask when a request has two readings.
 */
const HELP = [
  'pnpm catalog — what can a user do in Brevo?',
  '',
  'This is a catalogue of 170 things a user can do in Brevo, derived from',
  'watching the real app. Nothing here performs an action.',
  '',
  'Commands (each takes --json):',
  '  pnpm catalog                  the areas, and how many capabilities each holds',
  '  pnpm catalog area <id>        the capabilities in one area, by name',
  '  pnpm catalog show <id>        one capability: what it does, what it costs',
  '  pnpm catalog show <id> --full the stored record, with evidence',
  '  pnpm catalog flow <id>        the order, when something takes several steps',
  '  pnpm catalog flows            the multi-step ones',
  '  pnpm catalog search "<task>"  a weak keyword guess; prefer browsing',
  '  pnpm catalog --all            include what the app calls to draw itself',
  '',
  'Answering from it:',
  '  - Say when something is not here. An area reported as read-only cannot be',
  '    made to write by combining entries that look close.',
  '  - Pass on "CANNOT BE UNDONE" before the person asks, not after.',
  '  - 31 of the 170 change something; 139 only look. Do not promise the first',
  '    when the catalogue only holds the second.',
  '  - When a request has two readings — unsubscribe or delete — ask.',
  '  - Each capability states how sure the catalogue is. 194 of 197 entries were',
  '    seen in real traffic but never executed, so their inputs are a hypothesis.',
  '',
  'Reading actions/*.json directly works and costs twenty times more for the',
  'same answer. The three commands above are the cheap path.',
];

switch (command) {
  case 'help':
  case '--help':
  case '-h': {
    if (json) {
      emit({ help: HELP });
      break;
    }
    for (const line of HELP) console.log(line);
    break;
  }

  case 'areas': {
    const everything = summariseAreas(index, AREAS, flows);
    const summaries = all
      ? everything
      : everything.filter((area) => area.id !== NOT_A_USER_CAPABILITY);
    const hidden = everything
      .filter((area) => area.id === NOT_A_USER_CAPABILITY)
      .reduce((n, area) => n + area.count, 0);
    const shown = summaries.reduce((n, area) => n + area.count, 0);

    if (json) {
      emit({ count: shown, areas: summaries, ...(all ? {} : { excluded_plumbing: hidden }) });
      break;
    }
    for (const line of renderAreas(summaries, shown)) console.log(line);
    console.log('');
    if (!all && hidden > 0) {
      console.log(
        `(${hidden} further entries are what the app calls to draw itself — fonts,`,
      );
      console.log("locales, feature flags. Not user capabilities: 'pnpm catalog --all'.)");
      console.log('');
    }
    console.log('Next: pnpm catalog area <id>   |   pnpm catalog flows   |   pnpm catalog help');
    break;
  }

  case 'area': {
    const [areaId] = rest;
    if (areaId === undefined) {
      console.error('Usage: pnpm catalog area <id>. Run "pnpm catalog" for the list.');
      process.exit(1);
    }
    const listing = listArea(index, areaId);
    if (listing === null) {
      console.error(
        `No area "${areaId}". Known: ${AREAS.map((area) => area.id).join(', ')}`,
      );
      process.exit(1);
    }
    if (json) {
      emit(listing);
      break;
    }
    // Names only. The descriptions are the expensive part and are paid for on
    // the one entry that gets chosen, not on all 64 of them.
    console.log(`${listing.count} action(s) in ${listing.area}\n`);
    for (const entry of listing.entries) {
      console.log(`  ${entry.id.padEnd(44)} ${entry.name}${risk(entry.destructive)}`);
    }
    console.log('\nNext: pnpm catalog show <id>');
    break;
  }

  case 'show': {
    const [actionId] = rest;
    if (actionId === undefined) {
      console.error('Usage: pnpm catalog show <action id>');
      process.exit(1);
    }
    const path = join('actions', `${actionId}.json`);
    if (!existsSync(path)) {
      const guesses = search(index, actionId.replace(/[._]/g, ' '), 5);
      console.error(`No action "${actionId}".`);
      if (guesses.length > 0) {
        console.error(`Closest: ${guesses.map((hit) => hit.id).join(', ')}`);
      }
      process.exit(1);
    }
    const action = JSON.parse(readFileSync(path, 'utf8')) as Record<string, unknown>;
    const inFlows = flowsContaining(flows, actionId);

    if (full) {
      if (json) {
        emit({ ...action, flows: inFlows });
        break;
      }
      console.log(JSON.stringify(action, null, 2));
      if (inFlows.length > 0) {
        console.log(`\nPart of flow(s): ${inFlows.join(', ')} — pnpm catalog flow <id>`);
      }
      break;
    }

    const brief = briefOf(action as unknown as StoredAction, flows);
    if (json) {
      emit(brief);
      break;
    }
    for (const line of renderBrief(brief)) console.log(line);
    console.log('');
    console.log('(the stored entry, with evidence and UI path: add --full)');
    break;
  }

  case 'search': {
    const query = rest.join(' ');
    if (query.trim() === '') {
      console.error('Usage: pnpm catalog search "<what you are trying to do>"');
      process.exit(1);
    }
    const hits = search(index, query, 10, all);
    if (json) {
      emit({ query, hits });
      break;
    }
    if (hits.length === 0) {
      console.log(`Nothing matched "${query}". Try "pnpm catalog" and browse by area.`);
      break;
    }
    console.log(`${hits.length} guess(es) for "${query}"\n`);
    for (const hit of hits) {
      console.log(
        `  ${hit.id.padEnd(44)} ${hit.area.padEnd(14)} ${hit.name}${risk(hit.destructive)}`,
      );
    }
    console.log(
      '\nRanking is lexical, not semantic, and it is weak: on the eval\'s own 19 tasks' +
        '\nthe right answer is first 2 times and in the top 3 only 5 times (pnpm bench:search).' +
        '\nBrowsing by area beats trusting this order.',
    );
    break;
  }

  case 'flows': {
    if (json) {
      emit({
        count: flows.count,
        flows: flows.flows.map((flow) => ({
          id: flow.id,
          name: flow.name,
          goal: flow.goal,
          steps: flow.steps.length,
        })),
      });
      break;
    }
    if (flows.count === 0) {
      console.log('No flows. Run "pnpm build:flows".');
      break;
    }
    console.log(`${flows.count} flow(s)\n`);
    for (const flow of flows.flows) {
      console.log(`${flow.id.padEnd(22)} ${flow.steps.length} steps   ${flow.goal}`);
    }
    console.log('\nNext: pnpm catalog flow <id>');
    break;
  }

  case 'flow': {
    const [flowId] = rest;
    if (flowId === undefined) {
      console.error('Usage: pnpm catalog flow <id>. Run "pnpm catalog flows" for the list.');
      process.exit(1);
    }
    const flow = findFlow(flows, flowId);
    if (flow === null) {
      console.error(
        `No flow "${flowId}". Known: ${flows.flows.map((entry) => entry.id).join(', ') || '(none)'}`,
      );
      process.exit(1);
    }
    if (json) {
      emit(flow);
      break;
    }
    console.log(`${flow.name}\n`);
    console.log(`Goal:        ${flow.goal}`);
    console.log(`When to use: ${flow.when_to_use}`);
    console.log(`Evidence:    ${flow.evidence.capture} ${flow.evidence.from}-${flow.evidence.to}\n`);
    flow.steps.forEach((step, position) => {
      const marks = [step.optional ? 'optional' : null].filter(Boolean).join(', ');
      console.log(`${position + 1}. ${step.action_id}${marks ? `  (${marks})` : ''}`);
      console.log(`   ${step.why}`);
    });
    if (flow.notes.length > 0) {
      console.log('');
      for (const note of flow.notes) console.log(`! ${note}`);
    }
    break;
  }

  default:
    console.error(
      `Unknown command "${command}". Run "pnpm catalog help" for what this tool does.`,
    );
    process.exit(1);
}
