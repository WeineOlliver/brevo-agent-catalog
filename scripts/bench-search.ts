/**
 * `pnpm bench:search` - can the lexical search find the answer by itself?
 *
 * The selection eval measures a model reading all 197 entries. This measures
 * the other path: the same 19 tasks handed to `pnpm catalog search`, with no
 * model anywhere. It costs nothing to run, which is the point - it is a
 * property of the descriptions and the ranking, not of a provider.
 *
 * It scores badly, and that is the finding. The eval's first rule is that a
 * task never reuses the catalog's own wording, so "I need a new audience group"
 * has to reach `lists.create_list` without sharing a word with it. A model
 * bridges that; prefix matching cannot. Keeping the number here stops the CLI
 * being sold as a drop-in replacement for handing a model the index.
 */
import { readFileSync } from 'node:fs';
import { search, type CatalogIndexFile } from '../src/cli/query.js';

const index = JSON.parse(readFileSync('actions/index.json', 'utf8')) as CatalogIndexFile;
const tasks = (JSON.parse(readFileSync('data/eval-tasks.json', 'utf8')) as {
  tasks: { prompt: string; expectedActionId: string; acceptableActionIds?: string[] }[];
}).tasks;

const ids = new Set(index.actions.map((a) => a.id));
let top1 = 0, top3 = 0, top10 = 0, scoreable = 0;

for (const task of tasks) {
  const accepted = [task.expectedActionId, ...(task.acceptableActionIds ?? [])];
  if (!accepted.some((id) => ids.has(id))) continue;
  scoreable += 1;
  const hits = search(index, task.prompt, 10).map((h) => h.id);
  const at = hits.findIndex((id) => accepted.includes(id));
  if (at === 0) top1 += 1;
  if (at >= 0 && at < 3) top3 += 1;
  if (at >= 0) top10 += 1;
  const mark = at === 0 ? '1st' : at > 0 ? `#${at + 1}` : 'MISS';
  console.log(`${mark.padEnd(5)} ${task.expectedActionId.padEnd(38)} ${task.prompt.slice(0, 54)}`);
  if (at < 0) console.log(`      got: ${hits.slice(0, 3).join(', ') || '(nothing)'}`);
}

console.log(`\ntop-1 ${top1}/${scoreable}   top-3 ${top3}/${scoreable}   top-10 ${top10}/${scoreable}`);
