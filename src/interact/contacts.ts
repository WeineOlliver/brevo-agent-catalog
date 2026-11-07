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
import { SAVE_BUTTON, goto, settle, submitDialog, tryClick, tryFill } from './ui.js';

// Measured on the reconnaissance run: the dialog's email input is
// `name="email"`, typed `text` rather than `email`, labelled `EMAIL`.
const EMAIL_FIELD = [
  'input[name="email"]',
  'input[placeholder="Enter the email address"]',
  'role=textbox[name=/email/i]',
  'input[type="email"]',
  'input[name*="email" i]',
  'input[placeholder*="email" i]',
];

// The list dialog's input is `name="create-listName"`, placeholder
// "Enter a list name" — neither of which a `/name/i` role match reaches.
const NAME_FIELD = [
  'input[name="create-listName"]',
  'input[placeholder="Enter a list name"]',
  'role=textbox[name=/name/i]',
  'input[name*="name" i]',
  'input[placeholder*="name" i]',
];

/** Measured on the reconnaissance run; the testid is the contact form's own. */
const CONTACT_SUBMIT = {
  testIds: ['cont_creation_form_create_btn'],
  names: ['create', 'create contact', 'save'],
};

/** Lists share Brevo's generic button testid, so the label is all there is. */
const LIST_SUBMIT = { names: ['create list', 'create'] };

export const contactsPass: InteractionPass = {
  module: 'contacts',

  async run(page, fx): Promise<void> {
    await goto(page, 'https://app.brevo.com/contact/list');

    // "Create a contact", not "Add a contact": two runs failed on the latter.
    // The testid is Brevo's own and specific, so it leads.
    const opened = await tryClick(page, [
      '[data-testid="createContactBtn"]',
      'role=button[name=/^create a contact$/i]',
      'role=link[name=/^create a contact$/i]',
      'text=/^create a contact$/i',
      'role=button[name=/add a contact/i]',
    ]);
    if (!opened) {
      console.warn('  contacts: no "Create a contact" control found — UI has changed');
      return;
    }

    // Empty submit first, to capture the validation response.
    await submitDialog(page, CONTACT_SUBMIT);
    await settle(page, 1500);

    if (!(await tryFill(page, EMAIL_FIELD, fx.email()))) {
      console.warn('  contacts: no email field found — UI has changed');
      return;
    }

    await submitDialog(page, CONTACT_SUBMIT);
    await settle(page);
  },
};

export const listsPass: InteractionPass = {
  module: 'lists',

  async run(page, fx): Promise<void> {
    await goto(page, 'https://app.brevo.com/contact/list-listing');

    const opened = await tryClick(page, [
      'role=button[name=/^create a list$/i]',
      'role=link[name=/^create a list$/i]',
      'text=/^create a list$/i',
      'role=button[name=/new list|add a list/i]',
    ]);
    if (!opened) {
      console.warn('  lists: no "Create a list" control found — UI has changed');
      return;
    }

    await submitDialog(page, LIST_SUBMIT);
    await settle(page, 1500);

    if (!(await tryFill(page, NAME_FIELD, fx.listName()))) {
      console.warn('  lists: no name field found — UI has changed');
      return;
    }

    await submitDialog(page, LIST_SUBMIT);
    await settle(page);
  },
};

/**
 * Known incomplete. Reconnaissance showed "Create a segment" navigates to
 * /contact/segment/templates — a multi-step builder, not a dialog with a name
 * field. This pass therefore reaches the first step and stops; segment creation
 * is captured by hand instead. Left in place because the navigation itself is
 * real traffic worth recording.
 */
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
