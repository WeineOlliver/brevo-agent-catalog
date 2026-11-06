/**
 * A representative, schema-valid catalog entry. Tests spread this and override
 * single fields, so it must stay valid.
 */
export const validAction = {
  id: 'contacts.create_contact',
  module: 'contacts',
  name: 'Create contact',
  description:
    'Call this when the user wants to add a new person to Brevo. Use contacts.update_contact instead if a contact with that email already exists.',
  preconditions: ['The session is authenticated.'],
  inputs: {
    type: 'object',
    properties: {
      email: { type: 'string', format: 'email', description: 'The contact email address.' },
      listIds: { type: 'array', items: { type: 'integer' }, description: 'Lists to add the contact to.' },
    },
    required: ['email'],
    additionalProperties: false,
  },
  outputs: {
    type: 'object',
    properties: { id: { type: 'integer', description: 'The new contact id.' } },
  },
  side_effects: ['A contact is created and counts towards the plan contact limit.'],
  destructive: false,
  idempotent: false,
  ui_path: ['Contacts', 'Add a contact', 'Save'],
  internal_endpoint: {
    method: 'POST',
    path: '/contact/add',
    body_example: '{"email":"{{EMAIL}}","listIds":["{{LIST_ID}}"]}',
  },
  public_api: { exists: true, operationId: 'createContact' },
  plan_tier: 'free',
  verification: {
    status: 'observed',
    evidence: ['captures/clean/contacts.json'],
    verified_at: null,
  },
} as const;
