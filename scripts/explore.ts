/**
 * Stage 2c — exploration: click everything that is safe to click.
 *
 * The navigation crawl found 118 actions of which one was a write, and six
 * hand-written passes found nothing because every selector I guessed was wrong.
 * So this enumerates whatever controls each route actually has, reports their
 * labels, clicks the ones that are not destructive, fills any form that
 * appears, and submits it.
 *
 * Safety: `src/interact/controls.ts` classifies each label and a destructive one
 * is never clicked — no deletes, no sends to a real audience, no publishes, in
 * English or Portuguese. Everything created is named `catalog-test-*`. Nothing
 * here deletes.
 */

import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { chromium } from 'playwright';
import 'dotenv/config';
import { loadConfig } from '../src/config.js';
import { writeCaptureFile } from '../src/capture/store.js';
import { attachRecorder } from '../src/crawl/recorder.js';
import { waitForSignIn } from '../src/crawl/session.js';
import { createFixtureBag } from '../src/interact/types.js';
import { exploreRoute, type RouteExploration } from '../src/interact/explore.js';

function argValue(name: string, fallback: string): string {
  const index = process.argv.indexOf(`--${name}`);
  return index === -1 ? fallback : (process.argv[index + 1] ?? fallback);
}

const config = loadConfig();
const maxRoutes = Number(argValue('max-routes', '20'));
const outDir = join(config.paths.raw, 'explore');

const routesPath = join(config.paths.data, 'discovered-routes.json');
if (!existsSync(routesPath)) {
  console.error(`No route inventory at ${routesPath}. Run "pnpm crawl --login" first.`);
  process.exit(1);
}

const inventory = JSON.parse(readFileSync(routesPath, 'utf8')) as { visited?: string[] };
// Prefer the product routes over settings pages: that is where actions live.
const routes = (inventory.visited ?? [])
  .filter((r) => r !== '/' && !r.includes(':id'))
  .sort((a, b) => Number(a.includes('settings')) - Number(b.includes('settings')))
  .slice(0, maxRoutes);

if (routes.length === 0) {
  console.error('No routes to explore.');
  process.exit(1);
}

const browser = await chromium.launch({ headless: false });
const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
const page = await context.newPage();

await page.goto(config.appOrigin, { waitUntil: 'domcontentloaded' });
console.log(`
A browser window is open at ${config.appOrigin}.
Log in by hand, including the 2FA step. Exploration starts by itself afterwards.

It will click every control that is not destructive and submit the forms it
finds, creating records named "catalog-test-*". It never clicks delete, send,
publish or anything else it cannot undo. Nothing is deleted.
`);

const signedIn = await waitForSignIn(page, context, {
  timeoutMs: 25 * 60 * 1000,
  pollIntervalMs: 2000,
});

if (signedIn === 'timeout') {
  console.error('\nNo sign-in detected. Nothing done.');
  await browser.close();
  process.exit(1);
}

console.log(`signed in at ${page.url()} — exploring ${routes.length} route(s)\n`);

const settle = async (ms = 1500): Promise<void> => {
  await page.waitForTimeout(ms);
};

const recorder = attachRecorder(page, () => currentRoute);
const reports: RouteExploration[] = [];
let currentRoute = '/';
let cursor = 0;
let totalWrites = 0;
const fixtures: string[] = [];

function slugify(route: string): string {
  const slug = route.replace(/[^a-zA-Z0-9]+/g, '-').replace(/^-+|-+$/g, '');
  return slug.length === 0 ? 'root' : slug;
}

for (const route of routes) {
  currentRoute = route;
  const url = `${config.appOrigin}${route}`;
  const fx = createFixtureBag();

  try {
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 25_000 });
    await settle(2500);
  } catch {
    console.log(`  ! ${route} — could not load`);
    continue;
  }

  const report = await exploreRoute(page, url, route, fx, settle);
  reports.push(report);
  fixtures.push(...fx.created);

  await recorder.drain();
  const fresh = recorder.records.slice(cursor);
  cursor = recorder.records.length;
  const writes = fresh.filter((r) => !['GET', 'HEAD', 'OPTIONS'].includes(r.method));
  totalWrites += writes.length;

  if (fresh.length > 0) writeCaptureFile(join(outDir, `${slugify(route)}.json`), fresh);

  const clicked = report.controls.filter((c) => c.clicked).length;
  const skipped = report.controls.filter((c) => c.kind === 'destructive').length;
  console.log(
    `  ${route} — ${report.controls.length} control(s), clicked ${clicked}, ` +
      `skipped ${skipped} destructive, ${report.formsSubmitted} form(s) submitted, ` +
      `${fresh.length} request(s) / ${writes.length} write(s)`,
  );
  const labels = report.controls.map((c) => `${c.label} [${c.kind}]`).join(' | ');
  if (labels.length > 0) console.log(`      ${labels.slice(0, 400)}`);
}

await browser.close();

writeFileSync(
  join(config.paths.data, 'exploration-report.json'),
  `${JSON.stringify({ generated_at: new Date().toISOString(), reports }, null, 2)}\n`,
  'utf8',
);

console.log(
  `\nexplored ${reports.length} route(s), ${totalWrites} write request(s) captured -> ${outDir}`,
);
if (fixtures.length > 0) {
  console.log(`\nFixtures created (delete by hand):\n  ${[...new Set(fixtures)].join('\n  ')}`);
}
console.log('\nNext: pnpm sanitize && pnpm extract --provider groq && pnpm normalize');
