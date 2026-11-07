/**
 * The cases are the catalog's own. Every id in the first group was drafted
 * `destructive: true` by the real extraction run because Brevo answers it with
 * POST, and every one of them is a read.
 */

import { describe, expect, it } from 'vitest';
import { classifyRisk, verbOf } from '../../src/catalog/risk.js';

describe('verbOf', () => {
  it('reads the verb out of module.verb_object', () => {
    expect(verbOf('contacts.create_contact')).toBe('create');
    expect(verbOf('segments.get_count')).toBe('get');
  });

  it('returns null for an id with no verb', () => {
    expect(verbOf('contacts')).toBeNull();
    expect(verbOf('contacts.')).toBeNull();
  });
});

describe('classifyRisk', () => {
  it('clears the reads Brevo serves over POST', () => {
    for (const id of [
      'segments.get_count',
      'segments.query_contacts',
      'transactional.fetch_email_logs',
      'contacts.list_activities',
      'features.check_accessibility',
      'ecommerce.detect_store',
    ]) {
      const risk = classifyRisk(id);
      expect(risk?.destructive, id).toBe(false);
      expect(risk?.idempotent, id).toBe(true);
    }
  });

  it('treats a reversible mutation as not destructive but not idempotent', () => {
    // Creating a contact changes state, and is undoable, and touches only data
    // the account owns. An agent should not have to ask permission for it.
    const risk = classifyRisk('contacts.create_contact');
    expect(risk).toEqual({
      destructive: false,
      idempotent: false,
      reason: '"create" mutates reversibly, inside the account',
    });
    expect(classifyRisk('contacts.add_contact_to_lists')?.destructive).toBe(false);
  });

  it('marks what cannot be undone or leaves the account', () => {
    // `send_campaign` creates nothing and is the most destructive action here:
    // it mails real people. That is the case a method-based rule gets wrong in
    // the opposite direction from `get_count`.
    for (const id of [
      'campaigns.send_campaign',
      'contacts.delete_contact',
      'contacts.unsubscribe_contact',
      'landing_pages.publish_page',
      'security.revoke_key',
      'account.close_account',
    ]) {
      const risk = classifyRisk(id);
      expect(risk?.destructive, id).toBe(true);
      expect(risk?.idempotent, id).toBe(false);
    }
  });

  it('separates the eval’s confusable pair', () => {
    // delete vs unsubscribe are both destructive, but a catalog that cannot
    // tell them apart has an agent deleting someone who asked to opt out.
    expect(classifyRisk('contacts.delete_contact')?.destructive).toBe(true);
    expect(classifyRisk('contacts.unsubscribe_contact')?.destructive).toBe(true);
  });

  it('does not read a noun as a verb', () => {
    // Both produced by the real extraction, and both were classified backwards
    // by a scan over every token. The second is the dangerous direction: a
    // state change labelled a safe idempotent read.
    expect(classifyRisk('contacts.check_duplicate_contact')).toEqual({
      destructive: false,
      idempotent: true,
      reason: '"check" reads; Brevo reads via POST',
    });
    expect(classifyRisk('lists.sync_list_counts')).toEqual({
      destructive: false,
      idempotent: false,
      reason: '"sync" mutates reversibly, inside the account',
    });
  });

  it('leaves an id whose verb is not first on the fail-safe default', () => {
    // A naming defect, fixed by renaming the action rather than here.
    expect(classifyRisk('segments.paginated_count')).toBeNull();
  });

  it('takes the most dangerous verb in an id, not the first', () => {
    expect(classifyRisk('campaigns.create_and_send_campaign')?.destructive).toBe(true);
  });

  it('resolves an ambiguous verb towards confirmation', () => {
    // "remove" is reversible for a list membership and not for a contact. The
    // two errors are not symmetric, so it lands in the destructive group.
    expect(classifyRisk('lists.remove_contact')?.destructive).toBe(true);
  });

  it('returns null for an unknown verb, leaving the fail-safe draft alone', () => {
    expect(classifyRisk('homepage.wiggle_widget')).toBeNull();
    expect(classifyRisk('analytics.frobnicate_thing')).toBeNull();
  });
});
