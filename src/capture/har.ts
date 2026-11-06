/**
 * HAR importer — the fallback capture source.
 *
 * If Brevo blocks the automated crawl (2FA, captcha, bot detection), a HAR
 * exported by hand from DevTools while browsing feeds the identical pipeline.
 */

import { createHash } from 'node:crypto';
import { MAX_BODY_BYTES, type CaptureRecord } from './types.js';
import { truncateBody } from '../util/truncate.js';

type HarHeader = { name?: unknown; value?: unknown };

type HarEntry = {
  startedDateTime?: unknown;
  request?: {
    method?: unknown;
    url?: unknown;
    headers?: unknown;
    postData?: { text?: unknown } | undefined;
  };
  response?: {
    status?: unknown;
    headers?: unknown;
    content?: { text?: unknown; size?: unknown } | undefined;
  };
};

/** Stable, filename-safe identifier for a captured request. */
export function captureId(method: string, url: string): string {
  return createHash('sha256').update(`${method.toUpperCase()} ${url}`).digest('hex').slice(0, 16);
}

function toHeaderMap(headers: unknown): Record<string, string> {
  if (!Array.isArray(headers)) return {};
  const map: Record<string, string> = {};
  for (const header of headers as HarHeader[]) {
    if (typeof header?.name !== 'string') continue;
    map[header.name.toLowerCase()] = typeof header.value === 'string' ? header.value : '';
  }
  return map;
}

function pathnameOf(url: string): string {
  try {
    return new URL(url).pathname;
  } catch {
    return url;
  }
}

export function parseHar(harJson: string, route?: string): CaptureRecord[] {
  const parsed = JSON.parse(harJson) as { log?: { entries?: unknown } };
  const entries = parsed?.log?.entries;

  if (!Array.isArray(entries)) {
    throw new Error('Not a HAR document: expected log.entries to be an array.');
  }

  return (entries as HarEntry[]).map((entry) => {
    const method = typeof entry.request?.method === 'string' ? entry.request.method : 'GET';
    const url = typeof entry.request?.url === 'string' ? entry.request.url : '';

    const rawRequestBody =
      typeof entry.request?.postData?.text === 'string' ? entry.request.postData.text : null;
    const rawResponseBody =
      typeof entry.response?.content?.text === 'string' ? entry.response.content.text : null;

    const request = truncateBody(rawRequestBody, MAX_BODY_BYTES);
    const response = truncateBody(rawResponseBody, MAX_BODY_BYTES);

    // A HAR records the full body size even when the exported text is clipped,
    // so a declared size larger than the text we hold means it was cut.
    const declaredSize = entry.response?.content?.size;
    const declaredTruncation =
      typeof declaredSize === 'number' &&
      rawResponseBody !== null &&
      declaredSize > Buffer.byteLength(rawResponseBody, 'utf8');

    return {
      id: captureId(method, url),
      source: 'har',
      route: route ?? pathnameOf(url),
      method: method.toUpperCase(),
      url,
      status: typeof entry.response?.status === 'number' ? entry.response.status : 0,
      requestHeaders: toHeaderMap(entry.request?.headers),
      responseHeaders: toHeaderMap(entry.response?.headers),
      requestBody: request.text,
      responseBody: response.text,
      truncated: request.truncated || response.truncated || declaredTruncation,
      capturedAt:
        typeof entry.startedDateTime === 'string'
          ? entry.startedDateTime
          : new Date(0).toISOString(),
    };
  });
}
