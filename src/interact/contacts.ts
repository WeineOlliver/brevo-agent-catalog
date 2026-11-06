/**
 * Contacts and lists write passes.
 *
 * The first real crawl captured 118 actions of which exactly one was a write:
 * a navigation-only crawl sees `GET` traffic. The POST and PUT bodies behind
 * "create a contact" and "add to a list" — the actions the catalog is actually
 * about — only exist if something fills the form and submits it.
 *
 * Each pass deliberately submits once with the required field empty before
 * filling it: the validation response is the best available evidence for which
 * fields are really required, which is what agents get wrong most often.
 */

import type { InteractionPass } from './types.js';
import { SAVE_BUTTON, goto, settle, tryClick, tryFill } from './ui.js';

const EMAIL_FIELD = [
  'role=textbox[name=/email/i]',
  'input[type="email"]',
  'input[name*="email" i]',
  'input[placeholder*="email" i]',
];

const NAME_FIELD = [
  'role=textbox[name=/name/i]',
  'input[name*="name" i]',
  'input[placeholder*="name" i]',
];

export const contactsPass: InteractionPass = {
  module: 'contacts',

  async run(page, fx): Promise<void> {
    await goto(page, 'https://app.brevo.com/contact/list');

    const opened = await tryClick(page, [
      'role=button[name=/add a contact/i]',
      'role=link[name=/add a contact/i]',
      'role=button[name=/add contact/i]',
      'text=/add a contact/i',
    ]);
    if (!opened) {
      console.warn('  contacts: no "add a contact" control found — UI has changed');
      return;
    }

    // Empty submit first, to capture the validation response.
    await tryClick(page, SAVE_BUTTON);
    await settle(page, 1500);

    if (!(await tryFill(page, EMAIL_FIELD, fx.email()))) {
      console.warn('  contacts: no email field found — UI has changed');
      return;
    }

    await tryClick(page, SAVE_BUTTON);
    await settle(page);
  },
};

export const listsPass: InteractionPass = {
  module: 'lists',

  async run(page, fx): Promise<void> {
    await goto(page, 'https://app.brevo.com/contact/list-listing');

    const opened = await tryClick(page, [
      'role=button[name=/create a list/i]',
      'role=link[name=/create a list/i]',
      'role=button[name=/new list|add a list/i]',
      'text=/create a list/i',
    ]);
    if (!opened) {
      console.warn('  lists: no "create a list" control found — UI has changed');
      return;
    }

    await tryClick(page, SAVE_BUTTON);
    await settle(page, 1500);

    if (!(await tryFill(page, NAME_FIELD, fx.listName()))) {
      console.warn('  lists: no name field found — UI has changed');
      return;
    }

    await tryClick(page, SAVE_BUTTON);
    await settle(page);
  },
};

export const segmentsPass: InteractionPass = {
  module: 'segments',

  async run(page, fx): Promise<void> {
    await goto(page, 'https://app.brevo.com/contact/segment');

    const opened = await tryClick(page, [
      'role=button[name=/create a segment/i]',
      'role=link[name=/create a segment/i]',
      'role=button[name=/new segment/i]',
      'text=/create a segment/i',
    ]);
    if (!opened) {
      console.warn('  segments: no "create a segment" control found — UI has changed');
      return;
    }

    await tryFill(page, NAME_FIELD, fx.listName());
    await tryClick(page, SAVE_BUTTON);
    await settle(page);
  },
};
