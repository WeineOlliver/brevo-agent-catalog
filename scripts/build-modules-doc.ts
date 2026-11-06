/**
 * Writes docs/modules.md from the catalog index and the crawl's route inventory.
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import 'dotenv/config';
import { loadConfig } from '../src/config.js';
import { buildModulesDoc } from '../src/docs/modules.js';
import type { CatalogIndex } from '../src/catalog/index-build.js';

const config = loadConfig();
const indexPath = join(config.paths.actions, 'index.json');

if (!existsSync(indexPath)) {
  console.error(`No catalog index at ${indexPath}. Run "pnpm build:index" first.`);
  process.exit(1);
}

const index = JSON.parse(readFileSync(indexPath, 'utf8')) as CatalogIndex;

const routesPath = join(config.paths.data, 'discovered-routes.json');
const routes = existsSync(routesPath)
  ? ((JSON.parse(readFileSync(routesPath, 'utf8')) as { visited?: string[] }).visited ?? [])
  : [];

if (routes.length === 0) {
  console.warn(`No route inventory at ${routesPath} — the unmapped-routes section will be empty.`);
}

mkdirSync('docs', { recursive: true });
writeFileSync('docs/modules.md', buildModulesDoc(index, routes), 'utf8');

console.log(`wrote docs/modules.md (${index.count} action(s), ${routes.length} route(s))`);
