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

  it('records everything it generated for later cleanup', () => {
    const fx = createFixtureBag('abc');
    fx.email();
    fx.listName();
    expect(fx.created).toHaveLength(2);
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
