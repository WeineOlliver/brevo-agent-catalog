/**
 * Headless Claude Code adapter — the judgment pass.
 *
 * Shells out to `claude -p`, which rides the machine's existing authenticated
 * session. No Anthropic API key exists in this repository or is needed to run
 * it; the operator must be logged into Claude Code, which the README states.
 *
 * Slower per call than a raw API request and not built for high-throughput
 * fan-out, which is exactly why the breadth pass goes to Groq instead.
 */

import { spawn } from 'node:child_process';
import type { CompletionRequest, ExecFn, LlmProvider } from './types.js';

const defaultExec: ExecFn = (cmd, args, stdin) =>
  new Promise((resolve, reject) => {
    const child = spawn(cmd, args, { stdio: ['pipe', 'pipe', 'pipe'], shell: false });

    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (chunk: Buffer) => {
      stdout += chunk.toString('utf8');
    });
    child.stderr.on('data', (chunk: Buffer) => {
      stderr += chunk.toString('utf8');
    });

    child.on('error', reject);
    child.on('close', (code) => {
      resolve({ stdout: stdout || stderr, code: code ?? 0 });
    });

    child.stdin.end(stdin, 'utf8');
  });

type ResultEnvelope = { result?: unknown };

export function createClaudeCliProvider(opts?: { bin?: string; exec?: ExecFn }): LlmProvider {
  const bin = opts?.bin ?? 'claude';
  const exec = opts?.exec ?? defaultExec;

  return {
    name: 'claude-code-cli',

    async complete(request: CompletionRequest): Promise<string> {
      const args = ['-p', '--output-format', 'json', '--append-system-prompt', request.system];
      const { stdout, code } = await exec(bin, args, request.user);

      if (code !== 0) {
        throw new Error(`claude CLI exited ${code}: ${stdout.slice(0, 400)}`);
      }

      try {
        const envelope = JSON.parse(stdout) as ResultEnvelope;
        if (typeof envelope.result === 'string') return envelope.result;
      } catch {
        // Not an envelope — fall through and treat stdout as the answer.
      }

      return stdout;
    },
  };
}
