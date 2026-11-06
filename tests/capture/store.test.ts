import { mkdtempSync, mkdirSync, writeFileSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, sep } from 'node:path';
import { describe, expect, it } from 'vitest';
import { listCaptureFiles, readCaptureFile, writeCaptureFile } from '../../src/capture/store.js';
import type { CaptureRecord } from '../../src/capture/types.js';

function tempDir(): string {
  return mkdtempSync(join(tmpdir(), 'capture-store-'));
}

const record: CaptureRecord = {
  id: 'abc',
  source: 'har',
  route: '/contacts',
  method: 'POST',
  url: 'https://app.brevo.com/contact/add',
  status: 200,
  requestHeaders: {},
  responseHeaders: {},
  requestBody: null,
  responseBody: null,
  truncated: false,
  capturedAt: '2026-11-06T12:00:00.000Z',
};

describe('listCaptureFiles', () => {
  it('finds json files nested in subdirectories, as relative paths', () => {
    const dir = tempDir();
    mkdirSync(join(dir, 'interact'), { recursive: true });
    writeFileSync(join(dir, 'a.json'), '[]');
    writeFileSync(join(dir, 'interact', 'b.json'), '[]');
    expect(listCaptureFiles(dir).sort()).toEqual(['a.json', 'interact/b.json']);
  });

  it('ignores files that are not json', () => {
    const dir = tempDir();
    writeFileSync(join(dir, 'a.json'), '[]');
    writeFileSync(join(dir, 'notes.txt'), 'hello');
    expect(listCaptureFiles(dir)).toEqual(['a.json']);
  });

  it('returns an empty array for a directory that does not exist', () => {
    expect(listCaptureFiles(join(tempDir(), 'missing'))).toEqual([]);
  });
});

describe('readCaptureFile / writeCaptureFile', () => {
  it('round-trips records', () => {
    const dir = tempDir();
    const path = join(dir, 'nested', 'route.json');
    writeCaptureFile(path, [record]);
    expect(readCaptureFile(path)).toEqual([
      { ...record, sourceFile: path.split(sep).join('/') },
    ]);
  });

  it('attaches the file it was read from, so evidence can cite something openable', () => {
    const dir = tempDir();
    const path = join(dir, 'contacts.json');
    writeCaptureFile(path, [record]);
    expect(readCaptureFile(path)[0]?.sourceFile).toBe(path.split(sep).join('/'));
  });

  it('does not write the provenance field back out', () => {
    const dir = tempDir();
    const path = join(dir, 'contacts.json');
    writeCaptureFile(path, [{ ...record, sourceFile: 'somewhere/else.json' }]);
    expect(JSON.parse(readFileSync(path, 'utf8'))[0]).not.toHaveProperty('sourceFile');
  });

  it('creates missing parent directories when writing', () => {
    const dir = tempDir();
    const path = join(dir, 'deep', 'deeper', 'route.json');
    writeCaptureFile(path, [record]);
    expect(readFileSync(path, 'utf8')).toContain('"route": "/contacts"');
  });

  it('throws a message naming the file when its contents are not an array', () => {
    const dir = tempDir();
    const path = join(dir, 'bad.json');
    writeFileSync(path, '{"not":"an array"}');
    expect(() => readCaptureFile(path)).toThrow(/bad\.json/);
  });
});
