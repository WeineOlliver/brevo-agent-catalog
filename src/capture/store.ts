/**
 * Capture files on disk.
 *
 * A capture file is a JSON array of CaptureRecord. The crawler writes one per
 * route under `captures/raw/`; the sanitizer mirrors the tree into
 * `captures/clean/`, which is the committed, publishable copy.
 */

import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { dirname, join, posix, relative, sep } from 'node:path';
import type { CaptureRecord } from './types.js';

/** Every `.json` file under `dir`, as slash-separated paths relative to it. */
export function listCaptureFiles(dir: string): string[] {
  if (!existsSync(dir)) return [];

  const found: string[] = [];
  const walk = (current: string): void => {
    for (const entry of readdirSync(current, { withFileTypes: true })) {
      const full = join(current, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (entry.name.endsWith('.json')) {
        found.push(relative(dir, full).split(sep).join(posix.sep));
      }
    }
  };
  walk(dir);
  return found;
}

export function readCaptureFile(path: string): CaptureRecord[] {
  const parsed = JSON.parse(readFileSync(path, 'utf8')) as unknown;
  if (!Array.isArray(parsed)) {
    throw new Error(`Capture file is not a JSON array of records: ${path}`);
  }
  return parsed as CaptureRecord[];
}

export function writeCaptureFile(path: string, records: CaptureRecord[]): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${JSON.stringify(records, null, 2)}\n`, 'utf8');
}
