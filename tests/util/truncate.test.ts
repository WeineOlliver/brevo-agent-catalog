import { describe, expect, it } from 'vitest';
import { truncateBody } from '../../src/util/truncate.js';

describe('truncateBody', () => {
  it('marks truncated when the body exceeds maxBytes', () => {
    expect(truncateBody('x'.repeat(100), 10)).toEqual({ text: 'x'.repeat(10), truncated: true });
  });

  it('passes a null body through untouched', () => {
    expect(truncateBody(null, 10)).toEqual({ text: null, truncated: false });
  });

  it('leaves a body shorter than the limit alone', () => {
    expect(truncateBody('short', 10)).toEqual({ text: 'short', truncated: false });
  });

  it('does not mark a body of exactly maxBytes as truncated', () => {
    expect(truncateBody('x'.repeat(10), 10)).toEqual({ text: 'x'.repeat(10), truncated: false });
  });

  it('treats an empty body as present and untruncated', () => {
    expect(truncateBody('', 10)).toEqual({ text: '', truncated: false });
  });
});
