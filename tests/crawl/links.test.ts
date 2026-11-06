import { describe, expect, it } from 'vitest';
import { extractNavLinks, isSignInUrl, normalizeRoute } from '../../src/crawl/links.js';

const ORIGIN = 'https://app.brevo.com';

const sidebar = `
<nav class="sidebar">
  <a href="/contacts">Contacts</a>
  <a href="/campaigns/email">Email campaigns</a>
</nav>
<div class="tabs">
  <a href="https://app.brevo.com/contacts/lists">Lists</a>
</div>
`;

describe('extractNavLinks', () => {
  it('extracts same-origin hrefs from sidebar and tab markup', () => {
    expect(extractNavLinks(sidebar, ORIGIN)).toEqual([
      'https://app.brevo.com/contacts',
      'https://app.brevo.com/campaigns/email',
      'https://app.brevo.com/contacts/lists',
    ]);
  });

  it('excludes other origins', () => {
    expect(extractNavLinks('<a href="https://evil.test/x">x</a>', ORIGIN)).toEqual([]);
  });

  it('excludes mailto, tel, javascript and anchor-only hrefs', () => {
    const html = `
      <a href="mailto:a@b.com">mail</a>
      <a href="tel:+5511">call</a>
      <a href="javascript:void(0)">js</a>
      <a href="#section">anchor</a>
    `;
    expect(extractNavLinks(html, ORIGIN)).toEqual([]);
  });

  it('deduplicates repeated hrefs', () => {
    const html = '<a href="/contacts">a</a><a href="/contacts">b</a>';
    expect(extractNavLinks(html, ORIGIN)).toEqual(['https://app.brevo.com/contacts']);
  });

  it('handles single-quoted and unquoted attribute values', () => {
    expect(extractNavLinks(`<a href='/contacts'>a</a>`, ORIGIN)).toEqual([
      'https://app.brevo.com/contacts',
    ]);
  });

  it('ignores auth links that navigate away from the authenticated app', () => {
    // Following /forgot-password redirects to login.brevo.com, which the crawler
    // correctly reads as an expired session and aborts the whole run.
    const html = `
      <a href="/forgot-password">Forgot password</a>
      <a href="/reset-password?token=x">Reset</a>
      <a href="/signup">Sign up</a>
      <a href="/account/login">Log in</a>
    `;
    expect(extractNavLinks(html, ORIGIN)).toEqual([]);
  });

  it('ignores logout and sign-out links, which would end the crawl session', () => {
    const html = '<a href="/logout">Log out</a><a href="/account/signout">Sign out</a>';
    expect(extractNavLinks(html, ORIGIN)).toEqual([]);
  });

  it('returns an empty array for markup with no links', () => {
    expect(extractNavLinks('<div>nothing here</div>', ORIGIN)).toEqual([]);
  });
});

describe('isSignInUrl', () => {
  it('recognises the dedicated sign-in host', () => {
    expect(isSignInUrl('https://login.brevo.com/?target=https%3A%2F%2Fapp.brevo.com%2F')).toBe(
      true,
    );
  });

  it('recognises a sign-in path on the app host', () => {
    expect(isSignInUrl('https://app.brevo.com/account/login')).toBe(true);
    expect(isSignInUrl('https://app.brevo.com/forgot-password')).toBe(true);
  });

  it('does not mistake an application route for a sign-in page', () => {
    expect(isSignInUrl('https://app.brevo.com/')).toBe(false);
    expect(isSignInUrl('https://app.brevo.com/contacts/lists')).toBe(false);
  });

  it('does not mistake a route that merely contains the word for one', () => {
    expect(isSignInUrl('https://app.brevo.com/campaigns/login-reminder')).toBe(false);
  });

  it('treats an unparseable url as not a sign-in page rather than throwing', () => {
    expect(() => isSignInUrl('not a url')).not.toThrow();
    expect(isSignInUrl('not a url')).toBe(false);
  });
});

describe('normalizeRoute', () => {
  it('strips query strings and numeric ids', () => {
    expect(normalizeRoute('https://app.brevo.com/contacts/list/8821?tab=x')).toBe(
      '/contacts/list/:id',
    );
  });

  it('deduplicates routes that differ only by id', () => {
    expect(
      new Set(['/contacts/list/1', '/contacts/list/2'].map(normalizeRoute)).size,
    ).toBe(1);
  });

  it('replaces uuid segments', () => {
    expect(normalizeRoute('/campaigns/3f2504e0-4f89-11d3-9a0c-0305e82c3301/edit')).toBe(
      '/campaigns/:id/edit',
    );
  });

  it('replaces long hex segments', () => {
    expect(normalizeRoute('/templates/a1b2c3d4e5f6a7b8c9d0e1f2/preview')).toBe(
      '/templates/:id/preview',
    );
  });

  it('leaves a word-only path untouched', () => {
    expect(normalizeRoute('https://app.brevo.com/contacts/lists')).toBe('/contacts/lists');
  });

  it('drops a trailing slash', () => {
    expect(normalizeRoute('https://app.brevo.com/contacts/')).toBe('/contacts');
  });

  it('maps the origin root to /', () => {
    expect(normalizeRoute('https://app.brevo.com/')).toBe('/');
  });

  it('accepts a bare path as well as a full url', () => {
    expect(normalizeRoute('/contacts/list/99')).toBe('/contacts/list/:id');
  });

  it('masks an email-shaped segment, since Brevo keys contacts by email', () => {
    expect(normalizeRoute('/v3/contacts/someone@example.com')).toBe('/v3/contacts/:id');
  });

  it('masks a redaction placeholder segment, raw or percent-encoded', () => {
    expect(normalizeRoute('/contacts/{{CONTACT_ID}}')).toBe('/contacts/:id');
    expect(normalizeRoute('/contacts/%7B%7BCONTACT_ID%7D%7D')).toBe('/contacts/:id');
  });

  it('collapses two different contact emails to one route', () => {
    expect(
      new Set(
        ['/contacts/a@example.com', '/contacts/b@example.com'].map(normalizeRoute),
      ).size,
    ).toBe(1);
  });
});
