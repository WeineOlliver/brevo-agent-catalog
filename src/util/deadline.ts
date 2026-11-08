/**
 * A hard time budget for work that can hang.
 *
 * Playwright's own timeouts cover clicks and navigation but not `page.evaluate`.
 * Measured: an exploration run clicked "Criar modelo" on `/templates/listing`,
 * which opens Brevo's drag-and-drop template editor, and the control
 * enumeration inside it never returned. The run sat wedged for 97 minutes and
 * reported nothing — worse than failing, because it looked like progress.
 *
 * So exploration of a route runs under a deadline. Losing one route's controls
 * is a known cost; losing the run to a page that never settles is not.
 *
 * Swallowing the work's own error is part of that contract, but swallowing it
 * *silently* cost two extraction runs: the Groq adapter raised
 * "failed with HTTP 429, retry after 60s", this returned the fallback, and the
 * caller could only report "no draft within 150s, or the provider failed" — one
 * message for a rate limit, a dead key and a malformed response alike. So the
 * caller is now told what was swallowed, and decides what to do with it.
 */
export async function withDeadline<T>(
  work: Promise<T>,
  ms: number,
  fallback: T,
  onTimeout?: () => void,
  onError?: (error: unknown) => void,
): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;

  const expiry = new Promise<{ timedOut: true }>((resolve) => {
    timer = setTimeout(() => resolve({ timedOut: true }), ms);
  });

  try {
    const outcome = await Promise.race([
      work.then((value) => ({ timedOut: false as const, value })),
      expiry,
    ]);

    if (outcome.timedOut) {
      onTimeout?.();
      return fallback;
    }
    return outcome.value;
  } catch (error) {
    // A route that throws is a route we move past, not a run we end — but the
    // reason it threw is the most useful thing the run can report.
    onError?.(error);
    return fallback;
  } finally {
    clearTimeout(timer);
  }
}
