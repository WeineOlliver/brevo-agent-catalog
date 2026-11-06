import { describe, expect, it } from 'vitest';
import { extractJsonObject } from '../../src/providers/json.js';

describe('extractJsonObject', () => {
  it('parses a bare JSON object', () => {
    expect(extractJsonObject('{"a":1}')).toEqual({ ok: true, value: { a: 1 } });
  });

  it('extracts JSON from a markdown fence', () => {
    expect(extractJsonObject('Sure!\n```json\n{"a":1}\n```\n')).toEqual({
      ok: true,
      value: { a: 1 },
    });
  });

  it('extracts JSON from an unlabelled fence', () => {
    expect(extractJsonObject('```\n{"a":1}\n```')).toEqual({ ok: true, value: { a: 1 } });
  });

  it('extracts JSON surrounded by prose', () => {
    expect(extractJsonObject('Here you go: {"a":1} — hope that helps')).toEqual({
      ok: true,
      value: { a: 1 },
    });
  });

  it('reports a reason instead of throwing on prose with no JSON', () => {
    const result = extractJsonObject('I cannot help with that.');
    expect(result.ok).toBe(false);
    expect(() => extractJsonObject('I cannot help with that.')).not.toThrow();
  });

  it('gives a reason naming the problem when there is no JSON', () => {
    const result = extractJsonObject('nope');
    expect(result.ok === false && result.reason).toMatch(/no json/i);
  });

  it('picks the outermost object when braces nest', () => {
    expect(extractJsonObject('{"a":{"b":2}}')).toEqual({ ok: true, value: { a: { b: 2 } } });
  });

  it('reports a reason for a truncated object rather than throwing', () => {
    const result = extractJsonObject('{"a":1,"b":');
    expect(result.ok).toBe(false);
    expect(() => extractJsonObject('{"a":1,"b":')).not.toThrow();
  });

  it('handles an object containing a brace inside a string', () => {
    expect(extractJsonObject('{"a":"}"}')).toEqual({ ok: true, value: { a: '}' } });
  });

  it('does not throw on an empty string', () => {
    expect(extractJsonObject('').ok).toBe(false);
  });

  it('reports truncation, not "no JSON", when an object starts but never closes', () => {
    // The likeliest real failure: the model hit its token ceiling mid-object.
    // Telling it "no JSON object found" sends the repair loop after the wrong
    // problem.
    const result = extractJsonObject('{"id":"contacts.create_contact","inputs":{"type":"obj');
    expect(result.ok).toBe(false);
    expect(result.ok === false && result.reason).toMatch(/truncat/i);
  });

  it('still says no JSON when there is genuinely no brace at all', () => {
    const result = extractJsonObject('I cannot help with that.');
    expect(result.ok === false && result.reason).toMatch(/no json/i);
  });
});
