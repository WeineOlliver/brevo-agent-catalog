/**
 * Stage 2 — breadth-first crawl of the authenticated application.
 *
 * Navigation only. Nothing is clicked, so no state is changed here; the
 * sanctioned write actions live in `scripts/interact.ts`.
 *
 * Capped at one request per second against someone else's production service.
 */

import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { chromium } from 'playwright';
import 'dotenv/config';
import { loadConfig } from '../src/config.js';
import { writeCaptureFile } from '../src/capture/store.js';
import { attachRecorder } from '../src/crawl/recorder.js';
import { extractNavLinks, isSignInUrl, normalizeRoute } from '../src/crawl/links.js';
import { waitForSignIn } from '../src/crawl/session.js';
import { createLimiter } from '../src/util/rate-limit.js';
import {
  HEADED_VIEWPORT,
  describePlacement,
} from '../src/browser/window.js';
import { appContextOptions, appLaunchArgs } from '../src/browser/context.js';

function argValue(name: string, fallback: string): string {
  const index = process.argv.indexOf(`--${name}`);
  return index === -1 ? fallback : (process.argv[index + 1] ?? fallback);
}

const config = loadConfig();
const maxRoutes = Number(argValue('max-routes', '60'));
const outDir = argValue('out', config.paths.raw);
const statePath = join(config.paths.auth, 'state.json');

/**
 * Brevo's session does not survive serialisation: `storageState` carries cookies
 * and localStorage but not `sessionStorage`, and a restored context lands back
 * on login.brevo.com. `--login` therefore signs in and crawls in ONE context,
 * which removes the restore step entirely.
 */
const liveLogin = process.argv.includes('--login');

if (!liveLogin && !existsSync(statePath)) {
  console.error(
    `No saved session at ${statePath}.\n` +
      'Use "pnpm crawl --login" to sign in and crawl in one browser session\n' +
      '(recommended — a restored session does not work against Brevo).',
  );
  process.exit(1);
}

const limiter = createLimiter(1000);
// Placement only matters for the headed path; a headless run has no window.
const launchArgs = liveLogin ? appLaunchArgs(HEADED_VIEWPORT) : [];
if (liveLogin) console.log(describePlacement(launchArgs));

const browser = await chromium.launch({ headless: !liveLogin, args: launchArgs });
const context = liveLogin
  ? await browser.newContext(appContextOptions({ viewport: HEADED_VIEWPORT }))
  : await browser.newContext(appContextOptions({ storageState: statePath }));
const page = await context.newPage();

if (liveLogin) {
  await page.goto(config.appOrigin, { waitUntil: 'domcontentloaded' });
  console.log(`
A browser window is open at ${config.appOrigin}.
Log in by hand. The crawl starts by itself in the same session the moment the
dashboard appears — nothing is saved to disk and nothing has to be restored.
`);

  const outcome = await waitForSignIn(page, context, {
    timeoutMs: 25 * 60 * 1000,
    pollIntervalMs: 2000,
  });

  if (outcome === 'timeout') {
    console.error('\nNo sign-in detected. Nothing crawled.');
    await browser.close();
    process.exit(1);
  }

  console.log(`signed in at ${page.url()} — crawling in this same session\n`);
  // Saved opportunistically for the interact/verify stages; the crawl does not
  // depend on it working.
  await context.storageState({ path: statePath }).catch(() => undefined);
}

let currentRoute = '/';
const recorder = attachRecorder(page, () => currentRoute);

const queue: string[] = [config.appOrigin];
const visited = new Set<string>();
const discovered = new Set<string>();
let written = 0;
let recordCursor = 0;
let sessionDead = false;

function slugify(route: string): string {
  const slug = route.replace(/[^a-zA-Z0-9]+/g, '-').replace(/^-+|-+$/g, '');
  return slug.length === 0 ? 'root' : slug;
}

while (queue.length > 0 && visited.size < maxRoutes) {
  const url = queue.shift();
  if (url === undefined) break;

  const route = normalizeRoute(url);
  if (visited.has(route)) continue;
  visited.add(route);
  currentRoute = route;

  let html = '';
  try {
    await limiter(async () => {
      await page.goto(url, { waitUntil: 'networkidle', timeout: 30_000 });
    });
    html = await page.content();
  } catch (error) {
    console.warn(`  ! ${route}: ${String(error).split('\n')[0]}`);
    continue;
  }

  // A redirect to a sign-in screen means the saved session has expired. Checked
  // on every route, the first included: without that, a dead session crawls one
  // login page and reports success.
  if (isSignInUrl(page.url())) {
    console.error(
      `\nRedirected to a sign-in page at ${page.url()}.\n` +
        (visited.size === 1
          ? 'The saved session is not valid — nothing was crawled.\n'
          : 'The saved session expired mid-crawl.\n') +
        'Run "pnpm brevo:login" again and crawl straight away (Brevo sessions are short-lived),\n' +
        'or export a HAR by hand and feed it through parseHar.',
    );
    sessionDead = true;
    break;
  }

  for (const link of extractNavLinks(html, config.appOrigin)) {
    discovered.add(normalizeRoute(link));
    if (!visited.has(normalizeRoute(link))) queue.push(link);
  }

  await recorder.drain();
  const fresh = recorder.records.slice(recordCursor);
  recordCursor = recorder.records.length;

  if (fresh.length > 0) {
    writeCaptureFile(join(outDir, `${slugify(route)}.json`), fresh);
    written += fresh.length;
  }

  console.log(
    `  ${String(visited.size).padStart(3)}/${maxRoutes} ${route} — ${fresh.length} request(s)`,
  );
}

await browser.close();

// The route inventory feeds docs/modules.md, where routes that produced no
// action are listed explicitly as the honest coverage boundary.
mkdirSync(config.paths.data, { recursive: true });
writeFileSync(
  join(config.paths.data, 'discovered-routes.json'),
  `${JSON.stringify({ visited: [...visited].sort(), discovered: [...discovered].sort() }, null, 2)}\n`,
  'utf8',
);

console.log(
  `\nvisited ${visited.size} route(s), discovered ${discovered.size}, recorded ${written} request(s) -> ${outDir}`,
);
if (queue.length > 0) {
  console.log(`${queue.length} url(s) left unvisited — raise --max-routes to go further.`);
}

// A dead session must not look like a successful short crawl.
if (sessionDead) process.exit(1);
