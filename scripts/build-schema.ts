/**
 * Regenerates schema/action.schema.json from the Zod contract in src/types.ts.
 *
 * Run after any change to ActionSchema; tests/schema-sync.test.ts fails if the
 * committed file and the Zod source have drifted.
 */

import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { generateJsonSchema } from '../src/types.js';

const OUT = 'schema/action.schema.json';

mkdirSync(dirname(OUT), { recursive: true });
writeFileSync(OUT, `${JSON.stringify(generateJsonSchema(), null, 2)}\n`, 'utf8');

console.log(`wrote ${OUT}`);
