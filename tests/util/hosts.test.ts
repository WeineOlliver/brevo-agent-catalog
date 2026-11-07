/**
 * The cases here are not invented: every URL is one that appeared in
 * `captures/`, and the "write" list is what the exploration run reported as its
 * 437 write requests. The point of the predicate is to tell those apart from
 * the four Brevo-owned requests in the same run, none of which is a business
 * action either.
 */

import { describe, expect, it } from 'vitest';
import { isAppTraffic, isBrevoHost, isWriteTraffic } from '../../src/util/hosts.js';

describe('isBrevoHost', () => {
  it('accepts Brevo and Sendinblue hosts', () => {
    expect(isBrevoHost('https://contacts-api.brevo.com/contact/backend/contacts')).toBe(true);
    expect(isBrevoHost('https://api.sendinblue.com/v3/contacts')).toBe(true);
  });

  it('rejects third parties and malformed urls', () => {
    expect(isBrevoHost('https://h.clarity.ms/collect')).toBe(false);
    expect(isBrevoHost('https://notbrevo.com/x')).toBe(false);
    expect(isBrevoHost('not a url')).toBe(false);
  });
});

describe('isAppTraffic', () => {
  it('keeps product backends', () => {
    for (const url of [
      'https://contacts-api.brevo.com/contact/backend/contacts/lists',
      'https://segments-api.brevo.com/segment/query',
      'https://crm-backend-api.brevo.com/crm/backend/deals',
      'https://account-app.brevo.com/account/apps/enable/sms-campaigns',
    ]) {
      expect(isAppTraffic(url), url).toBe(true);
    }
  });

  it('drops third-party telemetry', () => {
    for (const url of [
      'https://h.clarity.ms/collect',
      'https://api.amplitude.com/',
      'https://px.ads.linkedin.com/wa/',
      'https://rs.fullstory.com/rec/bundle/v2',
      'https://ad.doubleclick.net/ccm/s/collect',
      'https://www.google-analytics.com/g/collect',
    ]) {
      expect(isAppTraffic(url), url).toBe(false);
    }
  });

  it('drops Brevo-owned telemetry, which is the case a host check alone misses', () => {
    for (const url of [
      'https://app.brevo.com/cdn-cgi/rum?',
      'https://dt.brevo.com/',
      'https://metrics.brevo.com/g/collect',
      'https://ph.brevo.com/flags/',
      // Served by a genuine product backend, so only the path gives it away.
      'https://crm-backend-api.brevo.com/crm/backend/log-event',
    ]) {
      expect(isAppTraffic(url), url).toBe(false);
    }
  });

  it('drops static assets', () => {
    expect(isAppTraffic('https://mfe.brevo.com/spa-mfe.app.28ae268c.js')).toBe(false);
    expect(isAppTraffic('https://app.brevo.com/static/main.css')).toBe(false);
  });
});

describe('isWriteTraffic', () => {
  it('counts a write to a product backend', () => {
    expect(isWriteTraffic('https://contacts-api.brevo.com/contact/backend/contacts', 'POST')).toBe(
      true,
    );
    expect(isWriteTraffic('https://contacts-api.brevo.com/contact/backend/contacts/1', 'put')).toBe(
      true,
    );
  });

  it('does not count reads, whatever the method', () => {
    expect(isWriteTraffic('https://contacts-api.brevo.com/contact/backend/contacts', 'GET')).toBe(
      false,
    );
    expect(isWriteTraffic('https://app.brevo.com/x', 'OPTIONS')).toBe(false);
  });

  it('does not count a POST to telemetry — the bug this predicate exists for', () => {
    expect(isWriteTraffic('https://h.clarity.ms/collect', 'POST')).toBe(false);
    expect(isWriteTraffic('https://app.brevo.com/cdn-cgi/rum?', 'POST')).toBe(false);
    expect(isWriteTraffic('https://ph.brevo.com/flags/', 'POST')).toBe(false);
  });
});
