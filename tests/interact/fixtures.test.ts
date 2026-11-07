import { describe, expect, it } from 'vitest';
import { FIXTURE_PREFIX, createFixtureBag } from '../../src/interact/types.js';

describe('createFixtureBag', () => {
  it('namespaces every generated fixture so it is identifiable as ours', () => {
    const fx = createFixtureBag('abc');
    expect(fx.email()).toMatch(/^catalog-test-/);
    expect(fx.listName()).toMatch(/^catalog-test-/);
  });

  it('generates a distinct value on each call', () => {
    const fx = createFixtureBag('abc');
    expect(fx.email()).not.toBe(fx.email());
  });

  it('records every name it handed out, for cleanup', () => {
    const fx = createFixtureBag('abc');
    fx.email();
    fx.listName();
    expect(fx.names).toHaveLength(2);
  });

  it('records a name when it is handed out, not when a record is created', () => {
    // The bag cannot observe Brevo, so `names` is "used", never "created".
    // A run that reported sixteen created lists while no list-creation request
    // existed is why this distinction is now tested rather than assumed.
    const fx = createFixtureBag('abc');
    const name = fx.listName();
    expect(fx.names).toEqual([name]);
  });

  it('produces a syntactically valid email address', () => {
    expect(createFixtureBag('abc').email()).toMatch(/^[^@\s]+@[^@\s]+\.[a-z]{2,}$/);
  });

  it('keeps two bags from colliding', () => {
    expect(createFixtureBag('aaa').email()).not.toBe(createFixtureBag('bbb').email());
  });

  it('exports the prefix, so cleanup can never guess it wrong', () => {
    expect(FIXTURE_PREFIX).toBe('catalog-test-');
    expect(createFixtureBag('abc').listName().startsWith(FIXTURE_PREFIX)).toBe(true);
  });
});
