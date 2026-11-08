import { describe, expect, it } from 'vitest';
import { validateFlowIndex, type FlowValidationInput } from '../../src/flows/validate.js';
import type { EndpointRef } from '../../src/flows/derive.js';

const endpoints: EndpointRef[] = [
  { id: 'lists.create_list', method: 'POST', path: '/lists/create' },
  { id: 'contacts.create_contact', method: 'POST', path: '/contact/backend/contacts/add-contact' },
];

const records = [
  {
    method: 'POST',
    route: '/lists/create',
    url: 'https://app.brevo.com/lists/create',
    capturedAt: '2026-11-07T06:20:47.000Z',
  },
  {
    method: 'POST',
    route: '/contact/backend/contacts/add-contact',
    url: 'https://app.brevo.com/contact/backend/contacts/add-contact',
    capturedAt: '2026-11-07T06:21:55.000Z',
  },
];

function flowIndex(overrides: Record<string, unknown> = {}): unknown {
  return {
    generated_at: '2026-11-08T00:00:00.000Z',
    count: 1,
    flows: [
      {
        id: 'onboard_contact',
        name: 'Add a contact',
        goal: 'Get a new person into Brevo and into a list.',
        when_to_use: 'The user wants someone added to the audience.',
        evidence: { capture: 'captures/clean/har/block-a.json', from: '06:20:00', to: '06:30:00' },
        steps: [
          { action_id: 'lists.create_list', why: 'The list has to exist first.', optional: false },
          {
            action_id: 'contacts.create_contact',
            why: 'This is the step that makes the person exist.',
            optional: false,
          },
        ],
        notes: [],
        ...overrides,
      },
    ],
  };
}

function input(raw: unknown): FlowValidationInput {
  return {
    raw,
    actionIds: new Set(endpoints.map((entry) => entry.id)),
    endpoints,
    loadCapture: () => records,
    captureExists: () => true,
  };
}

describe('validateFlowIndex', () => {
  it('passes a flow whose steps match its capture window', () => {
    expect(validateFlowIndex(input(flowIndex()))).toEqual([]);
  });

  it('fails a flow whose steps were reordered by hand, and prints both sequences', () => {
    // The whole point of the gate: flows/index.json is generated, and a
    // plausible hand-edit is exactly what would otherwise survive review.
    // Reordering is the sharpest case, because the step list still holds the
    // right ids and the right count — only the order is now fiction, and order
    // is the entire reason flows exist.
    const tampered = flowIndex({
      steps: [
        {
          action_id: 'contacts.create_contact',
          why: 'This is the step that makes the person exist.',
          optional: false,
        },
        { action_id: 'lists.create_list', why: 'The list has to exist first.', optional: false },
      ],
    });
    const problems = validateFlowIndex(input(tampered));
    expect(problems).toHaveLength(1);
    expect(problems[0]).toContain('steps do not match the capture');
    expect(problems[0]).toContain('lists.create_list > contacts.create_contact');
  });

  it('fails a dropped step through the schema, before the capture is consulted', () => {
    // A one-step flow is not a flow. The schema rejects it first, and that
    // ordering is deliberate: a malformed file should not be compared against
    // evidence and reported as a disagreement with Brevo.
    const tampered = flowIndex({
      steps: [
        { action_id: 'lists.create_list', why: 'The list has to exist first.', optional: false },
      ],
    });
    const problems = validateFlowIndex(input(tampered));
    expect(problems).toHaveLength(1);
    expect(problems[0]).toContain('at least 2 element');
  });

  it('fails a step naming an action the catalog does not have', () => {
    // Same defect class as the 41 invented cross-references: a well-formed
    // string that no schema can reject.
    const problems = validateFlowIndex({
      ...input(flowIndex()),
      actionIds: new Set(['lists.create_list']),
    });
    expect(problems.some((p) => p.includes('is not an action in the catalog'))).toBe(true);
  });

  it('fails a flow citing a capture that is not there', () => {
    const problems = validateFlowIndex({
      ...input(flowIndex()),
      captureExists: () => false,
    });
    expect(problems).toHaveLength(1);
    expect(problems[0]).toContain('does not exist');
  });

  it('rejects a malformed index instead of trusting it', () => {
    const problems = validateFlowIndex(input({ generated_at: '', count: 0 }));
    expect(problems.length).toBeGreaterThan(0);
  });

  it('catches a count that disagrees with the file', () => {
    const problems = validateFlowIndex(input({ ...(flowIndex() as object), count: 7 }));
    expect(problems.some((p) => p.includes('count says 7'))).toBe(true);
  });

  it('rejects a window that ends before it starts', () => {
    const problems = validateFlowIndex(
      input(
        flowIndex({
          evidence: {
            capture: 'captures/clean/har/block-a.json',
            from: '06:30:00',
            to: '06:20:00',
          },
        }),
      ),
    );
    expect(problems.some((p) => p.includes('ends before it starts'))).toBe(true);
  });
});
