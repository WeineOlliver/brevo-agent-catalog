/**
 * Best-effort UI driving.
 *
 * Brevo's markup is not ours and will drift, so every interaction prefers
 * accessible roles and names over CSS, tries several candidates, and returns
 * false rather than throwing. A pass that crashes on a renamed button loses the
 * whole run's captures; one that reports a miss loses only that step.
 */

import type { Page } from 'playwright';

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

export async function goto(page: Page, url: string): Promise<boolean> {
  try {
    await page.goto(url, { waitUntil: 'networkidle', timeout: 30_000 });
    return true;
  } catch {
    // Brevo's SPA keeps long-polling connections open, so networkidle times out
    // on some routes even though the page is usable.
    return false;
  }
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
