import { describe, expect, it } from 'vitest';
import { attachRecorder, type PageLike, type ResponseLike } from '../../src/crawl/recorder.js';

type FakePage = PageLike & { emit(response: ResponseLike): void };

function fakePage(): FakePage {
  let handler: ((response: ResponseLike) => void) | null = null;
  return {
    on(_event, fn) {
      handler = fn;
    },
    emit(response) {
      handler?.(response);
    },
  };
}

function response(overrides: Partial<{
  method: string;
  url: string;
  resourceType: string;
  status: number;
  postData: string | null;
  body: string | Error;
  headers: Record<string, string>;
}> = {}): ResponseLike {
  const {
    method = 'POST',
    url = 'https://app.brevo.com/contact/add',
    resourceType = 'xhr',
    status = 200,
    postData = '{"email":"a@b.com"}',
    body = '{"id":1}',
    headers = { 'content-type': 'application/json' },
  } = overrides;

  return {
    request: () => ({
      method: () => method,
      url: () => url,
      resourceType: () => resourceType,
      headers: () => ({ accept: 'application/json' }),
      postData: () => postData,
    }),
    status: () => status,
    headers: () => headers,
    text: async () => {
      if (body instanceof Error) throw body;
      return body;
    },
  };
}

describe('attachRecorder', () => {
  it('records xhr responses', async () => {
    const page = fakePage();
    const recorder = attachRecorder(page, () => '/contacts');
    page.emit(response());
    const records = await recorder.drain();

    expect(records).toHaveLength(1);
    expect(records[0]?.method).toBe('POST');
    expect(records[0]?.route).toBe('/contacts');
    expect(records[0]?.source).toBe('playwright');
  });

  it('records fetch responses', async () => {
    const page = fakePage();
    const recorder = attachRecorder(page, () => '/contacts');
    page.emit(response({ resourceType: 'fetch' }));
    expect(await recorder.drain()).toHaveLength(1);
  });

  it('ignores documents, stylesheets, scripts, images and fonts', async () => {
    const page = fakePage();
    const recorder = attachRecorder(page, () => '/contacts');
    for (const resourceType of ['document', 'stylesheet', 'script', 'image', 'font']) {
      page.emit(response({ resourceType }));
    }
    expect(await recorder.drain()).toEqual([]);
  });

  it('keeps the request body and the response body', async () => {
    const page = fakePage();
    const recorder = attachRecorder(page, () => '/contacts');
    page.emit(response());
    const records = await recorder.drain();
    expect(records[0]?.requestBody).toBe('{"email":"a@b.com"}');
    expect(records[0]?.responseBody).toBe('{"id":1}');
  });

  it('truncates an oversized response body and flags it', async () => {
    const page = fakePage();
    const recorder = attachRecorder(page, () => '/contacts');
    page.emit(response({ body: 'x'.repeat(20000) }));
    const records = await recorder.drain();
    expect(records[0]?.truncated).toBe(true);
    expect(records[0]?.responseBody?.length).toBe(8192);
  });

  it('survives a response body that cannot be read', async () => {
    const page = fakePage();
    const recorder = attachRecorder(page, () => '/contacts');
    page.emit(response({ body: new Error('no body for redirect') }));
    const records = await recorder.drain();
    expect(records).toHaveLength(1);
    expect(records[0]?.responseBody).toBeNull();
  });

  it('records a null request body when there is none', async () => {
    const page = fakePage();
    const recorder = attachRecorder(page, () => '/contacts');
    page.emit(response({ method: 'GET', postData: null }));
    expect((await recorder.drain())[0]?.requestBody).toBeNull();
  });

  it('uses the route reported at the moment of capture', async () => {
    const page = fakePage();
    let route = '/contacts';
    const recorder = attachRecorder(page, () => route);
    page.emit(response());
    route = '/campaigns';
    page.emit(response({ url: 'https://app.brevo.com/campaign/list' }));
    const records = await recorder.drain();
    expect(records.map((r) => r.route)).toEqual(['/contacts', '/campaigns']);
  });
});
