/**
 * Stage 0 — download Brevo's public OpenAPI specification and index it.
 *
 * The spec is committed to `data/` so stages 4 onward run offline for anyone,
 * including a reviewer with no Brevo account.
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import 'dotenv/config';
import { loadConfig } from '../src/config.js';
import { buildPublicApiIndex } from '../src/openapi/index.js';

const config = loadConfig();
const specPath = join(config.paths.data, 'brevo-openapi.yml');
const indexPath = join(config.paths.data, 'public-api-index.json');

mkdirSync(config.paths.data, { recursive: true });

async function obtainSpec(): Promise<string> {
  try {
    const response = await fetch(config.openApiUrl);
    if (!response.ok) throw new Error(`HTTP ${response.status} ${response.statusText}`);
    const yaml = await response.text();
    writeFileSync(specPath, yaml, 'utf8');
    console.log(`downloaded ${config.openApiUrl} -> ${specPath}`);
    return yaml;
  } catch (error) {
    if (existsSync(specPath)) {
      console.warn(`download failed (${String(error)}); using the committed copy at ${specPath}`);
      return readFileSync(specPath, 'utf8');
    }
    throw error;
  }
}

const yaml = await obtainSpec();
const index = buildPublicApiIndex(yaml);
const pathCount = new Set(index.operations.map((o) => o.pathTemplate)).size;

writeFileSync(
  indexPath,
  `${JSON.stringify(
    {
      generated_at: new Date().toISOString(),
      source_url: config.openApiUrl,
      path_count: pathCount,
      operation_count: index.operations.length,
      with_operation_id: index.operations.filter((o) => o.operationId !== null).length,
      operations: index.operations,
    },
    null,
    2,
  )}\n`,
  'utf8',
);

console.log(
  `indexed ${index.operations.length} operations across ${pathCount} paths ` +
    `(${index.operations.filter((o) => o.operationId !== null).length} with an operationId) -> ${indexPath}`,
);

if (index.operations.length !== 292 || pathCount !== 208) {
  console.warn(
    `\nNOTE: the design recorded 292 operations across 208 paths. Brevo has changed its ` +
      `specification since — record the new figures in docs/NOTES.md rather than quietly accepting them.`,
  );
}
