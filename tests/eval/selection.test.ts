import { describe, expect, it } from 'vitest';
import { scoreSelection, type EvalTask } from '../../src/eval/selection.js';
import { buildIndex } from '../../src/catalog/index-build.js';
import { ActionSchema, type Action } from '../../src/types.js';
import { validAction } from '../fixtures/valid-action.js';
import type { LlmProvider } from '../../src/providers/types.js';

const createContact: Action = ActionSchema.parse(validAction);
const deleteContact: Action = ActionSchema.parse({
  ...validAction,
  id: 'contacts.delete_contact',
  name: 'Delete contact',
  destructive: true,
});

const index = buildIndex([createContact, deleteContact]);

const task: EvalTask = {
  prompt: 'add john@example.com to my newsletter list',
  expectedActionId: 'contacts.create_contact',
};

function picks(actionId: string, inputs: Record<string, unknown> = {}): LlmProvider {
  return {
    name: 'fake',
    async complete() {
      return JSON.stringify({ action_id: actionId, inputs });
    },
  };
}

const alwaysProse: LlmProvider = {
  name: 'fake-prose',
  async complete() {
    return 'I am not sure which action to use.';
  },
};

describe('scoreSelection', () => {
  it('scores a correct selection as correct', async () => {
    expect((await scoreSelection([task], index, picks('contacts.create_contact'))).correct).toBe(1);
  });

  it('accepts a listed alternative and says that it did', async () => {
    // Brevo removes one contact from one list two ways, and both are in the
    // capture. Scoring either as wrong would measure the fixture.
    const twoAnswers: EvalTask = {
      prompt: 'take maria off the Black Friday list but keep her in Brevo',
      expectedActionId: 'contacts.create_contact',
      acceptableActionIds: ['contacts.delete_contact'],
    };
    const report = await scoreSelection([twoAnswers], index, picks('contacts.delete_contact'));
    expect(report.correct).toBe(1);
    expect(report.cases[0]?.viaAlternative).toBe(true);
    expect(report.cases[0]?.chosenActionId).toBe('contacts.delete_contact');
  });

  it('does not mark an exact hit as an alternative', async () => {
    // The flag drives what the run prints, so a false one would claim the
    // fixture had been widened when it had not.
    const report = await scoreSelection(
      [{ ...task, acceptableActionIds: ['contacts.delete_contact'] }],
      index,
      picks('contacts.create_contact'),
    );
    expect(report.correct).toBe(1);
    expect(report.cases[0]?.viaAlternative).toBeUndefined();
  });

  it('still misses an id that is in neither list', async () => {
    const report = await scoreSelection(
      [{ ...task, acceptableActionIds: ['contacts.update_contact'] }],
      index,
      picks('contacts.delete_contact'),
    );
    expect(report.correct).toBe(0);
    expect(report.cases[0]?.viaAlternative).toBeUndefined();
  });

  it('scores a wrong selection as incorrect and records what was chosen', async () => {
    const report = await scoreSelection([task], index, picks('contacts.delete_contact'));
    expect(report.correct).toBe(0);
    expect(report.cases[0]?.chosenActionId).toBe('contacts.delete_contact');
  });

  it('treats an id that is not in the catalog as incorrect, not an error', async () => {
    const report = await scoreSelection([task], index, picks('made.up_action'));
    expect(report.cases[0]?.correct).toBe(false);
    expect(report.cases[0]?.chosenActionId).toBe('made.up_action');
  });

  it('records null chosenActionId when the model returns unparseable output', async () => {
    const report = await scoreSelection([task], index, alwaysProse);
    expect(report.cases[0]?.chosenActionId).toBeNull();
    expect(report.cases[0]?.correct).toBe(false);
  });

  it('survives a provider that throws', async () => {
    const throwing: LlmProvider = {
      name: 'fake-throwing',
      async complete() {
        throw new Error('rate limited');
      },
    };
    const report = await scoreSelection([task], index, throwing);
    expect(report.total).toBe(1);
    expect(report.cases[0]?.chosenActionId).toBeNull();
  });

  it('checks expected inputs when the task declares them', async () => {
    const withInputs: EvalTask = { ...task, expectedInputs: { email: 'john@example.com' } };
    const report = await scoreSelection(
      [withInputs],
      index,
      picks('contacts.create_contact', { email: 'john@example.com' }),
    );
    expect(report.cases[0]?.inputsCorrect).toBe(true);
    expect(report.inputsCorrect).toBe(1);
  });

  it('marks inputs incorrect when a declared value is wrong', async () => {
    const withInputs: EvalTask = { ...task, expectedInputs: { email: 'john@example.com' } };
    const report = await scoreSelection(
      [withInputs],
      index,
      picks('contacts.create_contact', { email: 'someone@else.com' }),
    );
    expect(report.cases[0]?.inputsCorrect).toBe(false);
  });

  it('leaves inputsCorrect null when the task declares no expected inputs', async () => {
    const report = await scoreSelection([task], index, picks('contacts.create_contact'));
    expect(report.cases[0]?.inputsCorrect).toBeNull();
  });

  it('ignores extra inputs the model supplied beyond those expected', async () => {
    const withInputs: EvalTask = { ...task, expectedInputs: { email: 'john@example.com' } };
    const report = await scoreSelection(
      [withInputs],
      index,
      picks('contacts.create_contact', { email: 'john@example.com', listIds: [3] }),
    );
    expect(report.cases[0]?.inputsCorrect).toBe(true);
  });

  it('reports the total and keeps one case per task', async () => {
    const report = await scoreSelection([task, task], index, picks('contacts.create_contact'));
    expect(report.total).toBe(2);
    expect(report.cases).toHaveLength(2);
  });

  it('puts the catalog index in the prompt, not the full entries', async () => {
    let seen = '';
    const spy: LlmProvider = {
      name: 'spy',
      async complete(request) {
        seen = request.user;
        return JSON.stringify({ action_id: 'contacts.create_contact', inputs: {} });
      },
    };
    await scoreSelection([task], index, spy);
    expect(seen).toContain('contacts.create_contact');
    expect(seen).toContain(task.prompt);
    expect(seen).not.toContain('body_example');
  });
});

describe('a provider failure is not a description defect', () => {
  const throws: LlmProvider = {
    name: 'fake-dead',
    async complete() {
      throw new Error('claude CLI exited 1: usage limit reached');
    },
  };

  it('excludes a task the provider never answered from the denominator', async () => {
    // A real run hit a usage limit mid-way and reported 1 of 3, with two
    // "misses" whose token counts were zero. Read as a quality signal that is
    // noise dressed as regression, so those tasks are not scored.
    const report = await scoreSelection([task, task], index, throws);
    expect(report.total).toBe(2);
    expect(report.scored).toBe(0);
    expect(report.providerFailures).toBe(2);
  });

  it('marks the case so the report can say why', async () => {
    const report = await scoreSelection([task], index, throws);
    expect(report.cases[0]?.providerFailed).toBe(true);
    expect(report.cases[0]?.note).toMatch(/never answered/i);
    expect(report.cases[0]?.correct).toBe(false);
  });

  it('still scores prose, because the model did answer — badly', async () => {
    const report = await scoreSelection([task], index, alwaysProse);
    expect(report.scored).toBe(1);
    expect(report.providerFailures).toBe(0);
    expect(report.cases[0]?.providerFailed).toBeUndefined();
    expect(report.cases[0]?.correct).toBe(false);
  });

  it('counts only the failures, leaving good answers scored', async () => {
    let call = 0;
    const flaky: LlmProvider = {
      name: 'fake-flaky',
      async complete() {
        call += 1;
        if (call === 2) throw new Error('usage limit reached');
        return JSON.stringify({ action_id: 'contacts.create_contact', inputs: {} });
      },
    };

    const report = await scoreSelection([task, task, task], index, flaky);
    expect(report.scored).toBe(2);
    expect(report.correct).toBe(2);
    expect(report.providerFailures).toBe(1);
  });
});

describe('a model answering that no action fits', () => {
  // This shape was scored correctly and reported as something else for seven
  // runs: a null chosenActionId printed as "(nothing parseable)", which is an
  // extraction failure's label. Two causes, one label, and the louder cause
  // hidden under the quieter one.
  const declines: LlmProvider = {
    name: 'fake-declines',
    async complete() {
      return JSON.stringify({ action_id: null, inputs: {} });
    },
  };

  it('is a miss, and is flagged as its own kind of miss', async () => {
    const report = await scoreSelection([task], index, declines);
    expect(report.cases[0]?.correct).toBe(false);
    expect(report.cases[0]?.declinedNoAction).toBe(true);
    expect(report.cases[0]?.note).toMatch(/no catalog action fits/i);
  });

  it('stays in the denominator, because the model did answer', async () => {
    // The opposite of a provider failure: there is nothing wrong with the
    // harness here, and excluding it would delete the finding.
    const report = await scoreSelection([task], index, declines);
    expect(report.scored).toBe(1);
    expect(report.providerFailures).toBe(0);
    expect(report.cases[0]?.providerFailed).toBeUndefined();
  });

  it('is not confused with an unparseable answer', async () => {
    const report = await scoreSelection([task], index, alwaysProse);
    expect(report.cases[0]?.correct).toBe(false);
    expect(report.cases[0]?.declinedNoAction).toBeUndefined();
  });
});

describe('the destructive marker in the rendered catalog', () => {
  function capturePrompt(): { provider: LlmProvider; seen: () => string } {
    let user = '';
    return {
      provider: {
        name: 'fake-capture',
        async complete(request) {
          user = request.user;
          return JSON.stringify({ action_id: 'contacts.create_contact', inputs: {} });
        },
      },
      seen: () => user,
    };
  }

  it('is present by default, because an agent reading the catalog sees it', async () => {
    const { provider, seen } = capturePrompt();
    await scoreSelection([task], index, provider);
    expect(seen()).toContain('[destructive]');
  });

  it('can be withheld for the diagnostic run, and only then', async () => {
    // The published number always comes from the default. This exists to test
    // whether the marker, rather than any description, is what loses the tasks
    // whose answer is destructive — a question worth one run and not a guess.
    const { provider, seen } = capturePrompt();
    await scoreSelection([task], index, provider, { riskLabels: false });
    expect(seen()).not.toContain('[destructive]');
    expect(seen()).toContain('contacts.delete_contact');
  });
});
