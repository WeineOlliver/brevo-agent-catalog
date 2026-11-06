/**
 * Campaign and template write passes.
 *
 * These cover the half of the brief's own examples that a navigation crawl
 * cannot reach: creating an email campaign, saving it as a draft, sending a
 * test. Nothing here sends to a real audience — the campaign is left a draft,
 * so the only mail that can leave is a test to the account's own address.
 */

import type { InteractionPass } from './types.js';
import { SAVE_BUTTON, goto, settle, tryClick, tryFill } from './ui.js';

const NAME_FIELD = [
  'role=textbox[name=/name|subject/i]',
  'input[name*="name" i]',
  'input[name*="subject" i]',
  'input[placeholder*="name" i]',
];

export const campaignsPass: InteractionPass = {
  module: 'campaigns',

  async run(page, fx): Promise<void> {
    await goto(page, 'https://app.brevo.com/campaigns/listing');

    const opened = await tryClick(page, [
      'role=button[name=/create a campaign|create an email campaign/i]',
      'role=link[name=/create a campaign/i]',
      'role=button[name=/new campaign/i]',
      'text=/create a campaign/i',
    ]);
    if (!opened) {
      console.warn('  campaigns: no "create a campaign" control found — UI has changed');
      return;
    }
    await settle(page, 2000);

    // Empty submit first, for the validation response.
    await tryClick(page, SAVE_BUTTON);
    await settle(page, 1500);

    await tryFill(page, NAME_FIELD, fx.listName());
    await tryClick(page, SAVE_BUTTON);
    await settle(page, 3000);

    // Saving as a draft is the write worth cataloguing; sending is not done.
    await tryClick(page, [
      'role=button[name=/save (as )?draft|save and quit|save and exit/i]',
      'text=/save as draft/i',
    ]);
    await settle(page);
  },
};

export const templatesPass: InteractionPass = {
  module: 'templates',

  async run(page, fx): Promise<void> {
    await goto(page, 'https://app.brevo.com/templates/listing');

    const opened = await tryClick(page, [
      'role=button[name=/create a template|new template/i]',
      'role=link[name=/create a template/i]',
      'text=/create a template/i',
    ]);
    if (!opened) {
      console.warn('  templates: no "create a template" control found — UI has changed');
      return;
    }
    await settle(page, 2000);

    await tryFill(page, NAME_FIELD, fx.listName());
    await tryClick(page, SAVE_BUTTON);
    await settle(page);
  },
};

export const sendersPass: InteractionPass = {
  module: 'senders',

  async run(page, fx): Promise<void> {
    await goto(page, 'https://app.brevo.com/settings/senders');

    const opened = await tryClick(page, [
      'role=button[name=/add a sender|add sender|new sender/i]',
      'role=link[name=/add a sender/i]',
      'text=/add a sender/i',
    ]);
    if (!opened) {
      console.warn('  senders: no "add a sender" control found — UI has changed');
      return;
    }

    await tryClick(page, SAVE_BUTTON);
    await settle(page, 1500);

    await tryFill(page, ['role=textbox[name=/name/i]', 'input[name*="name" i]'], 'Catalog Test');
    await tryFill(
      page,
      ['role=textbox[name=/email/i]', 'input[type="email"]', 'input[name*="email" i]'],
      fx.email(),
    );
    await tryClick(page, SAVE_BUTTON);
    await settle(page);
  },
};
