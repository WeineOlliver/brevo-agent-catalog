/**
 * Best-effort UI driving.
 *
 * Brevo's markup is not ours and will drift, so every interaction prefers
 * accessible roles and names over CSS, tries several candidates, and returns
 * false rather than throwing. A pass that crashes on a renamed button loses the
 * whole run's captures; one that reports a miss loses only that step.
 */

import type { Locator, Page } from 'playwright';

const CANDIDATE_TIMEOUT_MS = 2500;
const ACTION_TIMEOUT_MS = 12_000;

export async function tryClick(page: Page, candidates: string[]): Promise<boolean> {
  for (const selector of candidates) {
    try {
      const locator = page.locator(selector).first();
      await locator.waitFor({ state: 'visible', timeout: CANDIDATE_TIMEOUT_MS });
      await locator.click({ timeout: ACTION_TIMEOUT_MS });
      return true;
    } catch {
      continue;
    }
  }
  return false;
}

export async function tryFill(
  page: Page,
  candidates: string[],
  value: string,
): Promise<boolean> {
  for (const selector of candidates) {
    try {
      const locator = page.locator(selector).first();
      await locator.waitFor({ state: 'visible', timeout: CANDIDATE_TIMEOUT_MS });
      await locator.fill(value, { timeout: ACTION_TIMEOUT_MS });
      return true;
    } catch {
      continue;
    }
  }
  return false;
}

/**
 * Navigates, and reports whether we ended up there.
 *
 * `networkidle` is the right wait for this app and the wrong failure signal.
 * Brevo keeps long-polling connections open and fires analytics beacons
 * continuously, so the wait times out on some routes while the page is
 * perfectly usable -- which the previous version of this function said in a
 * comment and then contradicted by returning false.
 *
 * That cost a wrong diagnosis. A verification recipe reported "could not open
 * the create-list dialog" when the dialog was fine and the navigation had
 * merely not settled; the selector it was blamed on resolves exactly one
 * element when probed by hand. So a timeout now asks the only question that
 * matters -- are we on the page we asked for -- and answers from the URL.
 */
export async function goto(page: Page, url: string): Promise<boolean> {
  try {
    await page.goto(url, { waitUntil: 'networkidle', timeout: 30_000 });
    return true;
  } catch {
    return onPath(page, url);
  }
}

/** Whether the page's current path is the one `url` asked for. */
function onPath(page: Page, url: string): boolean {
  try {
    return new URL(page.url()).pathname === new URL(url).pathname;
  } catch {
    return false;
  }
}

/** The dialog a create control opened, if any. */
export function openDialog(page: Page): Locator {
  return page.locator('[role="dialog"], [aria-modal="true"]').last();
}

/**
 * Submits the dialog that is currently open.
 *
 * Scoped to the dialog, and matching the whole label, because Brevo's page-level
 * trigger reads "Create a contact" while the dialog's submit reads "Create":
 * a loose `/^create/i` over the whole page finds the trigger first — it sits
 * earlier in the DOM — and reopens the form instead of saving it. Measured on
 * the selector reconnaissance run, where /contact/list offered six controls
 * matching the old pattern and only one of them saved anything.
 */
/**
 * A whole-label match, tolerating surrounding whitespace.
 *
 * Built with a RegExp string rather than a template literal on purpose. The
 * first version wrote `^\s*${name}\s*$` inside a template literal, where
 * `\s` is not a recognised escape and collapses to a literal "s" -- the
 * pattern became `^s*create lists*$`, which matches the exact label by luck
 * and fails the moment there is a space around it. The whitespace tolerance
 * the code appeared to have never existed.
 *
 * The label is escaped because it is a label, not a pattern: a button reading
 * "Create (new)" would otherwise be a syntax error.
 */
export function exactLabel(name: string): RegExp {
  const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp('^\\s*' + escaped + '\\s*$', 'i');
}

export async function submitDialog(
  page: Page,
  options: { testIds?: string[]; names: string[] },
): Promise<boolean> {
  // A `data-testid` survives both a locale change and a copy change, so it is
  // tried first where Brevo gives a specific one. Many of its buttons share a
  // generic `sib-button-testId`, which identifies nothing — those fall through
  // to the label.
  for (const testId of options.testIds ?? []) {
    try {
      const button = page.locator(`[data-testid="${testId}"]`).first();
      await button.waitFor({ state: 'visible', timeout: CANDIDATE_TIMEOUT_MS });
      await button.click({ timeout: ACTION_TIMEOUT_MS });
      return true;
    } catch {
      continue;
    }
  }

  // Dialog-scoped first, then page-level. Brevo renders at least one dialog's
  // footer outside its `[role=dialog]` node — the lists form submitted nothing
  // for exactly that reason — and the page-level attempt is safe because the
  // match is on the whole label: the trigger reads "Create a list" while the
  // submit reads "Create list".
  for (const scope of [openDialog(page), page]) {
    for (const name of options.names) {
      try {
        const button = scope.getByRole('button', { name: exactLabel(name) }).first();
        await button.waitFor({ state: 'visible', timeout: CANDIDATE_TIMEOUT_MS });
        await button.click({ timeout: ACTION_TIMEOUT_MS });
        return true;
      } catch {
        continue;
      }
    }
  }

  return false;
}

/** Common labels for the primary submit control on a Brevo form. */
export const SAVE_BUTTON = [
  'role=button[name=/^(save|create|add|confirm|apply|next)/i]',
  'button[type="submit"]',
  'role=button[name=/save/i]',
];

/** Waits for in-flight XHR to settle so the recorder captures the response. */
export async function settle(page: Page, ms = 2500): Promise<void> {
  await page.waitForTimeout(ms);
}
