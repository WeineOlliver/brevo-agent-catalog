/**
 * Lists verification recipes.
 *
 * `/contact/list-listing` is one of the two routes reconnaissance found usable:
 * a real dialog with a single named field rather than a wizard. It still took
 * four runs to verify, and each failure was a different wrong belief of mine —
 * worth recording, because the pattern is the lesson rather than the selectors.
 *
 * 1. "Could not open the dialog." The dialog was fine. `goto` waited for
 *    `networkidle` on a page whose analytics never go idle, returned false, and
 *    the recipe ignored the return value — so a navigation failure wore the
 *    costume of a selector failure. Both are fixed: `goto` now answers from the
 *    URL, and every step here names itself.
 *
 * 2. "Could not submit." The submit was fine. The recipe's own best-effort
 *    click on the folder control opened a dropdown that covered the button.
 *    A step added for robustness was the only reason the run failed.
 *
 * 3. Submit clicked, enabled, and sent nothing at all. Removing the folder
 *    click removed the overlay and the real requirement with it.
 *
 * The dialog had been saying so the whole time, and it took reading it rather
 * than reasoning about it: **"Folder* — Select the folder in order to
 * continue"**. A folder is mandatory and is NOT preselected. I had concluded it
 * was, by inferring from captured request bodies that carried `folder_id` and
 * `folder_name` — those came from a human session where a person had picked one.
 * Evidence of a filled field is not evidence of a default.
 *
 * So the folder step is required, not best-effort, and failing it ends the
 * recipe rather than letting the submit fail for a reason nobody can read.
 */

import type { Page } from 'playwright';
import type { FixtureBag } from '../../interact/types.js';
import type { VerifyRecipe } from '../harness.js';
import { goto, settle, submitDialog, tryClick, tryFill } from '../../interact/ui.js';

const LISTS_URL = 'https://app.brevo.com/contact/list-listing';

const OPEN_CREATE_LIST = ['role=button[name=/^create a list$/i]'];

const LIST_NAME_FIELD = [
  'input[name="create-listName"]',
  'input[placeholder="Enter a list name"]',
];

const OPEN_FOLDER_SELECT = ['text=/^select a folder$/i', 'text=/select a folder/i'];

/**
 * Any folder will do — the form only needs one chosen. `[role="option"]` is
 * what the dropdown actually renders; matching a folder by name would tie the
 * recipe to one account's folder list.
 */
const FOLDER_OPTION = ['[role="option"]'];

export const createListRecipe: VerifyRecipe = {
  actionId: 'lists.create_list',

  async run(page: Page, fx: FixtureBag): Promise<void> {
    if (!(await goto(page, LISTS_URL))) {
      throw new Error(`could not load ${LISTS_URL}`);
    }

    if (!(await tryClick(page, OPEN_CREATE_LIST))) {
      throw new Error('could not open the create-list dialog');
    }

    if (!(await tryFill(page, LIST_NAME_FIELD, fx.listName()))) {
      throw new Error('could not find the list-name field in the dialog');
    }

    if (!(await tryClick(page, OPEN_FOLDER_SELECT))) {
      throw new Error('could not open the folder selector, which the form requires');
    }
    await settle(page, 1200);

    if (!(await tryClick(page, FOLDER_OPTION))) {
      throw new Error('the folder selector opened but offered no option to pick');
    }
    await settle(page, 1000);

    // "Create list", not "Create a list": the second opens the dialog. The
    // whole-label match in submitDialog is what keeps those apart.
    if (!(await submitDialog(page, { names: ['create list', 'create'] }))) {
      throw new Error('could not submit the create-list dialog');
    }

    await settle(page, 4000);
  },
};

export const listsRecipes: VerifyRecipe[] = [createListRecipe];
