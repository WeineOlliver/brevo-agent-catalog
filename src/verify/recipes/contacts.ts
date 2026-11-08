/**
 * Contacts verification recipes.
 *
 * Which actions are worth verifying is decided from the finished catalogue, not
 * guessed at before it exists (design D3).
 *
 * Every selector here is one that was measured on the real page — by the
 * selector reconnaissance run, or by probing the live app — not one I thought
 * Brevo probably used. The first version of this file looked for "add a
 * contact"; the button is labelled "Create a contact" and carries
 * `data-testid="createContactBtn"`, so the recipe could never have opened the
 * form it was written to submit.
 *
 * Submits go through `submitDialog` rather than a hand-rolled candidate list,
 * because it already encodes the trap: Brevo's page-level trigger reads "Create
 * a contact" while the dialog's submit reads "Create", and a loose match finds
 * the trigger first and reopens the form instead of saving it.
 *
 * ## On deleting
 *
 * This file used to state that no recipe deletes anything, and that fixtures
 * are reported for manual removal instead, because a mis-aimed selector on a
 * delete control is the one mistake that cannot be undone.
 *
 * That has changed deliberately, with the account owner's explicit approval,
 * for a reason worth stating: `destructive: true` is the flag an agent acts on,
 * and leaving the destructive actions the only unverified ones means the part
 * of the catalog that matters most is the part nothing has ever proved. A
 * delete that is never executed is a delete whose entry is a guess.
 *
 * The caution is kept where it belongs — in a guard rather than in a policy of
 * abstention. `deleteContactRecipe` reads the address off the page it is about
 * to act on and refuses unless it is one of our own `catalog-test-` fixtures.
 * A selector that drifts onto somebody's real contact fails the check and ends
 * the recipe, which is the behaviour abstention was buying, without giving up
 * the evidence.
 */

import type { Page } from 'playwright';
import type { FixtureBag } from '../../interact/types.js';
import type { VerifyRecipe } from '../harness.js';
import { FIXTURE_PREFIX } from '../../interact/types.js';
import { goto, settle, submitDialog, tryClick, tryFill } from '../../interact/ui.js';

const CONTACTS_URL = 'https://app.brevo.com/contact/list';

/** Opens the create-contact dialog. Measured: label, testid and resulting URL. */
const OPEN_CREATE_CONTACT = [
  '[data-testid="createContactBtn"]',
  'role=button[name=/^create a contact$/i]',
];

const EMAIL_FIELD = [
  'input[name="email"]',
  'input[placeholder="Enter the email address"]',
  'role=textbox[name=/^email$/i]',
];

const SEARCH_FIELD = ['input[type="search"]', 'input[placeholder="Search"]'];

/** The fixture row's own link, which opens `/contact/index/:id`. */
const FIXTURE_ROW = [`text=/${FIXTURE_PREFIX}[^\\s]*@example\\.com/`];

const QUICK_ACTIONS = ['[aria-label="More quick actions"]'];

/** Measured on the live page: a menuitem reading "Delete permanently". */
const DELETE_MENU_ITEM = [
  '[role="menuitem"]:has-text("Delete permanently")',
  'text=/^delete permanently$/i',
];

export const createContactRecipe: VerifyRecipe = {
  actionId: 'contacts.create_contact',

  async run(page: Page, fx: FixtureBag): Promise<void> {
    // Checked, because a navigation that did not land makes every later step
    // fail for a reason that has nothing to do with the step.
    if (!(await goto(page, CONTACTS_URL))) {
      throw new Error(`could not load ${CONTACTS_URL}`);
    }

    if (!(await tryClick(page, OPEN_CREATE_CONTACT))) {
      throw new Error('could not open the create-contact dialog');
    }

    if (!(await tryFill(page, EMAIL_FIELD, fx.email()))) {
      throw new Error('could not find the email field in the dialog');
    }

    if (!(await submitDialog(page, { testIds: ['cont_creation_form_create_btn'], names: ['create', 'save'] }))) {
      throw new Error('could not submit the create-contact dialog');
    }

    // The create request is fired after the dialog closes, so returning too
    // early means the recorder never sees it and a working recipe reports as
    // unverified.
    await settle(page, 4000);
  },
};

export const deleteContactRecipe: VerifyRecipe = {
  actionId: 'contacts.delete_contact',

  async run(page: Page): Promise<void> {
    if (!(await goto(page, CONTACTS_URL))) {
      throw new Error(`could not load ${CONTACTS_URL}`);
    }

    // Narrow the table to our own fixtures before anything is clickable, so a
    // stray click cannot land on a real contact.
    if (!(await tryFill(page, SEARCH_FIELD, FIXTURE_PREFIX))) {
      throw new Error('could not find the contact search field');
    }
    await page.keyboard.press('Enter');
    await settle(page, 3500);

    if (!(await tryClick(page, FIXTURE_ROW))) {
      throw new Error(
        `no ${FIXTURE_PREFIX} contact to delete — run contacts.create_contact first`,
      );
    }
    await settle(page, 3000);

    // The guard. Whatever the selectors did, this asks the page which contact
    // is actually open and refuses anything that is not ours. An irreversible
    // action gets a check that does not depend on the steps that led to it.
    const body = (await page.locator('body').innerText().catch(() => '')) ?? '';
    const fixture = new RegExp(`${FIXTURE_PREFIX}[^\\s]*@example\\.com`).exec(body);
    if (fixture === null) {
      throw new Error(
        `refusing to delete: the open contact is not a ${FIXTURE_PREFIX} fixture (url ${page.url()})`,
      );
    }

    if (!(await tryClick(page, QUICK_ACTIONS))) {
      throw new Error('could not open the quick-actions menu');
    }
    await settle(page, 1500);

    if (!(await tryClick(page, DELETE_MENU_ITEM))) {
      throw new Error('could not find "Delete permanently" in the quick-actions menu');
    }
    await settle(page, 1800);

    // Brevo asks twice, and the second label is the one that acts: "Cancel" and
    // "Yes, delete permanently". Matching the whole label keeps them apart.
    if (!(await submitDialog(page, { names: ['yes, delete permanently', 'delete permanently'] }))) {
      throw new Error('could not confirm the deletion');
    }

    await settle(page, 4000);
  },
};

export const contactsRecipes: VerifyRecipe[] = [createContactRecipe, deleteContactRecipe];
