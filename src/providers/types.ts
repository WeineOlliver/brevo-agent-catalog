/**
 * One interface, two adapters.
 *
 * Groq serves the high-volume breadth pass: cheap and fast across every
 * discovered route. Headless Claude Code serves the core tier and the
 * judgment-heavy fields — descriptions that disambiguate one action from its
 * neighbours, preconditions, and the destructive/idempotent calls.
 *
 * Keeping both behind this interface means the Groq key stays optional and a
 * reviewer can substitute their own provider.
 */

export type CompletionRequest = {
  system: string;
  user: string;
  maxTokens?: number;
};

export type LlmProvider = {
  /** Identifies the provider and model in logs and in the AI-usage write-up. */
  name: string;
  complete(request: CompletionRequest): Promise<string>;
};

/** Injected process runner, so the CLI adapter is testable without a subprocess. */
export type ExecFn = (
  cmd: string,
  args: string[],
  stdin: string,
) => Promise<{ stdout: string; code: number }>;
