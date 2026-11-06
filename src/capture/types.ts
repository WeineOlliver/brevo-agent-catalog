/**
 * The capture abstraction.
 *
 * Captures reach the pipeline from more than one place: the authenticated
 * Playwright crawl, and a hand-exported DevTools HAR when the crawl is blocked.
 * Everything downstream consumes this shape and nothing else, so the crawler is
 * never a single point of failure for the catalog.
 *
 * Bodies are opaque strings. They are routinely truncated mid-JSON, sometimes
 * HTML, occasionally binary — so nothing at this layer parses them.
 */

export type CaptureSource = 'playwright' | 'har';

export type CaptureRecord = {
  /** Stable hash of method and url; also the capture's filename stem. */
  id: string;
  source: CaptureSource;
  /** The application route this capture was observed on. */
  route: string;
  method: string;
  url: string;
  status: number;
  requestHeaders: Record<string, string>;
  responseHeaders: Record<string, string>;
  requestBody: string | null;
  responseBody: string | null;
  truncated: boolean;
  capturedAt: string;
  /**
   * The capture file this record was read from, relative to the repo root.
   * Set by `readCaptureFile`, not by the recorders — it is provenance, and it
   * is what `verification.evidence` cites so a reviewer can open the proof.
   */
  sourceFile?: string;
};

/** Bodies larger than this are cut at capture time. */
export const MAX_BODY_BYTES = 8192;
