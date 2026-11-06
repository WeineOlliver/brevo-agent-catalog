/**
 * Contacts write pass.
 *
 * A link-only crawl sees GET traffic. The POST and PUT bodies behind "create a
 * contact" and "add to a list" — the actions the catalog is actually about —
 * only appear if something fills the form and submits it.
 *
 * Deliberately submits once with the required field empty first: the validation
 * response is the best evidence available for which fields are really required.
 *
 * Selectors are resilient-by-preference (roles and labels before CSS) because
 * Brevo's markup is not ours and will drift.
 */

import type { Page } from 'playwright';
import type { FixtureBag, InteractionPass } from './types.js';

const STEP_TIMEOUT = 15_000;

/** Best-effort click: a missing control is a layout change, not a crash. */
async function tryClick(page: Page, candidates: string[]): Promise<boolean> {
  for (const selector of candidates) {
    const locator = page.locator(selector).first();
    try {
      await locator.waitFor({ state: 'visible', timeout: 3_000 });
      await locator.click({ timeout: STEP_TIMEOUT });
      return true;
    } catch {
      continue;
    }
  }
  return false;
}

async function tryFill(page: Page, candidates: string[], value: string): Promise<boolean> {
  for (const selector of candidates) {
    const locator = page.locator(selector).first();
    try {
      await locator.waitFor({ state: 'visible', timeout: 3_000 });
      await locator.fill(value, { timeout: STEP_TIMEOUT });
      return true;
    } catch {
      continue;
    }
  }
  return false;
}

export const contactsPass: InteractionPass = {
  module: 'contacts',

  async run(page: Page, fx: FixtureBag): Promise<void> {
    await page.goto('https://app.brevo.com/contact/list', { waitUntil: 'networkidle' });

    const opened = await tryClick(page, [
      'role=button[name=/add a contact/i]',
      'role=link[name=/add a contact/i]',
      'role=button[name=/add contact/i]',
      'text=/add a contact/i',
    ]);

    if (!opened) {
      console.warn('  contacts: could not find an "add a contact" control — UI has changed');
      return;
    }

    // Submit empty first, so the validation response is captured.
    await tryClick(page, [
      'role=button[name=/save|create|add/i]',
      'button[type="submit"]',
    ]);
    await page.waitForTimeout(1_000);

    const filled = await tryFill(
      page,
      ['role=textbox[name=/email/i]', 'input[type="email"]', 'input[name*="email" i]'],
      fx.email(),
    );

    if (!filled) {
      console.warn('  contacts: could not find the email field — UI has changed');
      return;
    }

    await tryClick(page, ['role=button[name=/save|create|add/i]', 'button[type="submit"]']);
    await page.waitForTimeout(2_000);

    // Lists: create one, which is the other half of "add a contact to a list".
    await page.goto('https://app.brevo.com/contact/list', { waitUntil: 'networkidle' });

    const listOpened = await tryClick(page, [
      'role=button[name=/create a list|new list|add a list/i]',
      'text=/create a list/i',
    ]);

    if (listOpened) {
      await tryFill(
        page,
        ['role=textbox[name=/name/i]', 'input[name*="name" i]'],
        fx.listName(),
      );
      await tryClick(page, ['role=button[name=/save|create/i]', 'button[type="submit"]']);
      await page.waitForTimeout(2_000);
    }
  },
};
