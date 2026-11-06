import { describe, expect, it } from 'vitest';
import { createClaudeCliProvider } from '../../src/providers/claude-cli.js';
import type { ExecFn } from '../../src/providers/types.js';

type ExecCall = { cmd: string; args: string[]; stdin: string };

function stubExec(result: { stdout: string; code: number }) {
  const calls: ExecCall[] = [];
  const exec: ExecFn = async (cmd, args, stdin) => {
    calls.push({ cmd, args, stdin });
    return result;
  };
  return { exec, calls };
}

const envelope = JSON.stringify({ type: 'result', result: '{"a":1}' });

describe('createClaudeCliProvider', () => {
  it('invokes the claude binary with -p and passes the prompt on stdin', async () => {
    const { exec, calls } = stubExec({ stdout: envelope, code: 0 });
    await createClaudeCliProvider({ exec }).complete({ system: 'sys', user: 'the prompt' });

    expect(calls[0]?.cmd).toBe('claude');
    expect(calls[0]?.args).toContain('-p');
    expect(calls[0]?.stdin).toBe('the prompt');
  });

  it('passes the system prompt to the CLI rather than burying it in stdin', async () => {
    const { exec, calls } = stubExec({ stdout: envelope, code: 0 });
    await createClaudeCliProvider({ exec }).complete({ system: 'be terse', user: 'u' });
    expect(calls[0]?.args).toContain('--append-system-prompt');
    expect(calls[0]?.args).toContain('be terse');
  });

  it('honours a custom binary path', async () => {
    const { exec, calls } = stubExec({ stdout: envelope, code: 0 });
    await createClaudeCliProvider({ bin: '/opt/claude', exec }).complete({ system: 's', user: 'u' });
    expect(calls[0]?.cmd).toBe('/opt/claude');
  });

  it('returns the result text out of the JSON envelope', async () => {
    const { exec } = stubExec({ stdout: envelope, code: 0 });
    expect(await createClaudeCliProvider({ exec }).complete({ system: 's', user: 'u' })).toBe(
      '{"a":1}',
    );
  });

  it('falls back to raw stdout when the output is not an envelope', async () => {
    const { exec } = stubExec({ stdout: 'plain text answer', code: 0 });
    expect(await createClaudeCliProvider({ exec }).complete({ system: 's', user: 'u' })).toBe(
      'plain text answer',
    );
  });

  it('throws when the CLI exits non-zero', async () => {
    const { exec } = stubExec({ stdout: 'boom', code: 1 });
    await expect(
      createClaudeCliProvider({ exec }).complete({ system: 's', user: 'u' }),
    ).rejects.toThrow(/exit(ed)? 1|exit code 1/i);
  });

  it('names itself', () => {
    expect(createClaudeCliProvider().name).toMatch(/claude/i);
  });
});
