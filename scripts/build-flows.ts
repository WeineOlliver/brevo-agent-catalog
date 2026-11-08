/**
 * Builds flows/index.json: authored intent, derived steps.
 *
 * The split is the point. A human writes what a flow is for and why each step
 * exists, because that is judgement. The step list itself is read out of the
 * capture, because that is evidence — and `pnpm validate` re-derives it, so the
 * two can never quietly disagree.
 *
 * Adding a flow means adding a definition here with a capture window and one
 * line of prose per action the window contains. A window that produces an
 * action with no prose fails the build rather than shipping an empty reason:
 * the thing an agent most needs from a flow is why a step is there.
 */

import { readFileSync, readdirSync, writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import 'dotenv/config';
import { loadConfig } from '../src/config.js';
import { deriveFlowSteps, type CaptureRecord, type EndpointRef } from '../src/flows/derive.js';
import { FlowIndexSchema, type Flow } from '../src/flows/schema.js';

type FlowDefinition = {
  id: string;
  name: string;
  goal: string;
  when_to_use: string;
  evidence: { capture: string; from: string; to: string };
  /** One line per action the window yields, keyed by action id. */
  why: Record<string, string>;
  optional?: string[];
  notes?: string[];
};

const DEFINITIONS: FlowDefinition[] = [
  {
    id: 'send_email_campaign',
    name: 'Create and send an email campaign',
    goal: 'Send a marketing email to a list of contacts, from nothing to delivered.',
    when_to_use:
      'The user wants an email to go out. Not for reading how a sent campaign performed, and not for scheduling: the last step has a scheduling counterpart that replaces it.',
    evidence: {
      capture: 'captures/clean/har/block-c-email.json',
      from: '07:17:45',
      to: '07:20:57',
    },
    why: {
      'email_campaigns.create_regular':
        'Creates the draft and returns the campaign id every later step needs. Nothing else in this flow can run before it.',
      'email_campaigns.count_recipients':
        'Reports how many contacts the chosen audience resolves to, so a send can be sanity-checked before it is irreversible.',
      'email_campaigns.save_campaign_recipients':
        'Attaches the audience. A campaign with no recipients cannot be sent.',
      'email_campaigns.save_subject':
        'Sets the subject line, which Brevo stores separately from the design.',
      'email_campaigns.save_newsletter_design':
        'Stores the email body. The design lives in the editor service, not with the campaign, which is why this step changes host.',
      'newsletters.preview':
        'Renders the email as the recipient will see it, without sending anything.',
      'email_campaigns.send_test_email':
        'Sends one copy to the operator. Marked destructive because mail leaves the account, but the blast radius is your own inbox.',
      'campaigns.send_now':
        'Delivers to every recipient. Irreversible, and the only step here that reaches real people.',
    },
    optional: [
      'email_campaigns.count_recipients',
      'newsletters.preview',
      'email_campaigns.send_test_email',
    ],
    notes: [
      'The capture shows all eight calls against one campaign id, so the ordering is observed and not inferred.',
      'To schedule instead of sending, replace the final step with the schedule action. Do not call both.',
      'The selection eval misses "push it out to everyone right now" by choosing the campaign listing action, which is a reasonable first move when the task names a campaign rather than an id. This flow is the answer that miss was asking for.',
    ],
  },
  {
    id: 'onboard_contact',
    name: 'Add a contact, with its company and list membership',
    goal: 'Get a new person into Brevo, attached to the right company and the right audience.',
    when_to_use:
      'The user wants someone added. Skip the steps that do not apply: a contact needs neither a company nor a list to exist.',
    evidence: {
      capture: 'captures/clean/har/block-a-contacts.json',
      from: '06:20:47',
      to: '06:23:34',
    },
    why: {
      'lists.create_list':
        'Creates the audience first, because adding a contact to a list needs that list to exist. Skip it when adding to a list that is already there.',
      'companies.create_company':
        'Creates the company record the contact will be linked to. Skip it for a contact with no company.',
      'contacts.create_contact':
        'Creates the contact and returns the contact id. This is the step that makes the person exist.',
      'contacts.link_unlink_company':
        'Associates the contact with the company. Separate from contact creation, so a contact created without one is linked afterwards rather than re-created.',
      'contacts.add_contact_to_lists':
        'Puts the contact into one or more lists, which is what makes them reachable by a campaign.',
      'contacts.update_contact':
        'Fills in attributes after creation. The capture shows the operator editing fields in the contact form rather than passing everything to the create call.',
    },
    optional: [
      'lists.create_list',
      'companies.create_company',
      'contacts.link_unlink_company',
      'contacts.update_contact',
    ],
    notes: [
      'Creating a contact is not destructive and is reversible, unlike deleting one.',
      'A contact that exists but is in no list receives no campaigns. The membership step is what people forget.',
    ],
  },
  {
    id: 'erase_contact',
    name: 'Honour a deletion request',
    goal: 'Remove a person from Brevo entirely, as a right-to-erasure request requires.',
    when_to_use:
      'Only when the user wants the person GONE. Someone who asked to stop receiving email wants the unsubscribe step and nothing after it — stopping at the first step is a different, reversible outcome.',
    evidence: {
      capture: 'captures/clean/har/block-a-contacts.json',
      from: '06:29:23',
      to: '06:29:49',
    },
    why: {
      'contacts.update_contact':
        'Marks the contact unsubscribed. Reversible, and for a "stop emailing me" request this is the whole job.',
      'contacts.delete_contact':
        'Destroys the contact record. Irreversible, and it is this step alone that satisfies an erasure request.',
    },
    notes: [
      'These two steps are the confusable pair the selection eval exists to separate: unsubscribing someone who asked to be deleted leaves their data behind, and deleting someone who asked to be unsubscribed destroys it.',
      'The delete was executed against a real account and is one of the three verified entries in the catalog, so this flow ends in a proven call rather than an assumed one.',
    ],
  },
];

const config = loadConfig();

const endpoints: EndpointRef[] = readdirSync(config.paths.actions)
  .filter((file) => file.endsWith('.json') && file !== 'index.json')
  .map((file) => {
    const action = JSON.parse(
      readFileSync(join(config.paths.actions, file), 'utf8'),
    ) as { id: string; internal_endpoint: { method: string; path: string } };
    return {
      id: action.id,
      method: action.internal_endpoint.method,
      path: action.internal_endpoint.path,
    };
  });

const flows: Flow[] = [];
let failed = false;

for (const definition of DEFINITIONS) {
  const records = JSON.parse(
    readFileSync(definition.evidence.capture, 'utf8'),
  ) as CaptureRecord[];

  const derived = deriveFlowSteps(records, definition.evidence, endpoints);

  if (derived.unmatched.length > 0) {
    console.error(
      `${definition.id}: ${derived.unmatched.length} write(s) in the window match no catalog entry:`,
    );
    for (const miss of derived.unmatched) console.error(`  ${miss.method} ${miss.route}`);
    failed = true;
  }

  const missingProse = derived.actionIds.filter((id) => definition.why[id] === undefined);
  if (missingProse.length > 0) {
    console.error(
      `${definition.id}: no reason written for ${missingProse.join(', ')} — ` +
        'either narrow the window or say why the step is there.',
    );
    failed = true;
    continue;
  }

  flows.push({
    id: definition.id,
    name: definition.name,
    goal: definition.goal,
    when_to_use: definition.when_to_use,
    evidence: definition.evidence,
    steps: derived.actionIds.map((id) => ({
      action_id: id,
      why: definition.why[id] as string,
      optional: (definition.optional ?? []).includes(id),
    })),
    notes: definition.notes ?? [],
  });
}

if (failed) process.exit(1);

const index = FlowIndexSchema.parse({
  generated_at: new Date().toISOString(),
  count: flows.length,
  flows,
});

mkdirSync('flows', { recursive: true });
writeFileSync('flows/index.json', `${JSON.stringify(index, null, 2)}\n`, 'utf8');

console.log(`wrote flows/index.json — ${flows.length} flow(s)`);
for (const flow of flows) {
  console.log(`  ${flow.id}: ${flow.steps.length} step(s)`);
}
