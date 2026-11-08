/**
 * The cases are the real ones. `contacts.import_contacts` was cited by
 * `contacts.suggest_mapping_from_file` and does not exist; `document.head` was
 * cited by the chat-widget loader and is an HTML element.
 */

import { describe, expect, it } from 'vitest';
import {
  REWRITABLE_FIELDS,
  findDanglingRefs,
  rewriteProse,
  textOf,
} from '../../src/catalog/crossrefs.js';

describe('findDanglingRefs', () => {
  it('finds an id cited in prose that the catalog does not have', () => {
    const dangling = findDanglingRefs([
      {
        id: 'contacts.suggest_mapping_from_file',
        module: 'contacts',
        text: 'Use contacts.import_contacts to run the import itself.',
      },
      { id: 'contacts.create_contact', module: 'contacts', text: 'Call this when...' },
    ]);
    expect([...dangling.keys()]).toEqual(['contacts.import_contacts']);
    expect(dangling.get('contacts.import_contacts')).toEqual(['contacts.suggest_mapping_from_file']);
  });

  it('says nothing about an id that exists', () => {
    const dangling = findDanglingRefs([
      {
        id: 'contacts.update_contact',
        module: 'contacts',
        text: 'Use contacts.create_contact when the contact does not yet exist.',
      },
      { id: 'contacts.create_contact', module: 'contacts', text: 'Call this when...' },
    ]);
    expect(dangling.size).toBe(0);
  });

  it('ignores prose that merely looks like an id', () => {
    // Without the module-prefix rule these three all score as missing actions,
    // and a checker that cries wolf is a checker someone turns off.
    const dangling = findDanglingRefs([
      {
        id: 'conversations.load_chat_widget_script',
        module: 'conversations',
        text: 'The script is appended to document.head and posts to app.brevo.com for widget.config data.',
      },
    ]);
    expect(dangling.size).toBe(0);
  });

  it('does not report an entry citing its own id', () => {
    const dangling = findDanglingRefs([
      { id: 'contacts.export', module: 'contacts', text: 'contacts.export returns a job id.' },
    ]);
    expect(dangling.size).toBe(0);
  });

  it('counts one citation per citing action, not per mention', () => {
    const dangling = findDanglingRefs([
      {
        id: 'lists.get_lists',
        module: 'lists',
        text: 'See lists.create_folder. Also lists.create_folder for nesting.',
      },
    ]);
    expect(dangling.get('lists.create_folder')).toEqual(['lists.get_lists']);
  });
});

describe('textOf', () => {
  it('reads every field an agent takes as guidance', () => {
    const text = textOf({
      name: 'Create contact',
      description: 'Call this when a contact is new.',
      preconditions: ['The list must exist.'],
      side_effects: ['A contact appears in the list.'],
      inputs: { properties: { email: { description: 'ignored: not guidance' } } },
    });
    expect(text).toContain('Call this when a contact is new.');
    expect(text).toContain('The list must exist.');
    expect(text).toContain('A contact appears in the list.');
    expect(text).toContain('Create contact');
    expect(text).not.toContain('ignored: not guidance');
  });
});

describe('rewriteProse', () => {
  const verified = {
    id: 'contacts.delete_contact',
    module: 'contacts',
    name: 'Delete contact',
    description: 'Call this when you need to remove a contact. Use contacts.archive_contact instead.',
    preconditions: ['The contact must exist.'],
    side_effects: ['The contact is gone.'],
    destructive: true,
    idempotent: false,
    internal_endpoint: { method: 'DELETE', path: '/contact/backend/contacts/:id' },
    verification: {
      status: 'verified',
      evidence: ['executed DELETE /contact/backend/contacts/8 -> 200'],
      verified_at: '2026-11-08T01:30:00.000Z',
    },
  };

  it('takes the prose and leaves everything else identical', () => {
    const out = rewriteProse(verified, {
      description: 'Call this when you need to remove a contact. There is no archive action.',
      preconditions: ['The contact must exist in the account.'],
      side_effects: ['The contact is permanently removed.'],
    });

    expect(out.description).toContain('no archive action');
    expect(out.preconditions).toEqual(['The contact must exist in the account.']);

    // The whole point: a prose fix cannot rename, re-flag or un-verify an entry.
    expect(out.id).toBe('contacts.delete_contact');
    expect(out.destructive).toBe(true);
    expect(out.internal_endpoint).toEqual(verified.internal_endpoint);
    expect(out.verification).toEqual(verified.verification);
  });

  it('ignores an attempt to change anything else', () => {
    // A model that returns extra fields does not get to apply them.
    const out = rewriteProse(verified, {
      id: 'contacts.remove_contact',
      destructive: false,
      verification: { status: 'observed', evidence: [], verified_at: null },
      internal_endpoint: { method: 'GET', path: '/elsewhere' },
      description: 'Call this when removing a contact.',
    });

    expect(out.id).toBe('contacts.delete_contact');
    expect(out.destructive).toBe(true);
    expect(out.verification).toEqual(verified.verification);
    expect(out.internal_endpoint).toEqual(verified.internal_endpoint);
  });

  it('keeps the original when the rewrite is malformed or empty', () => {
    // Degrading to no change beats degrading to a wrong entry.
    const out = rewriteProse(verified, { description: '', preconditions: 'not an array' });
    expect(out.description).toBe(verified.description);
    expect(out.preconditions).toEqual(verified.preconditions);
    expect(out.side_effects).toEqual(verified.side_effects);
  });

  it('names exactly the three fields it may touch', () => {
    expect([...REWRITABLE_FIELDS]).toEqual(['description', 'preconditions', 'side_effects']);
  });
});
