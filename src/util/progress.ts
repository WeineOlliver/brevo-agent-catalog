/**
 * A progress bar for the long stages.
 *
 * Extraction drafts one action per captured endpoint behind a rate limiter, so
 * it runs for minutes. It used to print a line per candidate — 126 lines that
 * say what happened but never how much is left. This shows the shape of the
 * run instead: how far along, how long it has taken, how long remains.
 *
 * It writes to stderr, so piping a script's stdout to a file still gets clean
 * output, and it redraws in place only on a terminal. Off a terminal (a log
 * file, CI, a background task) it prints a milestone line instead, because
 * carriage returns in a log file are unreadable.
 */

export type ProgressState = {
  done: number;
  total: number;
  elapsedMs: number;
  label?: string;
};

/** `9s`, `1m14s`, `1h30m` — a glanceable duration, never more than two units. */
export function formatDuration(ms: number): string {
  const seconds = Math.floor(Math.max(0, ms) / 1000);
  if (seconds < 60) return `${seconds}s`;

  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m${seconds % 60}s`;

  return `${Math.floor(minutes / 60)}h${minutes % 60}m`;
}

/** Time remaining at the rate observed so far, or null while that is unknown. */
export function etaMs(done: number, total: number, elapsedMs: number): number | null {
  if (done <= 0) return null;
  const remaining = total - done;
  if (remaining <= 0) return 0;
  return Math.round((elapsedMs / done) * remaining);
}

const MAX_LABEL = 34;

/** One line: the bar, the count, the percentage, elapsed, eta and a label. */
export function renderBar(state: ProgressState, width = 24): string {
  const { done, total, elapsedMs } = state;
  const fraction = total <= 0 ? 0 : Math.min(1, Math.max(0, done / total));
  const filled = Math.round(fraction * width);

  const bar = '█'.repeat(filled) + '░'.repeat(Math.max(0, width - filled));
  const percent = `${Math.round(fraction * 100)}%`.padStart(4);

  // No eta before the first item finishes (the rate is unknown) and none after
  // the last one (there is nothing left) — "0s left" on a finished run is noise.
  const remaining = etaMs(done, total, elapsedMs);
  const timing =
    remaining === null || remaining === 0
      ? formatDuration(elapsedMs)
      : `${formatDuration(elapsedMs)} / ${formatDuration(remaining)} left`;

  const label =
    state.label === undefined
      ? ''
      : `  ${state.label.length > MAX_LABEL ? `${state.label.slice(0, MAX_LABEL - 1)}…` : state.label}`;

  return `[${bar}] ${done}/${total} ${percent}  ${timing}${label}`;
}

export type Progress = {
  /** Advances by one and redraws. */
  tick(label?: string): void;
  /** Clears the bar and leaves the cursor on a fresh line. */
  finish(summary?: string): void;
};

export type ProgressOptions = {
  stream?: { write(chunk: string): unknown; isTTY?: boolean };
  now?: () => number;
  /** Off a terminal, print a line every this many items. */
  milestoneEvery?: number;
};

/** A live bar on a terminal; periodic lines anywhere else. */
export function createProgress(total: number, options: ProgressOptions = {}): Progress {
  const stream = options.stream ?? process.stderr;
  const now = options.now ?? (() => Date.now());
  const startedAt = now();
  const interactive = stream.isTTY === true;
  const milestoneEvery = options.milestoneEvery ?? Math.max(1, Math.ceil(total / 10));

  let done = 0;

  return {
    tick(label?: string) {
      done += 1;
      const line = renderBar({ done, total, elapsedMs: now() - startedAt, label });

      if (interactive) {
        stream.write(`\r\u001b[2K${line}`);
        return;
      }
      if (done === total || done % milestoneEvery === 0) stream.write(`${line}\n`);
    },

    finish(summary?: string) {
      if (interactive) stream.write('\r\u001b[2K');
      if (summary !== undefined) stream.write(`${summary}\n`);
    },
  };
}
