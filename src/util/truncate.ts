/**
 * Body truncation, applied at capture time.
 *
 * Captured bodies are kept as opaque strings and never parsed here, which is
 * what lets the rest of the pipeline survive bodies that are cut mid-JSON.
 */

export type TruncatedBody = { text: string | null; truncated: boolean };

export function truncateBody(body: string | null, maxBytes: number): TruncatedBody {
  if (body === null) return { text: null, truncated: false };

  const buffer = Buffer.from(body, 'utf8');
  if (buffer.byteLength <= maxBytes) return { text: body, truncated: false };

  return { text: buffer.subarray(0, maxBytes).toString('utf8'), truncated: true };
}
