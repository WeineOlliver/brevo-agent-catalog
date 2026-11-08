/**
 * The cases are the real ones. `contacts.import_contacts` was cited by
 * `contacts.suggest_mapping_from_file` and does not exist; `document.head` was
 * cited by the chat-widget loader and is an HTML element.
 */

import { describe, expect, it } from 'vitest';
import { findDanglingRefs, textOf } from '../../src/catalog/crossrefs.js';

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
