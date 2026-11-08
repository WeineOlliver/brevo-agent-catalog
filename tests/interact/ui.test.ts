/**
 * The whole-label matcher.
 *
 * The original was written as a template literal, where the intended escape
 * collapsed to a literal character and the pattern became `^s*create lists*$`.
 * It matched the exact label by luck and lost the whitespace tolerance it was
 * written for, which is the kind of bug a passing run hides.
 */

import { describe, expect, it } from 'vitest';
import { exactLabel } from '../../src/interact/ui.js';

describe('exactLabel', () => {
  it('tolerates whitespace around the label', () => {
    // The point of the helper, and exactly what the broken version lost.
    expect(exactLabel('create list').test(' create list ')).toBe(true);
    expect(exactLabel('create list').test('create list')).toBe(true);
  });

  it('ignores case, because recipes name buttons in lower case', () => {
    expect(exactLabel('create list').test('Create list')).toBe(true);
    expect(exactLabel('create list').test('CREATE LIST')).toBe(true);
  });

  it('matches the whole label, not a prefix', () => {
    // Brevo's trigger reads "Create a list" and the dialog's submit reads
    // "Create list". A prefix match clicks the trigger and reopens the form.
    expect(exactLabel('create list').test('create a list')).toBe(false);
    expect(exactLabel('create').test('create a contact')).toBe(false);
    expect(exactLabel('create list').test('create list now')).toBe(false);
  });

  it('treats the label as text rather than as a pattern', () => {
    // An unescaped "(" here is a syntax error, not a loose match.
    expect(() => exactLabel('Create (new)')).not.toThrow();
    expect(exactLabel('Create (new)').test('Create (new)')).toBe(true);
    expect(exactLabel('Create (new)').test('Create new')).toBe(false);
  });

  it('does not let a dot in a label match any character', () => {
    expect(exactLabel('save.').test('savex')).toBe(false);
    expect(exactLabel('save.').test('save.')).toBe(true);
  });
});
