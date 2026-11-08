import { describe, expect, it } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { AREAS, ACTION_AREA, MODULE_AREA, areaOf, unmappedModules } from '../../src/catalog/areas.js';

const dir = 'actions';
const files = readdirSync(dir).filter((f) => f.endsWith('.json') && f !== 'index.json');
const actions = files.map(
  (file) => JSON.parse(readFileSync(join(dir, file), 'utf8')) as { id: string; module: string },
);

describe('areas', () => {
  it('assigns every action in the catalog to an area', () => {
    // The whole claim of the grouping. One orphan and "nine boxes" is a lie.
    const orphans = actions.filter((action) => areaOf(action) === null).map((a) => a.id);
    expect(orphans).toEqual([]);
  });

  it('has an area for every module the catalog uses', () => {
    expect(unmappedModules(actions.map((action) => action.module))).toEqual([]);
  });

  it('maps every module to a declared area id', () => {
    // A typo in MODULE_AREA would otherwise produce an area that exists in no
    // listing, and an agent filtering by it would get nothing with no error.
    const declared = new Set(AREAS.map((area) => area.id));
    for (const [module, area] of Object.entries(MODULE_AREA)) {
      expect(declared.has(area), `${module} -> ${area}`).toBe(true);
    }
    for (const [id, area] of Object.entries(ACTION_AREA)) {
      expect(declared.has(area), `${id} -> ${area}`).toBe(true);
    }
  });

  it('lets a per-action override beat its module', () => {
    // `editor` is genuinely split: a user edits a newsletter, and the editor
    // fetches its own font list.
    expect(areaOf({ id: 'editor.list_fonts', module: 'editor' })).toBe('platform');
    expect(areaOf({ id: 'editor.get_template', module: 'editor' })).toBe('campaigns');
  });

  it('returns null for an unknown module rather than guessing', () => {
    expect(areaOf({ id: 'brandnew.do_thing', module: 'brandnew' })).toBeNull();
  });

  it('overrides only actions that exist', () => {
    const ids = new Set(actions.map((action) => action.id));
    for (const id of Object.keys(ACTION_AREA)) {
      expect(ids.has(id), `${id} is overridden but not in the catalog`).toBe(true);
    }
  });

  it('keeps every area non-empty, so no box is decoration', () => {
    const counts = new Map<string, number>();
    for (const action of actions) {
      const area = areaOf(action);
      if (area !== null) counts.set(area, (counts.get(area) ?? 0) + 1);
    }
    for (const area of AREAS) {
      expect(counts.get(area.id) ?? 0, `area "${area.id}" is empty`).toBeGreaterThan(0);
    }
  });

  it('describes each area in a way that says what a person does there', () => {
    for (const area of AREAS) {
      // "CRM" is three characters and is the right name for it.
      expect(area.name.length).toBeGreaterThanOrEqual(3);
      expect(area.does.length).toBeGreaterThan(20);
    }
  });
});
