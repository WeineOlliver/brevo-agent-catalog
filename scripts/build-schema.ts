/**
 * Regenerates the published JSON Schema documents from the Zod contracts.
 *
 * schema/action.schema.json comes from ActionSchema in src/types.ts, and
 * schema/flow.schema.json from FlowIndexSchema in src/flows/schema.ts. Run
 * after changing either; tests/schema-sync.test.ts fails if a committed file
 * and its Zod source have drifted.
 */

import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { generateJsonSchema } from '../src/types.js';
import { generateFlowJsonSchema } from '../src/flows/schema.js';

const OUTPUTS: [string, Record<string, unknown>][] = [
  ['schema/action.schema.json', generateJsonSchema()],
  ['schema/flow.schema.json', generateFlowJsonSchema()],
];

for (const [path, document] of OUTPUTS) {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${JSON.stringify(document, null, 2)}\n`, 'utf8');
  console.log(`wrote ${path}`);
}
