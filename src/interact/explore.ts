/**
 * Generic exploration.
 *
 * Guessing selectors per module failed on every pass. This instead enumerates
 * the controls a page actually has, reports their labels, and acts on them —
 * so discovery does not depend on me having predicted Brevo's wording, and the
 * run tells us what the UI really says.
 *
 * Safety is the label classifier in `controls.ts`: a destructive label is never
 * clicked. An unknown label *is* clicked, because that is where undiscovered
 * functionality lives.
 */

import type { Page } from 'playwright';
import type { FixtureBag } from './types.js';
import {
  classifyControl,
  isExplorable,
  valueForField,
  type ControlKind,
} from './controls.js';

export type ControlReport = { label: string; kind: ControlKind; clicked: boolean };

export type RouteExploration = {
  route: string;
  controls: ControlReport[];
  formsSubmitted: number;
};

/** Selector for anything a user could plausibly click. */
const CLICKABLE =
  'button, a[href], [role="button"], [role="tab"], [role="menuitem"], [data-testid*="button" i]';

const MAX_CONTROLS_PER_ROUTE = 14;
const MAX_FIELDS_PER_FORM = 10;

type RawControl = { label: string; index: number };

/** Reads every clickable control's visible label, in DOM order. */
async function readControls(page: Page): Promise<RawControl[]> {
  return page.evaluate((selector) => {
    const seen = new Set<string>();
    const out: { label: string; index: number }[] = [];
    const nodes = Array.from(document.querySelectorAll(selector));

    nodes.forEach((node, index) => {
      const element = node as HTMLElement;
      const style = window.getComputedStyle(element);
      if (style.display === 'none' || style.visibility === 'hidden') return;
      if (element.offsetParent === null && style.position !== 'fixed') return;

      const label = (
        element.getAttribute('aria-label') ??
        element.textContent ??
        element.getAttribute('title') ??
        ''
      )
        .replace(/\s+/g, ' ')
        .trim()
        .slice(0, 80);

      if (label.length === 0 || label.length > 60) return;
      if (seen.has(label)) return;
      seen.add(label);
      out.push({ label, index });
    });

    return out;
  }, CLICKABLE);
}

/** Fills whatever visible inputs are on screen with fixture values. */
async function fillVisibleForm(page: Page, fx: FixtureBag): Promise<number> {
  const fields = await page.evaluate(() => {
    const inputs = Array.from(
      document.querySelectorAll('input:not([type="hidden"]), textarea, select'),
    );
    return inputs
      .map((node, index) => {
        const el = node as HTMLInputElement;
        if (el.offsetParent === null) return null;
        if (el.disabled || el.readOnly) return null;
        const labelled = el.labels?.[0]?.textContent ?? '';
        return {
          index,
          tag: el.tagName.toLowerCase(),
          type: (el.getAttribute('type') ?? 'text').toLowerCase(),
          name: el.getAttribute('name') ?? '',
          placeholder: el.getAttribute('placeholder') ?? '',
          label: labelled.replace(/\s+/g, ' ').trim().slice(0, 60),
        };
      })
      .filter((f): f is NonNullable<typeof f> => f !== null);
  });

  let filled = 0;

  for (const field of fields.slice(0, MAX_FIELDS_PER_FORM)) {
    const value = valueForField(field, fx);
    if (value === null) continue;

    try {
      if (field.tag === 'select') {
        const locator = page.locator('select').nth(filled);
        await locator.selectOption({ index: 1 }, { timeout: 2000 });
      } else {
        const locator = page.locator('input:not([type="hidden"]), textarea').nth(field.index);
        await locator.fill(value, { timeout: 2000 });
      }
      filled += 1;
    } catch {
      continue;
    }
  }

  return filled;
}

/** Clicks the submit-looking control currently on screen, if any. */
async function submitVisibleForm(page: Page): Promise<boolean> {
  const controls = await readControls(page);
  const submit = controls.find((c) => classifyControl(c.label) === 'submit');
  if (submit === undefined) return false;

  try {
    await page.getByText(submit.label, { exact: true }).first().click({ timeout: 4000 });
    return true;
  } catch {
    return false;
  }
}

/**
 * Explores one route: enumerate controls, click each explorable one, and when a
 * form appears fill and submit it. Returns to the route between controls so one
 * click cannot strand the rest.
 */
export async function exploreRoute(
  page: Page,
  url: string,
  route: string,
  fx: FixtureBag,
  settle: (ms?: number) => Promise<void>,
): Promise<RouteExploration> {
  const report: RouteExploration = { route, controls: [], formsSubmitted: 0 };

  const controls = (await readControls(page)).slice(0, MAX_CONTROLS_PER_ROUTE);

  for (const control of controls) {
    const kind = classifyControl(control.label);
    const clickable = isExplorable(control.label) && kind !== 'navigate';

    report.controls.push({ label: control.label, kind, clicked: clickable });
    if (!clickable) continue;

    try {
      await page.getByText(control.label, { exact: true }).first().click({ timeout: 4000 });
      await settle(1200);

      const filled = await fillVisibleForm(page, fx);
      if (filled > 0) {
        // Submit once empty-ish first would need a reload; instead submit the
        // filled form and let the response carry the contract.
        if (await submitVisibleForm(page)) {
          report.formsSubmitted += 1;
          await settle(2000);
        }
      }
    } catch {
      // A control that cannot be clicked is not a failure worth stopping for.
    }

    try {
      await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 20_000 });
      await settle(800);
    } catch {
      break;
    }
  }

  return report;
}
