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

  it('clears the two reads the second extraction pass drafted as destructive', () => {
    // Both are real catalog ids. `suggest_mapping_from_file` posts a CSV and
    // gets back a proposed mapping; nothing is imported until a later action.
    for (const id of ['contacts.suggest_mapping_from_file', 'companies.find_companies_by_name']) {
      const risk = classifyRisk(id);
      expect(risk?.destructive, id).toBe(false);
      expect(risk?.idempotent, id).toBe(true);
    }
  });

  it('escalates an id that both links and unlinks', () => {
    // `contacts.link_unlink_company` is one endpoint doing two things. Linking
    // is additive; unlinking destroys the record of an association. The
    // whole-name scan is supposed to take the worse half.
    expect(classifyRisk('contacts.link_company')?.destructive).toBe(false);
    expect(classifyRisk('contacts.link_unlink_company')?.destructive).toBe(true);
  });

  it('escalates a bulk dispatcher, whose payload picks the operation', () => {
    // POST /contact/backend/actions/list can delete. No name can say so.
    const risk = classifyRisk('contacts.bulk_modify_list');
    expect(risk?.destructive).toBe(true);
    expect(risk?.idempotent).toBe(false);
  });

  it('classifies the renamed count that used to be flagged destructive', () => {
    // Was `segments.paginated_count`: verb third, so it fell through to the
    // fail-safe default and a count shipped as destructive. Fixed by renaming
    // the action, which is what the rule below still demands.
    const risk = classifyRisk('segments.count_paginated');
    expect(risk?.destructive).toBe(false);
    expect(risk?.idempotent).toBe(true);
  });

  it('treats suspending a scheduled send as the reversible undo it is', () => {
    // PUT /email-campaign/api/:id/suspend returns a scheduled campaign to
    // draft. `schedule` is classified reversible *because* this exists, so
    // this cannot be destructive without making that classification a lie.
    const risk = classifyRisk('campaigns.suspend_campaign');
    expect(risk?.destructive).toBe(false);
    expect(risk?.idempotent).toBe(false);
    expect(classifyRisk('campaigns.schedule_campaign')?.destructive).toBe(false);
  });

  it('still treats cancel as irreversible, which suspend is not', () => {
    // Different words doing different jobs: a pause comes back, a termination
    // does not. Conflating them is how a flag stops meaning anything.
    expect(classifyRisk('billing.cancel_plan')?.destructive).toBe(true);
  });

  it('fails safe on unblock, whose risk depends on its object', () => {
    // Unblocking a sender is reversible. Unblocking a contact re-enables mail
    // to someone who opted out, and blocking them again does not undo it.
    expect(classifyRisk('senders.unblock_sender')?.destructive).toBe(true);
  });

  it('clears analyze, which uploads a file and imports nothing', () => {
    const risk = classifyRisk('contacts.analyze_import_file');
    expect(risk?.destructive).toBe(false);
    expect(risk?.idempotent).toBe(true);
  });

  it('leaves a verb whose meaning depends on its object unclassified', () => {
    // `validate` reads campaign content and emails a code for a sender.
    // `open` reads a page and creates a conversation. A verb table cannot
    // tell those apart, so it declines to, and the draft stands.
    expect(classifyRisk('campaigns.validate_campaign_content')).toBeNull();
    expect(classifyRisk('editor.open_newsletter_editor')).toBeNull();
  });

  it('does not escalate a read because its object is named after a danger', () => {
    // `forms.list_unsubscribe_forms` is GET /editor-api/unsubscribe-forms. It
    // shipped destructive because "unsubscribe" sits in the name of the thing
    // being listed, which is the one real false positive the whole-name scan
    // produced across 197 actions.
    const risk = classifyRisk('forms.list_unsubscribe_forms');
    expect(risk?.destructive).toBe(false);
    expect(risk?.idempotent).toBe(true);

    // Same shape, other dangerous nouns.
    expect(classifyRisk('contacts.list_blocked_contacts')?.destructive).toBe(false);
    expect(classifyRisk('campaigns.count_sent_campaigns')?.destructive).toBe(false);
  });

  it('still escalates a read verb when the name promises two operations', () => {
    // A compound name is a claim about behaviour, not about an object, so the
    // scan wins there. Without this, `preview_and_send` would read as safe.
    expect(classifyRisk('campaigns.preview_and_send_campaign')?.destructive).toBe(true);
    expect(classifyRisk('contacts.export_then_purge')?.destructive).toBe(true);
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
