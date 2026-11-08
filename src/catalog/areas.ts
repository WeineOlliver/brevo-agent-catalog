/**
 * Areas: the 197 actions in boxes a user would recognise.
 *
 * The catalog already had a grouping — `module` — and it is the wrong one. A
 * module is the first segment of an internal URL, so it describes Brevo's
 * service boundaries, not the product: 62 modules hold 197 actions, 34 of them
 * hold exactly one, and sending a single campaign crosses `email_campaigns`,
 * `editor` and `marketing_campaign`. An agent looking for "the email stuff"
 * cannot use that, because nobody asks a question shaped like a hostname.
 *
 * So each action also carries an `area`: one of nine boxes named after what a
 * person does in the app. Areas are assigned deterministically, and the mapping
 * is a table rather than a model call — it is a naming decision, and a naming
 * decision belongs in code where it can be argued with.
 *
 * Two rules keep it honest:
 *
 * 1. **Every module must appear in MODULE_AREA.** A new module does not quietly
 *    fall into the catch-all; it fails the build until someone decides where it
 *    belongs. A catch-all that fills itself stops being a decision.
 * 2. **`platform` is named, counted and explained.** 23 entries are the app's
 *    own shell — fonts, locales, feature flags, the homepage widget list — and
 *    the honest thing is to put them in a box labelled "not a feature" rather
 *    than to scatter them or to pretend 197 are all business actions.
 */

export type AreaId =
  | 'contacts'
  | 'campaigns'
  | 'automation'
  | 'crm'
  | 'transactional'
  | 'ecommerce'
  | 'reporting'
  | 'account'
  | 'platform';

export type Area = {
  id: AreaId;
  name: string;
  /** What a person is trying to do when they are in this part of the app. */
  does: string;
};

export const AREAS: Area[] = [
  {
    id: 'contacts',
    name: 'Contacts and audiences',
    does: 'Hold the people you market to, and cut them into lists and segments.',
  },
  {
    id: 'campaigns',
    name: 'Marketing campaigns',
    does: 'Compose and send marketing messages — email, SMS, WhatsApp — and read how they did.',
  },
  {
    id: 'automation',
    name: 'Automation',
    does: 'Run workflows that act on contacts without anyone pressing send.',
  },
  {
    id: 'crm',
    name: 'CRM',
    does: 'Track companies, deals, pipelines, tasks and meetings as a sales team would.',
  },
  {
    id: 'transactional',
    name: 'Transactional messaging',
    does: 'Send and inspect the one-to-one mail an application triggers: receipts, resets, SMTP.',
  },
  {
    id: 'ecommerce',
    name: 'Ecommerce and loyalty',
    does: 'Connect a store, follow orders and categories, and run loyalty programmes.',
  },
  {
    id: 'reporting',
    name: 'Reporting',
    does: 'Read the cross-product summaries the dashboard shows.',
  },
  {
    id: 'account',
    name: 'Account and settings',
    does: 'Configure the account itself: plan, senders, security, integrations, users.',
  },
  {
    id: 'platform',
    name: 'Platform plumbing (not a feature)',
    does:
      'What the web app calls to render itself — fonts, locales, feature flags, widget lists. ' +
      'An agent almost never wants these, and they are boxed together so the other eight areas stay honest.',
  },
];

/**
 * Module to area. Every module in the catalog must be here.
 *
 * Where a module splits across areas, the per-action table below wins. That
 * happens for exactly one module, `editor`, which carries both the newsletter a
 * user edits and the font list the editor needs to draw itself.
 */
export const MODULE_AREA: Record<string, AreaId> = {
  // Contacts and audiences
  contacts: 'contacts',
  lists: 'contacts',
  segments: 'contacts',
  attributes: 'contacts',
  tags: 'contacts',
  consent_groups: 'contacts',
  events: 'contacts',
  scores: 'contacts',
  forms: 'contacts',
  profile_forms: 'contacts',

  // Marketing campaigns
  campaigns: 'campaigns',
  email_campaigns: 'campaigns',
  marketing_campaign: 'campaigns',
  newsletters: 'campaigns',
  templates: 'campaigns',
  email_templates: 'campaigns',
  sms: 'campaigns',
  whatsapp: 'campaigns',
  editor: 'campaigns',

  // Automation
  automation: 'automation',

  // CRM
  crm: 'crm',
  companies: 'crm',
  deals: 'crm',
  pipelines: 'crm',
  tasks: 'crm',
  meetings: 'crm',

  // Transactional messaging
  transactional: 'transactional',
  transactional_senders: 'transactional',
  senders: 'transactional',
  smtp: 'transactional',
  domains: 'transactional',
  email: 'transactional',

  // Ecommerce and loyalty
  ecommerce: 'ecommerce',
  loyalty: 'ecommerce',
  conversions: 'ecommerce',

  // Reporting
  dashboard: 'reporting',

  // Account and settings
  account: 'account',
  settings: 'account',
  billing: 'account',
  security: 'account',
  apps: 'account',
  integrations: 'account',
  organizations: 'account',

  // Platform plumbing
  ui: 'platform',
  widgets: 'platform',
  homepage: 'platform',
  navigation: 'platform',
  marketing_site: 'platform',
  locales: 'platform',
  localization: 'platform',
  countries: 'platform',
  reference: 'platform',
  branding: 'platform',
  views: 'platform',
  objects: 'platform',
  agent: 'platform',
  analytics: 'platform',
  conversations: 'platform',
  client: 'platform',
  features: 'platform',
  user: 'platform',
  phone: 'platform',
};

/**
 * Per-action corrections, for the cases where the module is genuinely mixed.
 *
 * Each one is a judgement with a reason, which is why they are listed
 * individually rather than pattern-matched.
 */
export const ACTION_AREA: Record<string, AreaId> = {
  // The editor module is split: a user edits these two.
  'editor.get_template': 'campaigns',
  'editor.open_newsletter_editor': 'campaigns',
  // …and these three are the editor drawing its own chrome.
  'editor.list_fonts': 'platform',
  'editor.list_modules': 'platform',
  'editor.get_localization_settings': 'platform',
};

/** Modules present in the catalog but missing from MODULE_AREA. */
export function unmappedModules(modules: Iterable<string>): string[] {
  const missing = new Set<string>();
  for (const module of modules) {
    if (MODULE_AREA[module] === undefined) missing.add(module);
  }
  return [...missing].sort();
}

/**
 * The area an action belongs to, or null when its module is unmapped.
 *
 * Null rather than a default: a silent fallback is how a catch-all becomes the
 * largest box in the taxonomy without anyone choosing that.
 */
export function areaOf(action: { id: string; module: string }): AreaId | null {
  return ACTION_AREA[action.id] ?? MODULE_AREA[action.module] ?? null;
}
