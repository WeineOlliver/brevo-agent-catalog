import { describe, expect, it } from 'vitest';
import { createProgress, etaMs, formatDuration, renderBar } from '../../src/util/progress.js';

describe('formatDuration', () => {
  it('shows seconds under a minute', () => {
    expect(formatDuration(0)).toBe('0s');
    expect(formatDuration(9_400)).toBe('9s');
  });

  it('shows minutes and seconds under an hour', () => {
    expect(formatDuration(74_000)).toBe('1m14s');
    expect(formatDuration(600_000)).toBe('10m0s');
  });

  it('shows hours and minutes beyond an hour', () => {
    expect(formatDuration(3_600_000)).toBe('1h0m');
    expect(formatDuration(5_430_000)).toBe('1h30m');
  });
});

describe('etaMs', () => {
  it('is null before anything has finished, since the rate is unknown', () => {
    expect(etaMs(0, 100, 5_000)).toBeNull();
  });

  it('extrapolates from the rate so far', () => {
    // 10 of 100 in 10s => 1s each => 90s left.
    expect(etaMs(10, 100, 10_000)).toBe(90_000);
  });

  it('is zero once everything is done', () => {
    expect(etaMs(100, 100, 50_000)).toBe(0);
  });

  it('never goes negative when more arrived than expected', () => {
    expect(etaMs(120, 100, 10_000)).toBe(0);
  });
});

describe('renderBar', () => {
  it('draws an empty bar at the start and a full one at the end', () => {
    expect(renderBar({ done: 0, total: 10, elapsedMs: 0 }, 10)).toContain('░░░░░░░░░░');
    expect(renderBar({ done: 10, total: 10, elapsedMs: 1000 }, 10)).toContain('██████████');
  });

  it('fills in proportion to the work done', () => {
    const bar = renderBar({ done: 5, total: 10, elapsedMs: 1000 }, 10);
    expect(bar).toContain('█████░░░░░');
  });

  it('shows the count and the percentage', () => {
    const bar = renderBar({ done: 42, total: 118, elapsedMs: 1000 }, 10);
    expect(bar).toContain('42/118');
    expect(bar).toContain('36%');
  });

  it('shows elapsed time, and an eta once it can be computed', () => {
    expect(renderBar({ done: 10, total: 100, elapsedMs: 10_000 }, 10)).toContain('1m30s left');
    expect(renderBar({ done: 0, total: 100, elapsedMs: 10_000 }, 10)).not.toContain('left');
  });

  it('includes a label, trimmed so the bar stays on one line', () => {
    const bar = renderBar(
      { done: 1, total: 10, elapsedMs: 100, label: 'POST contacts-api-v2.brevo.com/lists/list-count-sync/and/more' },
      10,
    );
    expect(bar.length).toBeLessThanOrEqual(110);
    expect(bar).toContain('POST contacts-api');
  });

  it('never divides by zero when there is nothing to do', () => {
    expect(() => renderBar({ done: 0, total: 0, elapsedMs: 0 }, 10)).not.toThrow();
    expect(renderBar({ done: 0, total: 0, elapsedMs: 0 }, 10)).toContain('0/0');
  });
});

describe('createProgress', () => {
  function fakeStream(isTTY: boolean) {
    const chunks: string[] = [];
    return { chunks, stream: { write: (c: string) => void chunks.push(c), isTTY } };
  }

  it('redraws in place on a terminal', () => {
    const { chunks, stream } = fakeStream(true);
    const p = createProgress(3, { stream, now: () => 0 });
    p.tick('a');
    p.tick('b');
    expect(chunks).toHaveLength(2);
    expect(chunks.every((c) => c.startsWith('\r'))).toBe(true);
  });

  it('prints milestone lines without carriage returns off a terminal', () => {
    const { chunks, stream } = fakeStream(false);
    const p = createProgress(10, { stream, now: () => 0, milestoneEvery: 5 });
    for (let i = 0; i < 10; i += 1) p.tick();
    // At 5 and at 10 only — a log file should not get ten lines of bar.
    expect(chunks).toHaveLength(2);
    expect(chunks.every((c) => !c.includes('\r'))).toBe(true);
    expect(chunks.every((c) => c.endsWith('\n'))).toBe(true);
  });

  it('always prints the final tick off a terminal, even off the milestone', () => {
    const { chunks, stream } = fakeStream(false);
    const p = createProgress(7, { stream, now: () => 0, milestoneEvery: 5 });
    for (let i = 0; i < 7; i += 1) p.tick();
    expect(chunks.some((c) => c.includes('7/7'))).toBe(true);
  });

  it('clears the bar on finish so the summary is not drawn over it', () => {
    const { chunks, stream } = fakeStream(true);
    const p = createProgress(1, { stream, now: () => 0 });
    p.tick();
    p.finish('done');
    expect(chunks.at(-2)).toContain('\u001b[2K');
    expect(chunks.at(-1)).toBe('done\n');
  });

  it('advances the clock into the eta', () => {
    const { chunks, stream } = fakeStream(true);
    let t = 0;
    const p = createProgress(10, { stream, now: () => t });
    t = 1000;
    p.tick();
    expect(chunks[0]).toContain('9s left');
  });
});

describe('renderBar at completion', () => {
  it('drops the eta once there is nothing left, rather than saying "0s left"', () => {
    const bar = renderBar({ done: 126, total: 126, elapsedMs: 176_000 }, 10);
    expect(bar).not.toContain('left');
    expect(bar).toContain('2m56s');
  });
});
