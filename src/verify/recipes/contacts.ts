/**
 * Contacts verification recipes.
 *
 * Deliberately thin. Which actions are worth verifying is decided from the
 * finished catalogue, not guessed at before it exists (design D3) — so this
 * file grows once there is something to choose from.
 *
 * No recipe deletes anything. The harness is permitted to remove its own
 * fixtures, but a mis-aimed selector on a delete control is the one mistake
 * here that cannot be undone, so fixtures are reported for bulk removal
 * instead. Every one is prefixed `catalog-test-`.
 */

import type { Page } from 'playwright';
import type { FixtureBag } from '../../interact/types.js';
import type { VerifyRecipe } from '../harness.js';
import { SAVE_BUTTON, goto, settle, tryClick, tryFill } from '../../interact/ui.js';

export const createContactRecipe: VerifyRecipe = {
  actionId: 'contacts.create_contact',

  async run(page: Page, fx: FixtureBag): Promise<void> {
    await goto(page, 'https://app.brevo.com/contact/list');

    const opened = await tryClick(page, [
      'role=button[name=/add a contact/i]',
      'role=link[name=/add a contact/i]',
      'text=/add a contact/i',
    ]);
    if (!opened) throw new Error('could not open the add-contact form');

    const filled = await tryFill(
      page,
      ['role=textbox[name=/email/i]', 'input[type="email"]', 'input[name*="email" i]'],
      fx.email(),
    );
    if (!filled) throw new Error('could not find the email field');

    const saved = await tryClick(page, SAVE_BUTTON);
    if (!saved) throw new Error('could not submit the form');

    await settle(page, 3000);
  },
};

export const contactsRecipes: VerifyRecipe[] = [createContactRecipe];
