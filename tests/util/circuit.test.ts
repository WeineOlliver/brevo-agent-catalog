import { describe, expect, it } from 'vitest';
import { createBreaker } from '../../src/util/circuit.js';

describe('createBreaker', () => {
  it('stays closed below the limit', () => {
    const breaker = createBreaker(3);
    expect(breaker.fail()).toBe(false);
    expect(breaker.fail()).toBe(false);
    expect(breaker.open).toBe(false);
  });

  it('opens on the nth consecutive failure', () => {
    const breaker = createBreaker(3);
    breaker.fail();
    breaker.fail();
    expect(breaker.fail()).toBe(true);
    expect(breaker.open).toBe(true);
  });

  it('counts consecutive failures, not total', () => {
    // A catalog of real traffic always holds a few candidates no model can
    // draft. Those must not end a run that is otherwise working.
    const breaker = createBreaker(3);
    breaker.fail();
    breaker.fail();
    breaker.succeed();
    expect(breaker.fail()).toBe(false);
    expect(breaker.consecutive).toBe(1);
    expect(breaker.open).toBe(false);
  });

  it('reports the streak so a run can say why it stopped', () => {
    const breaker = createBreaker(2);
    breaker.fail();
    expect(breaker.consecutive).toBe(1);
  });

  it('refuses a limit that would trip before anything happened', () => {
    expect(() => createBreaker(0)).toThrow(/positive integer/);
    expect(() => createBreaker(-1)).toThrow(/positive integer/);
    expect(() => createBreaker(1.5)).toThrow(/positive integer/);
  });

  it('allows a limit of one, which trips on the first failure', () => {
    const breaker = createBreaker(1);
    expect(breaker.fail()).toBe(true);
  });
});
