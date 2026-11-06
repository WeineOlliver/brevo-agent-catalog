/**
 * Network recorder.
 *
 * Reading a response body is asynchronous, so the handler cannot finish its
 * work inside the event callback. Records are therefore collected through
 * pending promises and `drain()` awaits them — which is why this returns a
 * recorder rather than the bare array the plan sketched.
 *
 * Typed against the narrowest slice of Playwright's surface it needs, so it is
 * exercised with a fake page instead of a browser.
 */

import { MAX_BODY_BYTES, type CaptureRecord } from '../capture/types.js';
import { captureId } from '../capture/har.js';
import { truncateBody } from '../util/truncate.js';

export type RequestLike = {
  method(): string;
  url(): string;
  resourceType(): string;
  headers(): Record<string, string>;
  postData(): string | null;
};

export type ResponseLike = {
  request(): RequestLike;
  status(): number;
  headers(): Record<string, string>;
  text(): Promise<string>;
};

export type PageLike = {
  on(event: 'response', handler: (response: ResponseLike) => void): void;
};

export type CaptureRecorder = {
  /** Records settled so far. Use `drain()` to be sure every body has been read. */
  records: CaptureRecord[];
  drain(): Promise<CaptureRecord[]>;
};

/** Only application traffic is of interest; assets and documents are noise. */
const RECORDED_RESOURCE_TYPES = new Set(['xhr', 'fetch']);

function lowercaseKeys(headers: Record<string, string>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [name, value] of Object.entries(headers)) out[name.toLowerCase()] = value;
  return out;
}

export function attachRecorder(page: PageLike, getRoute: () => string): CaptureRecorder {
  const records: CaptureRecord[] = [];
  const pending: Promise<void>[] = [];

  page.on('response', (response) => {
    const request = response.request();
    if (!RECORDED_RESOURCE_TYPES.has(request.resourceType())) return;

    // Captured before awaiting, so the record reflects the page we were on.
    const route = getRoute();
    const method = request.method().toUpperCase();
    const url = request.url();

    pending.push(
      (async () => {
        // Redirects, aborted requests and binary payloads all fail this read.
        const raw = await response.text().catch(() => null);
        const body = truncateBody(raw, MAX_BODY_BYTES);
        const requestBody = truncateBody(request.postData(), MAX_BODY_BYTES);

        records.push({
          id: captureId(method, url),
          source: 'playwright',
          route,
          method,
          url,
          status: response.status(),
          requestHeaders: lowercaseKeys(request.headers()),
          responseHeaders: lowercaseKeys(response.headers()),
          requestBody: requestBody.text,
          responseBody: body.text,
          truncated: body.truncated || requestBody.truncated,
          capturedAt: new Date().toISOString(),
        });
      })(),
    );
  });

  return {
    records,
    async drain(): Promise<CaptureRecord[]> {
      await Promise.all(pending);
      return records;
    },
  };
}
