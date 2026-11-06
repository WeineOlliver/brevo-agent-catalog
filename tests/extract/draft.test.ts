import { describe, expect, it } from 'vitest';
import { buildDraftPrompt } from '../../src/extract/prompt.js';
import { draftAction } from '../../src/extract/draft.js';
import { ActionSchema } from '../../src/types.js';
import type { ActionCandidate } from '../../src/extract/cluster.js';
import type { CaptureRecord } from '../../src/capture/types.js';
import type { PublicApiOperation } from '../../src/openapi/index.js';
import type { LlmProvider } from '../../src/providers/types.js';

const sample: CaptureRecord = {
  id: 'id',
  source: 'playwright',
  route: '/contacts',
  method: 'POST',
  url: 'https://app.brevo.com/contact/add',
  status: 200,
  requestHeaders: { 'content-type': 'application/json' },
  responseHeaders: {},
  requestBody: '{"email":"{{EMAIL}}"}',
  responseBody: '{"id":1}',
  truncated: false,
  capturedAt: '2026-11-06T12:00:00.000Z',
};

const candidate: ActionCandidate = {
  key: 'POST /contact/add',
  route: '/contacts',
  method: 'POST',
  pathTemplate: '/contact/add',
  samples: [sample],
};

const readCandidate: ActionCandidate = {
  ...candidate,
  key: 'GET /contact/list',
  method: 'GET',
  pathTemplate: '/contact/list',
  samples: [{ ...sample, method: 'GET', requestBody: null }],
};

const operation: PublicApiOperation = {
  operationId: 'createContact',
  method: 'POST',
  pathTemplate: '/contacts',
  required: ['email'],
  enums: { smtpBlacklistSender: ['transactional', 'marketing'] },
  tags: ['Contacts'],
};

/** The semantic fields the model is asked for; everything else is deterministic. */
function modelDraft(overrides: Record<string, unknown> = {}): string {
  return JSON.stringify({
    id: 'contacts.create_contact',
    module: 'contacts',
    name: 'Create contact',
    description: 'Call this when the user wants to add a new person. Use update_contact instead if the email exists.',
    preconditions: ['The session is authenticated.'],
    inputs: { type: 'object', properties: { email: { type: 'string' } }, required: ['email'] },
    outputs: { type: 'object', properties: { id: { type: 'integer' } } },
    side_effects: ['A contact is created.'],
    destructive: false,
    idempotent: false,
    ui_path: ['Contacts', 'Add a contact'],
    plan_tier: 'free',
    ...overrides,
  });
}

function provider(responses: string[]): LlmProvider & { calls: number } {
  let calls = 0;
  const impl = {
    name: 'fake',
    async complete() {
      const response = responses[Math.min(calls, responses.length - 1)] ?? '';
      calls += 1;
      return response;
    },
    get calls() {
      return calls;
    },
  };
  return impl as LlmProvider & { calls: number };
}

describe('buildDraftPrompt', () => {
  it('includes the public operationId when the spec matched', () => {
    expect(buildDraftPrompt(candidate, operation).user).toContain('createContact');
  });

  it('includes the spec enums as authoritative', () => {
    const prompt = buildDraftPrompt(candidate, operation).user;
    expect(prompt).toContain('smtpBlacklistSender');
    expect(prompt).toContain('transactional');
  });

  it('includes the spec required fields', () => {
    expect(buildDraftPrompt(candidate, operation).user).toMatch(/required[\s\S]*email/i);
  });

  it('says there is no public operation when the spec did not match', () => {
    expect(buildDraftPrompt(candidate, null).user).toMatch(/no (matching )?public (api )?operation/i);
  });

  it('states the fail-safe rule in the prompt when nothing is verified', () => {
    expect(buildDraftPrompt(candidate, null).system).toMatch(/destructive/i);
  });

  it('states the description style the catalog requires', () => {
    expect(buildDraftPrompt(candidate, null).system).toMatch(/when to call|call this when/i);
  });

  it('carries the sanitized request body as evidence', () => {
    expect(buildDraftPrompt(candidate, null).user).toContain('{{EMAIL}}');
  });

  it('names the allowed plan_tier values so the enum is satisfiable', () => {
    expect(buildDraftPrompt(candidate, null).system).toContain('unknown');
  });

  it('caps evidence size, because the provider rejects oversized requests', () => {
    // Measured: 3 of 126 real drafts failed with HTTP 413, and most of the rest
    // with 429 on a tokens-per-minute limit. An 8 KiB captured body is the cause.
    const huge: ActionCandidate = {
      ...candidate,
      samples: [1, 2, 3, 4, 5].map(() => ({
        ...sample,
        requestBody: 'x'.repeat(8192),
        responseBody: 'y'.repeat(8192),
      })),
    };
    expect(buildDraftPrompt(huge, operation).user.length).toBeLessThan(6000);
  });

  it('uses at most two samples, since a third rarely adds evidence', () => {
    const many: ActionCandidate = { ...candidate, samples: [sample, sample, sample] };
    const prompt = buildDraftPrompt(many, null).user;
    expect(prompt).toContain('Example 2');
    expect(prompt).not.toContain('Example 3');
  });

  it('says when a body was shortened, so the model does not treat it as complete', () => {
    const long: ActionCandidate = {
      ...candidate,
      samples: [{ ...sample, responseBody: 'y'.repeat(5000) }],
    };
    expect(buildDraftPrompt(long, null).user).toMatch(/shortened|truncated/i);
  });
});

describe('draftAction', () => {
  it('returns ok with a parsed action when the provider returns valid JSON', async () => {
    const result = await draftAction(candidate, operation, provider([modelDraft()]));
    expect(result.ok).toBe(true);
    expect(result.ok && result.action.id).toBe('contacts.create_contact');
  });

  it('fills internal_endpoint from the capture rather than asking the model', async () => {
    const result = await draftAction(candidate, operation, provider([modelDraft()]));
    expect(result.ok && result.action.internal_endpoint).toEqual({
      method: 'POST',
      path: '/contact/add',
      body_example: '{"email":"{{EMAIL}}"}',
    });
  });

  it('fills public_api from the spec match rather than asking the model', async () => {
    const result = await draftAction(candidate, operation, provider([modelDraft()]));
    expect(result.ok && result.action.public_api).toEqual({
      exists: true,
      operationId: 'createContact',
    });
  });

  it('marks an unmatched candidate as having no public api', async () => {
    const result = await draftAction(candidate, null, provider([modelDraft()]));
    expect(result.ok && result.action.public_api).toEqual({ exists: false, operationId: null });
  });

  it('assigns observed status with the capture as evidence, never verified', async () => {
    const result = await draftAction(candidate, operation, provider([modelDraft()]));
    expect(result.ok && result.action.verification.status).toBe('observed');
    expect(result.ok && result.action.verification.verified_at).toBeNull();
  });

  it('cites the capture file as evidence, so the audit trail is followable', async () => {
    // The README promises observed evidence is "a path into captures/clean/".
    // A route label is not a path, and a reviewer cannot open it.
    const withSource: ActionCandidate = {
      ...candidate,
      samples: [{ ...sample, sourceFile: 'captures/clean/contacts.json' }],
    };
    const result = await draftAction(withSource, operation, provider([modelDraft()]));
    expect(result.ok && result.action.verification.evidence).toContain(
      'captures/clean/contacts.json',
    );
  });

  it('retries once when the first response fails schema validation', async () => {
    const p = provider([modelDraft({ id: 'Not Snake Case' }), modelDraft()]);
    const result = await draftAction(candidate, operation, p);
    expect(p.calls).toBe(2);
    expect(result.ok).toBe(true);
  });

  it('returns the errors and the raw text when every attempt fails', async () => {
    const result = await draftAction(candidate, null, provider(['I cannot help with that.']));
    expect(result.ok).toBe(false);
    expect(result.ok === false && result.errors.length).toBeGreaterThan(0);
    expect(result.ok === false && result.raw).toContain('cannot help');
  });

  it('never returns an action that fails ActionSchema', async () => {
    const bad = [
      modelDraft({ id: 'bad' }),
      modelDraft({ description: '' }),
      modelDraft({ plan_tier: 'platinum' }),
      modelDraft({ preconditions: 'not an array' }),
      '```json\n{"nonsense":true}\n```',
    ];
    for (const response of bad) {
      const result = await draftAction(candidate, null, provider([response]), 1);
      if (result.ok) expect(ActionSchema.safeParse(result.action).success).toBe(true);
      else expect(result.errors.length).toBeGreaterThan(0);
    }
  });

  it('forces the fail-safe flags on an unverified non-read action', async () => {
    const result = await draftAction(
      candidate,
      operation,
      provider([modelDraft({ destructive: false, idempotent: true })]),
    );
    expect(result.ok && result.action.destructive).toBe(true);
    expect(result.ok && result.action.idempotent).toBe(false);
  });

  it('leaves the flags alone for a read action', async () => {
    const result = await draftAction(
      readCandidate,
      null,
      provider([modelDraft({ id: 'contacts.list_contacts', destructive: false, idempotent: true })]),
    );
    expect(result.ok && result.action.destructive).toBe(false);
    expect(result.ok && result.action.idempotent).toBe(true);
  });
});
