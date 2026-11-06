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
 */
export async function withDeadline<T>(
  work: Promise<T>,
  ms: number,
  fallback: T,
  onTimeout?: () => void,
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
  } catch {
    // A route that throws is a route we move past, not a run we end.
    return fallback;
  } finally {
    clearTimeout(timer);
  }
}
