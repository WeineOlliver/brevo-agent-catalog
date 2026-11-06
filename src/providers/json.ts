/**
 * Getting a JSON object out of whatever a model actually returned.
 *
 * Models routinely wrap JSON in a markdown fence, preface it with a sentence,
 * or answer in prose. A parser that assumes raw JSON fails on a large share of
 * real responses, so this returns a *value* on failure rather than throwing —
 * the extraction repair loop needs the reason, not an exception.
 */

export type JsonExtraction =
  | { ok: true; value: unknown }
  | { ok: false; reason: string };

/** Finds the outermost {...} span, ignoring braces inside JSON strings. */
function outermostObjectSpan(text: string): { start: number; end: number } | null {
  const start = text.indexOf('{');
  if (start === -1) return null;

  let depth = 0;
  let inString = false;
  let escaped = false;

  for (let i = start; i < text.length; i += 1) {
    const char = text[i];

    if (escaped) {
      escaped = false;
      continue;
    }
    if (char === '\\') {
      escaped = true;
      continue;
    }
    if (char === '"') {
      inString = !inString;
      continue;
    }
    if (inString) continue;

    if (char === '{') depth += 1;
    else if (char === '}') {
      depth -= 1;
      if (depth === 0) return { start, end: i + 1 };
    }
  }

  return null;
}

export function extractJsonObject(raw: string): JsonExtraction {
  const text = raw.trim();
  if (text.length === 0) return { ok: false, reason: 'empty response' };

  const direct = tryParse(text);
  if (direct.ok) return direct;

  const fenced = /```(?:json)?\s*([\s\S]*?)```/i.exec(text);
  if (fenced?.[1]) {
    const parsed = tryParse(fenced[1].trim());
    if (parsed.ok) return parsed;
  }

  const span = outermostObjectSpan(text);
  if (span) {
    const parsed = tryParse(text.slice(span.start, span.end));
    if (parsed.ok) return parsed;
    return { ok: false, reason: 'found a JSON object but it did not parse' };
  }

  // An object that opens and never closes is the likeliest real failure: the
  // model hit its token ceiling. Saying "no JSON object found" sends the repair
  // loop after the wrong problem, so name the actual one.
  if (text.includes('{')) {
    return {
      ok: false,
      reason:
        'the response was truncated mid-object (it opens a JSON object but never closes it) — answer more briefly',
    };
  }

  return { ok: false, reason: 'no JSON object found in the response' };
}

function tryParse(candidate: string): JsonExtraction {
  try {
    const value = JSON.parse(candidate) as unknown;
    if (value === null || typeof value !== 'object' || Array.isArray(value)) {
      return { ok: false, reason: 'parsed value is not a JSON object' };
    }
    return { ok: true, value };
  } catch {
    return { ok: false, reason: 'candidate did not parse as JSON' };
  }
}
