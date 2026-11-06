# brevo-agent-catalog Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a machine-readable catalog of Brevo business actions, extracted from the real authenticated app, with per-entry confidence that an AI agent can filter on.

**Architecture:** A staged pipeline. Captures enter through a source-agnostic abstraction (Playwright crawl, or a hand-exported HAR as fallback), get sanitized into placeholders, are clustered into action candidates, joined against Brevo's public OpenAPI spec for deterministic enrichment, then drafted into schema-valid entries by an LLM provider (Groq for breadth, headless Claude Code for judgment). ajv is a hard gate. A Playwright verify harness executes chosen actions for real and stamps `verified`. A selection eval measures whether a model can resolve a natural-language task to the right entry.

**Tech Stack:** TypeScript, Node 20, pnpm, Playwright, Zod, ajv, vitest, tsx, js-yaml, zod-to-json-schema.

**Spec:** `docs/superpowers/specs/2026-11-06-brevo-agent-catalog-design.md`

## Global Constraints

- Node 20, pnpm, TypeScript. Scripts run via `tsx`. Tests via `vitest`.
- **The entire repository is in English, without exception** — code, comments, commits, docs.
- `.gitignore` carries `.env`, `.auth/`, `captures/raw/`, `node_modules` **from the first commit**.
- Crawl: same domain only, BFS, **maximum 1 request per second**. The automated link crawl never clicks send/delete controls.
- Mutation bounds: scripts may create throwaway data and send test emails; they may delete **only fixtures the harness itself created**; never touch pre-existing account data.
- No Brevo API key and no Anthropic API key exist or are required. Groq key via `.env` only.
- Identifiers are replaced with structure-preserving placeholders: `{{ACCOUNT_ID}}`, `{{LIST_ID}}`, `{{CAMPAIGN_ID}}`, `{{TEMPLATE_ID}}`, `{{EMAIL}}`. Never bare removal.
- Unproven `destructive` / `idempotent` are fail-safe: any non-read action is `destructive: true, idempotent: false` until verification says otherwise.
- `verification.status` is one of `verified | observed | inferred`, assigned only per the spec's §7.2 table. Spec-derived does not beat `inferred`. Partial execution does not earn `verified`.
- Public OpenAPI spec URL: `https://api.brevo.com/v3/swagger_definition_v3.yml`
- App origin for crawling: `https://app.brevo.com`

## Review Focus

Five failure modes the spec implies that no task's happy-path tests would catch. Each has a test added to the owning task.

1. **Secrets outside the places we look for them** — an API key in a URL query string, a token nested three levels deep in a JSON body, a `Set-Cookie` in a response header. The sanitizer must redact by *shape wherever it occurs*, not only in known header names and top-level body keys. (Task 4)
2. **Truncated and non-JSON bodies** — bodies are truncated at capture time, so a response body is routinely invalid JSON mid-object; some are HTML or binary. Nothing downstream may throw on them. (Task 3, Task 4)
3. **The model returns prose, or JSON inside a markdown fence** — a draft parser that assumes raw JSON will fail on a large fraction of real responses. It must extract the JSON object and, failing that, report a repairable error rather than crash the run. (Task 6)
4. **OpenAPI path templates versus concrete captured paths** — the spec declares `/contacts/{identifier}`; the capture shows `/contacts/42`. A naive string match reports `public_api.exists: false` for nearly everything, silently destroying the deterministic enrichment the design depends on. (Task 5)
5. **Colliding action ids** — two different captures legitimately produce `contacts.create_contact`. Index building must fail loudly on a duplicate id rather than silently keep the last one written. (Task 9)

---

### Task 1: Repository scaffold

**Files:**
- Create: `package.json`, `tsconfig.json`, `vitest.config.ts`, `.gitignore`, `.env.example`, `README.md`, `src/config.ts`
- Test: `tests/config.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces: `loadConfig(env?: NodeJS.ProcessEnv): Config` where
  `type Config = { groqApiKey: string | null; groqModel: string; claudeBin: string; appOrigin: string; openApiUrl: string; paths: { raw: string; clean: string; actions: string; data: string; auth: string } }`.

- [ ] **Step 1: Initialise the project**

`pnpm init`, then add dependencies: `playwright`, `zod`, `ajv`, `ajv-formats`, `js-yaml`, `zod-to-json-schema`, `dotenv`; dev dependencies: `typescript`, `tsx`, `vitest`, `@types/node`, `@types/js-yaml`. `package.json` sets `"type": "module"`, `"engines": { "node": ">=20" }`, and scripts: `test`, `typecheck`, plus one `tsx` entry per pipeline script added as those tasks land.

- [ ] **Step 2: Write `.gitignore` before anything else is committed**

Exactly these entries: `.env`, `.auth/`, `captures/raw/`, `node_modules`, plus `*.log` and `test-results/`.

- [ ] **Step 3: Write the failing test**

```ts
// tests/config.test.ts
describe('loadConfig', () => {
  it('returns null groqApiKey when GROQ_API_KEY is unset', () => {
    expect(loadConfig({}).groqApiKey).toBeNull();
  });
  it('reads GROQ_API_KEY from the environment', () => {
    expect(loadConfig({ GROQ_API_KEY: 'test-key' }).groqApiKey).toBe('test-key');
  });
  it('defaults appOrigin to https://app.brevo.com', () => {
    expect(loadConfig({}).appOrigin).toBe('https://app.brevo.com');
  });
});
```

- [ ] **Step 4: Run test to verify it fails**

Run: `pnpm vitest run tests/config.test.ts`
Expected: FAIL — cannot resolve `src/config.ts`.

- [ ] **Step 5: Implement `loadConfig(env)` in `src/config.ts`**

Reads from the passed env (defaulting to `process.env`) so it is testable without mutating globals. `.env.example` lists `GROQ_API_KEY=` and `GROQ_MODEL=` with no real values.

- [ ] **Step 6: Run tests and typecheck**

Run: `pnpm vitest run && pnpm typecheck`
Expected: PASS, no type errors.

- [ ] **Step 7: Commit**

```bash
git init
git add .
git commit -m "chore: scaffold TypeScript project with pnpm, vitest and gitignore"
```

---

### Task 2: Action schema and its Zod mirror

**Files:**
- Create: `src/types.ts`, `scripts/build-schema.ts`, `schema/action.schema.json`
- Test: `tests/types.test.ts`, `tests/schema-sync.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces: `ActionSchema` (Zod object), `type Action = z.infer<typeof ActionSchema>`, `VerificationStatus = 'verified' | 'observed' | 'inferred'`, and the generated `schema/action.schema.json` (draft 2020-12).

Field list is fixed by the spec §7.1: `id`, `module`, `name`, `description`, `preconditions[]`, `inputs`, `outputs`, `side_effects[]`, `destructive`, `idempotent`, `ui_path[]`, `internal_endpoint {method, path, body_example}`, `public_api {exists, operationId}`, `plan_tier`, `verification {status, evidence, verified_at}`.

- [ ] **Step 1: Write the failing tests**

```ts
// tests/types.test.ts
it('rejects an id that is not module.verb_object snake_case', () => {
  expect(ActionSchema.safeParse({ ...valid, id: 'Contacts.CreateContact' }).success).toBe(false);
  expect(ActionSchema.safeParse({ ...valid, id: 'createcontact' }).success).toBe(false);
  expect(ActionSchema.safeParse({ ...valid, id: 'contacts.create_contact' }).success).toBe(true);
});
it('rejects a verification status outside the three allowed values', () => {
  expect(ActionSchema.safeParse({ ...valid, verification: { ...valid.verification, status: 'probably' } }).success).toBe(false);
});
it('requires verified_at and evidence when status is verified', () => {
  expect(ActionSchema.safeParse({ ...valid, verification: { status: 'verified', evidence: [], verified_at: null } }).success).toBe(false);
});
it('accepts a null verified_at when status is inferred', () => {
  expect(ActionSchema.safeParse({ ...valid, verification: { status: 'inferred', evidence: ['derived from UI affordance'], verified_at: null } }).success).toBe(true);
});
```

```ts
// tests/schema-sync.test.ts
it('the committed JSON Schema matches what Zod generates', () => {
  expect(JSON.parse(readFileSync('schema/action.schema.json', 'utf8'))).toEqual(generateJsonSchema());
});
it('ajv accepts a valid action against the committed schema', () => { /* ajv.compile(committed)(valid) === true */ });
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm vitest run tests/types.test.ts tests/schema-sync.test.ts`
Expected: FAIL — `src/types.ts` unresolved.

- [ ] **Step 3: Implement `ActionSchema` in `src/types.ts`**

`id` uses `.regex(/^[a-z][a-z0-9_]*\.[a-z][a-z0-9_]*$/)`. `verification` is a discriminated union on `status`: the `verified` member requires non-empty `evidence` and an ISO `verified_at`; the other two allow `verified_at: null`. `inputs` and `outputs` are `z.record(z.unknown())` — they hold arbitrary JSON Schema, so they are not modelled further.

- [ ] **Step 4: Implement `generateJsonSchema()` and `scripts/build-schema.ts`**

`generateJsonSchema(): object` wraps `zod-to-json-schema` with `target: 'jsonSchema2020-12'` and `$id`. The script writes the result to `schema/action.schema.json`. Add `pnpm build:schema` to `package.json`. The sync test is what prevents the two from drifting.

- [ ] **Step 5: Generate the schema and run tests**

Run: `pnpm build:schema && pnpm vitest run`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/types.ts scripts/build-schema.ts schema/action.schema.json tests/
git commit -m "feat: add action schema as Zod source of truth with generated JSON Schema"
```

---

### Task 3: Capture source abstraction and HAR importer

**Files:**
- Create: `src/capture/types.ts`, `src/capture/har.ts`, `src/util/truncate.ts`
- Test: `tests/capture/har.test.ts`, `tests/util/truncate.test.ts`
- Fixture: `tests/fixtures/sample.har` — a small hand-written HAR with three entries: one JSON POST, one GET returning HTML, one entry whose response body is cut mid-object.

**Interfaces:**
- Consumes: nothing.
- Produces:

```ts
export type CaptureRecord = {
  id: string; source: 'playwright' | 'har'; route: string;
  method: string; url: string; status: number;
  requestHeaders: Record<string, string>;
  responseHeaders: Record<string, string>;
  requestBody: string | null; responseBody: string | null;
  truncated: boolean; capturedAt: string;
};
export function parseHar(harJson: string, route?: string): CaptureRecord[];
export function captureId(method: string, url: string): string;
export function truncateBody(body: string | null, maxBytes: number): { text: string | null; truncated: boolean };
```

- [ ] **Step 1: Write the failing tests**

```ts
// tests/util/truncate.test.ts
it('marks truncated when the body exceeds maxBytes', () => {
  expect(truncateBody('x'.repeat(100), 10)).toEqual({ text: 'x'.repeat(10), truncated: true });
});
it('passes a null body through untouched', () => {
  expect(truncateBody(null, 10)).toEqual({ text: null, truncated: false });
});
```

```ts
// tests/capture/har.test.ts
it('parses every entry in a HAR into a CaptureRecord', () => {
  expect(parseHar(sampleHar)).toHaveLength(3);
});
it('does not throw on a response body that is truncated mid-JSON', () => {   // Review Focus 2
  const records = parseHar(sampleHar);
  const cut = records.find(r => r.truncated);
  expect(cut?.responseBody).toBeTypeOf('string');
});
it('does not throw on a non-JSON response body', () => {                      // Review Focus 2
  expect(() => parseHar(sampleHar)).not.toThrow();
  expect(parseHar(sampleHar).some(r => r.responseHeaders['content-type']?.includes('text/html'))).toBe(true);
});
it('gives the same id to the same method and url', () => {
  expect(captureId('POST', 'https://a/b')).toBe(captureId('POST', 'https://a/b'));
});
it('lowercases header names', () => {
  expect(Object.keys(parseHar(sampleHar)[0].requestHeaders).every(k => k === k.toLowerCase())).toBe(true);
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm vitest run tests/capture tests/util`
Expected: FAIL — modules unresolved.

- [ ] **Step 3: Implement `truncateBody` in `src/util/truncate.ts`**

- [ ] **Step 4: Implement `parseHar` and `captureId` in `src/capture/har.ts`**

Bodies are treated as opaque strings throughout — never parsed at this layer, which is what makes Review Focus 2 hold by construction. `captureId` is a short hash of `method + ' ' + url`.

- [ ] **Step 5: Run tests to verify they pass**

Run: `pnpm vitest run tests/capture tests/util`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/capture src/util tests/
git commit -m "feat: add source-agnostic capture record type and HAR importer"
```

---

### Task 4: Sanitizer and secret-scan gate

**Files:**
- Create: `src/sanitize/redact.ts`, `src/sanitize/scan.ts`, `scripts/sanitize.ts`, `scripts/scan-secrets.ts`
- Test: `tests/sanitize/redact.test.ts`, `tests/sanitize/scan.test.ts`

**Interfaces:**
- Consumes: `CaptureRecord` (Task 3).
- Produces:

```ts
export type RedactionRules = { accountIds: string[]; emails: string[] };
export function redactCapture(record: CaptureRecord, rules: RedactionRules): CaptureRecord;
export function redactText(text: string, rules: RedactionRules): string;
export type Leak = { kind: 'api_key' | 'jwt' | 'cookie' | 'email' | 'account_id'; match: string };
export function scanForLeaks(text: string, rules: RedactionRules): Leak[];
```

Dropped headers: `cookie`, `set-cookie`, `authorization`, and anything matching `/^x-csrf/i`.

- [ ] **Step 1: Write the failing tests**

```ts
// tests/sanitize/redact.test.ts
it('drops cookie, set-cookie, authorization and x-csrf* headers', () => { /* all absent after redactCapture */ });
it('replaces a real email with {{EMAIL}}', () => {
  expect(redactText('to=weine@example.com', { accountIds: [], emails: ['weine@example.com'] })).toBe('to={{EMAIL}}');
});
it('replaces any email-shaped string, not only known ones', () => {          // Review Focus 1
  expect(redactText('to=someone.else@mail.co', { accountIds: [], emails: [] })).toBe('to={{EMAIL}}');
});
it('redacts a key carried in a URL query string', () => {                     // Review Focus 1
  const out = redactCapture({ ...rec, url: 'https://app.brevo.com/x?api-key=xkeysib-abc123def456' }, rules);
  expect(out.url).not.toContain('xkeysib-abc123def456');
});
it('redacts a token nested deep inside a JSON body', () => {                  // Review Focus 1
  const body = JSON.stringify({ a: { b: { c: { token: 'eyJhbGciOiJIUzI1NiJ9.e30.x' } } } });
  expect(redactText(body, rules)).not.toContain('eyJhbGciOiJIUzI1NiJ9');
});
it('preserves JSON structure when substituting placeholders', () => {
  expect(JSON.parse(redactText('{"listIds":[7]}', { accountIds: ['7'], emails: [] }))).toEqual({ listIds: ['{{LIST_ID}}'] });
});
it('does not throw on a truncated or non-JSON body', () => {                  // Review Focus 2
  expect(() => redactText('{"a":1,"b":{"c"', rules)).not.toThrow();
  expect(() => redactText('<html><body>hi', rules)).not.toThrow();
});
```

```ts
// tests/sanitize/scan.test.ts
it('finds a Brevo api key shape', () => {
  expect(scanForLeaks('xkeysib-0123456789abcdef', empty).map(l => l.kind)).toContain('api_key');
});
it('finds a JWT shape', () => { /* kind 'jwt' */ });
it('finds a configured account id', () => {
  expect(scanForLeaks('acct 998877', { accountIds: ['998877'], emails: [] }).map(l => l.kind)).toContain('account_id');
});
it('returns no leaks for already-redacted text', () => {
  expect(scanForLeaks('{"email":"{{EMAIL}}","list":"{{LIST_ID}}"}', empty)).toEqual([]);
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm vitest run tests/sanitize`
Expected: FAIL — modules unresolved.

- [ ] **Step 3: Implement `redactText` and `redactCapture` in `src/sanitize/redact.ts`**

Regex-based over the raw string so it works identically in URLs, headers and bodies at any nesting depth, and cannot throw on malformed JSON. Shape patterns to cover: `xkeysib-[A-Za-z0-9]{16,}`, JWTs (`eyJ` + two dot-separated base64 segments), bearer tokens, generic `(api[-_]?key|token|secret)=[^&\s"]+`, and RFC-ish email addresses. Configured `accountIds` map to `{{ACCOUNT_ID}}` / `{{LIST_ID}}` / `{{CAMPAIGN_ID}}` / `{{TEMPLATE_ID}}` by the key or path segment they appear under; an unattributable id match falls back to `{{ID}}`.

- [ ] **Step 4: Implement `scanForLeaks` in `src/sanitize/scan.ts`**

Same pattern set, reporting instead of replacing. This is deliberately the gate's independent second opinion, not a call into `redactText`.

- [ ] **Step 5: Implement the two scripts**

`scripts/sanitize.ts` walks `captures/raw/`, applies `redactCapture`, writes to `captures/clean/` preserving relative paths. `scripts/scan-secrets.ts` walks every file staged for commit under `captures/clean/` and `actions/`, and **exits non-zero** listing any leak found. Add `pnpm sanitize` and `pnpm scan` to `package.json`.

- [ ] **Step 6: Run tests and the gate**

Run: `pnpm vitest run tests/sanitize && pnpm scan`
Expected: tests PASS; `pnpm scan` exits 0 on an empty tree.

- [ ] **Step 7: Commit**

```bash
git add src/sanitize scripts/sanitize.ts scripts/scan-secrets.ts tests/
git commit -m "feat: add capture sanitizer with placeholder substitution and secret-scan gate"
```

---

### Task 5: Public OpenAPI index

**Files:**
- Create: `src/openapi/index.ts`, `scripts/fetch-openapi.ts`
- Test: `tests/openapi/index.test.ts`
- Fixture: `tests/fixtures/mini-openapi.yml` — about six operations, including `/contacts/{identifier}`, one operation with no `operationId`, and one with an `enum` parameter.

**Interfaces:**
- Consumes: nothing.
- Produces:

```ts
export type PublicApiOperation = {
  operationId: string | null; method: string; pathTemplate: string;
  required: string[]; enums: Record<string, string[]>; tags: string[];
};
export type PublicApiIndex = {
  operations: PublicApiOperation[];
  lookup(method: string, concretePath: string): PublicApiOperation | null;
};
export function buildPublicApiIndex(specYaml: string): PublicApiIndex;
export function pathTemplateToRegex(template: string): RegExp;
```

- [ ] **Step 1: Write the failing tests**

```ts
// tests/openapi/index.test.ts
it('indexes every operation in the spec', () => {
  expect(buildPublicApiIndex(miniSpec).operations).toHaveLength(6);
});
it('keeps a null operationId rather than inventing one', () => {
  expect(buildPublicApiIndex(miniSpec).operations.some(o => o.operationId === null)).toBe(true);
});
it('matches a concrete path against a templated one', () => {                  // Review Focus 4
  expect(index.lookup('GET', '/v3/contacts/42')?.pathTemplate).toBe('/contacts/{identifier}');
  expect(index.lookup('GET', '/v3/contacts/a%40b.com')?.operationId).toBeTypeOf('string');
});
it('does not match a path with an extra segment', () => {                      // Review Focus 4
  expect(index.lookup('GET', '/v3/contacts/42/extra')).toBeNull();
});
it('prefers an exact literal path over a templated match', () => {             // Review Focus 4
  expect(index.lookup('GET', '/v3/contacts/lists')?.pathTemplate).toBe('/contacts/lists');
});
it('is method-sensitive', () => {
  expect(index.lookup('DELETE', '/v3/contacts/42')).toBeNull();
});
it('collects enum values for a parameter', () => {
  expect(index.lookup('GET', '/v3/contacts')?.enums).toHaveProperty('sort');
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm vitest run tests/openapi`
Expected: FAIL — module unresolved.

- [ ] **Step 3: Implement `pathTemplateToRegex` and `buildPublicApiIndex` in `src/openapi/index.ts`**

Parse with `js-yaml`. `lookup` strips the `/v3` server prefix from the concrete path, then tries literal paths first and templated ones second, so `/contacts/lists` cannot be stolen by `/contacts/{identifier}`. `pathTemplateToRegex` replaces each `{param}` with `[^/]+` and anchors both ends — the anchoring is what makes the extra-segment test pass.

- [ ] **Step 4: Implement `scripts/fetch-openapi.ts`**

Downloads the spec URL to `data/brevo-openapi.yml` (committed — it is public and makes the pipeline reproducible offline per D14), builds the index, writes `data/public-api-index.json`. Prints the operation count. Add `pnpm fetch:openapi`.

- [ ] **Step 5: Run tests, then run the script against the real spec**

Run: `pnpm vitest run tests/openapi && pnpm fetch:openapi`
Expected: tests PASS; the script reports **292 operations across 208 paths**. A materially different count means Brevo changed the spec — record it in `docs/gaps.md` rather than silently accepting it.

- [ ] **Step 6: Commit**

```bash
git add src/openapi scripts/fetch-openapi.ts data/ tests/
git commit -m "feat: index Brevo public OpenAPI spec with path-template matching"
```

---

### Task 6: LLM provider interface, Groq and Claude CLI adapters

**Files:**
- Create: `src/providers/types.ts`, `src/providers/groq.ts`, `src/providers/claude-cli.ts`, `src/providers/json.ts`
- Test: `tests/providers/groq.test.ts`, `tests/providers/claude-cli.test.ts`, `tests/providers/json.test.ts`

**Interfaces:**
- Consumes: `Config` (Task 1).
- Produces:

```ts
export type CompletionRequest = { system: string; user: string; maxTokens?: number };
export type LlmProvider = { name: string; complete(req: CompletionRequest): Promise<string> };
export function createGroqProvider(opts: { apiKey: string; model: string; fetchImpl?: typeof fetch }): LlmProvider;
export function createClaudeCliProvider(opts?: { bin?: string; exec?: ExecFn }): LlmProvider;
export type ExecFn = (cmd: string, args: string[], stdin: string) => Promise<{ stdout: string; code: number }>;
export function extractJsonObject(raw: string): { ok: true; value: unknown } | { ok: false; reason: string };
```

Both adapters take their transport by injection (`fetchImpl`, `exec`) so every test runs offline.

- [ ] **Step 1: Write the failing tests**

```ts
// tests/providers/json.test.ts                                                 // Review Focus 3
it('parses a bare JSON object', () => {
  expect(extractJsonObject('{"a":1}')).toEqual({ ok: true, value: { a: 1 } });
});
it('extracts JSON from a markdown fence', () => {
  expect(extractJsonObject('Sure!\n```json\n{"a":1}\n```\n')).toEqual({ ok: true, value: { a: 1 } });
});
it('extracts JSON surrounded by prose', () => {
  expect(extractJsonObject('Here you go: {"a":1} — hope that helps')).toEqual({ ok: true, value: { a: 1 } });
});
it('reports a reason instead of throwing on prose with no JSON', () => {
  const r = extractJsonObject('I cannot help with that.');
  expect(r.ok).toBe(false);
  expect(() => extractJsonObject('I cannot help with that.')).not.toThrow();
});
it('picks the outermost object when braces nest', () => {
  expect(extractJsonObject('{"a":{"b":2}}')).toEqual({ ok: true, value: { a: { b: 2 } } });
});
```

```ts
// tests/providers/groq.test.ts
it('posts to the Groq chat completions endpoint with the model and bearer key', async () => { /* assert on the injected fetch call */ });
it('returns the first choice message content', async () => { /* 'hello' */ });
it('throws an error naming the status on a non-2xx response', async () => { /* /429/ */ });
```

```ts
// tests/providers/claude-cli.test.ts
it('invokes the claude binary with -p and passes the prompt on stdin', async () => { /* assert args contain '-p' */ });
it('throws when the CLI exits non-zero', async () => { /* rejects */ });
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm vitest run tests/providers`
Expected: FAIL — modules unresolved.

- [ ] **Step 3: Implement `extractJsonObject` in `src/providers/json.ts`**

Try `JSON.parse` on the whole string; else take the substring from the first `{` to the last `}` and parse that; else return `{ ok: false, reason }`. Never throws — the error path is a value, because it feeds the repair loop in Task 8.

- [ ] **Step 4: Implement the two adapters**

Groq posts to `https://api.groq.com/openai/v1/chat/completions` with `Authorization: Bearer`. The Claude adapter shells out to `claude -p --output-format json` and reads the result text out of the JSON envelope. Neither knows anything about actions — they move strings.

- [ ] **Step 5: Run tests to verify they pass**

Run: `pnpm vitest run tests/providers`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/providers tests/providers
git commit -m "feat: add LLM provider interface with Groq and Claude CLI adapters"
```

---

### Task 7: Login and crawl

**Files:**
- Create: `src/crawl/links.ts`, `src/crawl/recorder.ts`, `src/util/rate-limit.ts`, `scripts/login.ts`, `scripts/crawl.ts`
- Test: `tests/crawl/links.test.ts`, `tests/util/rate-limit.test.ts`

**Interfaces:**
- Consumes: `CaptureRecord`, `truncateBody` (Task 3); `Config` (Task 1).
- Produces:

```ts
export function extractNavLinks(html: string, origin: string): string[];
export function normalizeRoute(url: string): string;
export function createLimiter(minIntervalMs: number): <T>(fn: () => Promise<T>) => Promise<T>;
export function attachRecorder(page: Page, getRoute: () => string): CaptureRecord[];
```

- [ ] **Step 1: Write the failing tests**

```ts
// tests/crawl/links.test.ts
it('extracts same-origin hrefs from sidebar and tab markup', () => { /* 3 links */ });
it('excludes other origins', () => {
  expect(extractNavLinks('<a href="https://evil.test/x">x</a>', 'https://app.brevo.com')).toEqual([]);
});
it('excludes mailto, tel, javascript and anchor-only hrefs', () => { /* [] */ });
it('strips query strings and numeric ids when normalizing a route', () => {
  expect(normalizeRoute('https://app.brevo.com/contacts/list/8821?tab=x')).toBe('/contacts/list/:id');
});
it('deduplicates routes that differ only by id', () => {
  expect(new Set(['/contacts/list/1', '/contacts/list/2'].map(normalizeRoute)).size).toBe(1);
});
```

```ts
// tests/util/rate-limit.test.ts
it('spaces successive calls by at least the minimum interval', async () => {
  const limit = createLimiter(50);
  const t0 = Date.now();
  await Promise.all([limit(async () => 1), limit(async () => 2), limit(async () => 3)]);
  expect(Date.now() - t0).toBeGreaterThanOrEqual(100);
});
it('preserves each call\'s resolved value', async () => { /* [1,2,3] */ });
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm vitest run tests/crawl tests/util/rate-limit.test.ts`
Expected: FAIL — modules unresolved.

- [ ] **Step 3: Implement `extractNavLinks` and `normalizeRoute` in `src/crawl/links.ts`**

`normalizeRoute` replaces path segments that are all digits, or look like UUIDs or hashes, with `:id` — this is what keeps the BFS frontier finite.

- [ ] **Step 4: Implement `createLimiter` in `src/util/rate-limit.ts`**

A serial promise chain with a minimum spacing. Used with `minIntervalMs: 1000` to honour the 1 req/s constraint.

- [ ] **Step 5: Implement `attachRecorder` in `src/crawl/recorder.ts`**

Subscribes to Playwright's `requestfinished`, keeps only `xhr` and `fetch` resource types, and pushes a `CaptureRecord` with bodies passed through `truncateBody(…, 8192)`.

- [ ] **Step 6: Implement `scripts/login.ts`**

Launches headed Chromium, navigates to `https://app.brevo.com`, prints `Log in, then press Enter here.`, waits for stdin, then saves `context.storageState({ path: '.auth/state.json' })`. Add `pnpm login`.

- [ ] **Step 7: Implement `scripts/crawl.ts`**

Loads the storage state, BFS from the app root over `extractNavLinks` output, every navigation through the limiter, recording via `attachRecorder`. **Clicks nothing** — navigation only. Writes one JSON file per route into `captures/raw/`. Accepts `--max-routes` and `--out`. Add `pnpm crawl`.

- [ ] **Step 8: Run tests, then the real login and a short crawl**

Run: `pnpm vitest run` then `pnpm login` then `pnpm crawl --max-routes 5`
Expected: tests PASS; `captures/raw/` gains five route files with non-empty XHR arrays. **If login is blocked by 2FA, a captcha or bot detection, stop here and fall back to a manual DevTools HAR export through `parseHar` (Task 3) — the rest of the pipeline is unchanged.** Record which path was taken in `docs/gaps.md`.

- [ ] **Step 9: Sanitize the captures and commit the clean set as offline fixtures**

Run: `pnpm sanitize && pnpm scan`
Expected: `captures/clean/` mirrors `captures/raw/` with placeholders substituted, and `pnpm scan` exits 0. These committed clean captures are what make stages 4–8 runnable offline by a third party (D14) and what `verification.evidence` points at (D9). `captures/raw/` stays ignored.

- [ ] **Step 10: Commit**

```bash
git add src/crawl src/util/rate-limit.ts scripts/login.ts scripts/crawl.ts tests/ captures/clean/
git commit -m "feat: add authenticated BFS crawler with 1 req/s limit and XHR recording"
```

---

### Task 8: Clustering and LLM extraction

**Files:**
- Create: `src/extract/cluster.ts`, `src/extract/prompt.ts`, `src/extract/draft.ts`, `scripts/extract.ts`
- Test: `tests/extract/cluster.test.ts`, `tests/extract/draft.test.ts`

**Interfaces:**
- Consumes: `CaptureRecord` (Task 3), `normalizeRoute` + `createLimiter` (Task 7), `PublicApiIndex` + `PublicApiOperation` (Task 5), `LlmProvider` + `CompletionRequest` + `extractJsonObject` (Task 6), `ActionSchema` + `Action` (Task 2).
- Produces:

```ts
export type ActionCandidate = {
  key: string; route: string; method: string; pathTemplate: string;
  samples: CaptureRecord[];
};
export function clusterCaptures(records: CaptureRecord[]): ActionCandidate[];
export function buildDraftPrompt(c: ActionCandidate, op: PublicApiOperation | null): CompletionRequest;
export type DraftResult =
  | { ok: true; action: Action }
  | { ok: false; errors: string[]; raw: string };
export function draftAction(
  c: ActionCandidate, op: PublicApiOperation | null, provider: LlmProvider, attempts?: number
): Promise<DraftResult>;
```

- [ ] **Step 1: Write the failing tests**

```ts
// tests/extract/cluster.test.ts
it('groups captures sharing method and normalized path into one candidate', () => {
  expect(clusterCaptures([postContacts1, postContacts2])).toHaveLength(1);
});
it('keeps different methods on the same path as separate candidates', () => { /* 2 */ });
it('drops analytics, telemetry and asset requests', () => {
  expect(clusterCaptures([segmentIoCall, datadogCall, fontRequest])).toEqual([]);
});
it('drops polling GETs that returned no body', () => { /* [] */ });
it('retains up to three samples per candidate and no more', () => { /* samples.length === 3 */ });
```

```ts
// tests/extract/draft.test.ts
it('includes the public operationId and enums in the prompt when the spec matched', () => {
  expect(buildDraftPrompt(candidate, op).user).toContain('createContact');
});
it('states the fail-safe rule in the prompt when nothing is verified', () => {
  expect(buildDraftPrompt(candidate, null).system).toMatch(/destructive/i);
});
it('returns ok with a parsed action when the provider returns valid JSON', async () => { /* ok true */ });
it('retries once when the first response fails schema validation', async () => {
  // provider returns an action with a bad id, then a good one; expect 2 calls and ok: true
});
it('returns the ajv errors and the raw text when every attempt fails', async () => {
  expect((await draftAction(c, null, alwaysProse)).ok).toBe(false);   // Review Focus 3
});
it('never returns an action that fails ActionSchema', async () => { /* property-style check over several bad payloads */ });
it('forces the fail-safe flags on an unverified non-read action', async () => {
  // provider returns destructive: false, idempotent: true for a POST candidate
  const r = await draftAction(postCandidate, null, overclaims);
  expect(r.ok && r.action.destructive).toBe(true);
  expect(r.ok && r.action.idempotent).toBe(false);
});
it('leaves the flags alone for a read action', async () => { /* GET candidate keeps destructive: false */ });
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm vitest run tests/extract`
Expected: FAIL — modules unresolved.

- [ ] **Step 3: Implement `clusterCaptures` in `src/extract/cluster.ts`**

Key is `method + ' ' + normalizeRoute(url)`. Noise filter: host not the app origin, or path matching known analytics vendors (`segment`, `datadog`, `sentry`, `intercom`, `hotjar`, `google-analytics`), or a static-asset extension, or a GET with an empty response body.

- [ ] **Step 4: Implement `buildDraftPrompt` in `src/extract/prompt.ts`**

The system prompt states the schema contract, the §7.2 status rules, the D7 description style (trigger conditions plus disambiguation against neighbours), and the D17 fail-safe rule. The user prompt carries the candidate's route, method, path, up to three sanitized samples, and — when the spec matched — the `operationId`, required fields and enums as **authoritative over anything inferred from the samples**.

- [ ] **Step 5: Implement `draftAction` in `src/extract/draft.ts`**

Call the provider, run `extractJsonObject`, validate with `ActionSchema`, and on failure retry once with the validation errors appended to the user prompt. Exhausted attempts return `{ ok: false }` — never a half-valid action. Default `attempts: 2`. After validation, **overwrite** `destructive` and `idempotent` with the D17 fail-safe values for any non-GET candidate: the prompt asks the model to respect the rule, this enforces it in code, because a model that quietly claims `destructive: false` is the single most expensive error the catalog can ship.

- [ ] **Step 6: Implement `scripts/extract.ts`**

Reads `captures/clean/`, clusters, loads `data/public-api-index.json`, and drafts with the provider chosen by `--provider groq|claude` (default `groq`), paced by the limiter to respect Groq rate limits. Writes each success to `actions/<id>.json` and every failure to `data/extract-failures.json`. Add `pnpm extract`.

- [ ] **Step 7: Run tests, then extract from the captures on hand**

Run: `pnpm vitest run tests/extract && pnpm extract --provider groq`
Expected: tests PASS; `actions/` populated; the failure count printed and non-fatal.

- [ ] **Step 8: Commit**

```bash
git add src/extract scripts/extract.ts tests/extract
git commit -m "feat: cluster captures and draft schema-valid actions via LLM with repair loop"
```

---

### Task 9: Catalog validation and index

**Files:**
- Create: `src/catalog/validate.ts`, `src/catalog/index-build.ts`, `scripts/validate.ts`, `scripts/build-index.ts`
- Test: `tests/catalog/validate.test.ts`, `tests/catalog/index-build.test.ts`

**Interfaces:**
- Consumes: `Action`, `VerificationStatus`, `schema/action.schema.json` (Task 2).
- Produces:

```ts
export function validateAction(value: unknown): { ok: true; action: Action } | { ok: false; errors: string[] };
export type CatalogIndexEntry = { id: string; module: string; name: string; description: string; status: VerificationStatus; destructive: boolean };
export type CatalogIndex = { generated_at: string; count: number; by_status: Record<VerificationStatus, number>; actions: CatalogIndexEntry[] };
export function buildIndex(actions: Action[]): CatalogIndex;
```

- [ ] **Step 1: Write the failing tests**

```ts
// tests/catalog/validate.test.ts
it('accepts a valid action', () => { /* ok true */ });
it('returns readable ajv errors for a malformed action', () => {
  const r = validateAction({ id: 'bad id' });
  expect(r.ok).toBe(false);
  expect(r.errors.join(' ')).toMatch(/id/);
});
```

```ts
// tests/catalog/index-build.test.ts
it('counts actions by verification status', () => {
  expect(buildIndex([verifiedA, inferredB]).by_status).toEqual({ verified: 1, observed: 0, inferred: 1 });
});
it('throws naming the duplicated id when two actions share one', () => {       // Review Focus 5
  expect(() => buildIndex([a, { ...a, name: 'Other' }])).toThrow(/contacts\.create_contact/);
});
it('sorts entries by id so the file is diff-stable', () => { /* ascending */ });
it('carries description and destructive into the index', () => { /* both present */ });
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm vitest run tests/catalog`
Expected: FAIL — modules unresolved.

- [ ] **Step 3: Implement `validateAction` in `src/catalog/validate.ts`**

ajv with `ajv-formats`, compiled once against the committed JSON Schema, errors flattened to `instancePath: message` strings.

- [ ] **Step 4: Implement `buildIndex` in `src/catalog/index-build.ts`**

Duplicate ids throw rather than overwrite — the loud failure in Review Focus 5. Entries sorted by `id`.

- [ ] **Step 5: Implement the two scripts**

`scripts/validate.ts` validates every file in `actions/` and exits non-zero on any failure. `scripts/build-index.ts` writes `actions/index.json`. Add `pnpm validate` and `pnpm build:index`.

- [ ] **Step 6: Run tests and both scripts**

Run: `pnpm vitest run tests/catalog && pnpm validate && pnpm build:index`
Expected: tests PASS; `pnpm validate` exits 0; `actions/index.json` written with a status breakdown.

- [ ] **Step 7: Commit**

```bash
git add src/catalog scripts/validate.ts scripts/build-index.ts actions/index.json tests/catalog
git commit -m "feat: add ajv catalog gate and diff-stable catalog index"
```

---

### Task 10: Interaction passes for write actions

**Files:**
- Create: `src/interact/types.ts`, `src/interact/contacts.ts`, `scripts/interact.ts`
- Test: `tests/interact/fixtures.test.ts`

**Interfaces:**
- Consumes: `attachRecorder` (Task 7), `createLimiter` (Task 7).
- Produces:

```ts
export type FixtureBag = { email(): string; listName(): string; created: string[] };
export type InteractionPass = { module: string; run(page: Page, fx: FixtureBag): Promise<void> };
export function createFixtureBag(seed?: string): FixtureBag;
export const contactsPass: InteractionPass;
```

- [ ] **Step 1: Write the failing test**

```ts
// tests/interact/fixtures.test.ts
it('namespaces every generated fixture so it is identifiable as ours', () => {
  const fx = createFixtureBag('abc');
  expect(fx.email()).toMatch(/^catalog-test-/);
  expect(fx.listName()).toMatch(/^catalog-test-/);
});
it('generates a distinct value on each call', () => {
  const fx = createFixtureBag('abc');
  expect(fx.email()).not.toBe(fx.email());
});
it('records everything it generated for later cleanup', () => {
  const fx = createFixtureBag('abc'); fx.email(); fx.listName();
  expect(fx.created).toHaveLength(2);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run tests/interact`
Expected: FAIL — module unresolved.

- [ ] **Step 3: Implement `createFixtureBag` in `src/interact/types.ts`**

Every fixture is prefixed `catalog-test-` so anything left in the account is unambiguously the harness's and never pre-existing data — the enforcement point for the D11 mutation bounds.

- [ ] **Step 4: Implement `contactsPass` in `src/interact/contacts.ts`**

Drives the contacts UI to create a contact and a list and add the contact to it, with the recorder attached so the write requests are captured. Submits the create form once with an empty required field first, so the validation response — the best available evidence for `required` and `enum` — is captured too.

- [ ] **Step 5: Implement `scripts/interact.ts`**

Loads the storage state, runs the passes named by `--modules` (default: all registered), writes captures into `captures/raw/interact/`. Add `pnpm interact`.

- [ ] **Step 6: Run the test and one real pass**

Run: `pnpm vitest run tests/interact && pnpm interact --modules contacts`
Expected: test PASSES; `captures/raw/interact/` contains POST/PUT records with real request bodies; the account contains only `catalog-test-*` artifacts.

- [ ] **Step 7: Commit**

```bash
git add src/interact scripts/interact.ts tests/interact
git commit -m "feat: add interaction passes that capture write requests via throwaway fixtures"
```

**Note for the executor:** which further modules get a pass (campaigns, lists, templates, automation) is an in-flight decision per spec §8. Add each as a new `InteractionPass` in its own file and register it; no other code changes.

---

### Task 11: Verification harness

**Files:**
- Create: `src/verify/harness.ts`, `src/verify/recipes/contacts.ts`, `scripts/verify.ts`
- Test: `tests/verify/harness.test.ts`

**Interfaces:**
- Consumes: `Action` (Task 2), `CaptureRecord` (Task 3), `normalizeRoute` + `attachRecorder` (Task 7), `FixtureBag` (Task 10), `validateAction` (Task 9).
- Produces:

```ts
export type VerifyRecipe = { actionId: string; run(page: Page, fx: FixtureBag): Promise<void>; cleanup?(page: Page, fx: FixtureBag): Promise<void> };
export type VerifyOutcome =
  | { status: 'verified'; evidence: string[]; verified_at: string }
  | { status: 'observed'; evidence: string[]; reason: string };
export function assessOutcome(action: Action, observed: CaptureRecord[]): VerifyOutcome;
export function applyOutcome(action: Action, outcome: VerifyOutcome): Action;
```

- [ ] **Step 1: Write the failing tests**

```ts
// tests/verify/harness.test.ts
it('returns verified when the observed request matches the claimed method and path', () => {
  expect(assessOutcome(action, [matchingCapture]).status).toBe('verified');
});
it('returns observed with a reason when nothing matching was executed', () => {
  const o = assessOutcome(action, []);
  expect(o.status).toBe('observed');
  expect(o.reason).toBeTruthy();
});
it('returns observed when the request ran but responded 4xx', () => {
  expect(assessOutcome(action, [{ ...matchingCapture, status: 422 }]).status).toBe('observed');
});
it('stamps an ISO verified_at and non-empty evidence on a verified outcome', () => { /* parseable date, evidence.length > 0 */ });
it('leaves the action schema-valid after applying an outcome', () => {
  expect(validateAction(applyOutcome(action, verifiedOutcome)).ok).toBe(true);
});
it('clears the fail-safe destructive flag only when execution proves it', () => {
  // a verified read action may become destructive: false; an unverified one stays true
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm vitest run tests/verify`
Expected: FAIL — module unresolved.

- [ ] **Step 3: Implement `assessOutcome` and `applyOutcome` in `src/verify/harness.ts`**

A `verified` outcome requires a captured request whose method and normalized path match `internal_endpoint` **and** whose status is 2xx. Everything else is `observed` with a stated reason — this is where "partial execution does not earn verified" is enforced in code rather than in prose.

- [ ] **Step 4: Implement `src/verify/recipes/contacts.ts`**

One recipe per chosen core action, each driving the real UI and cleaning up its own fixtures. The recipe list is deliberately thin until the catalogue exists (spec D3).

- [ ] **Step 5: Implement `scripts/verify.ts`**

Loads the storage state, runs the recipes named by `--actions` (default: all registered), re-writes each `actions/<id>.json` through `applyOutcome`, runs cleanup, and prints a verified/observed summary. Add `pnpm verify`.

- [ ] **Step 6: Run tests and verify one real action**

Run: `pnpm vitest run tests/verify && pnpm verify --actions contacts.create_contact`
Expected: tests PASS; that action's file shows `verification.status: "verified"` with evidence and a timestamp; no `catalog-test-*` fixtures left behind.

- [ ] **Step 7: Commit**

```bash
git add src/verify scripts/verify.ts tests/verify
git commit -m "feat: add UI-driven verification harness that stamps verified status with evidence"
```

---

### Task 12: Selection eval

**Files:**
- Create: `src/eval/selection.ts`, `data/eval-tasks.json`, `scripts/eval-selection.ts`
- Test: `tests/eval/selection.test.ts`

**Interfaces:**
- Consumes: `CatalogIndex` (Task 9), `LlmProvider` + `extractJsonObject` (Task 6).
- Produces:

```ts
export type EvalTask = { prompt: string; expectedActionId: string; expectedInputs?: Record<string, unknown> };
export type EvalCase = { task: EvalTask; chosenActionId: string | null; correct: boolean; inputsCorrect: boolean | null };
export type EvalReport = { total: number; correct: number; inputsCorrect: number; cases: EvalCase[] };
export function scoreSelection(tasks: EvalTask[], index: CatalogIndex, provider: LlmProvider): Promise<EvalReport>;
```

- [ ] **Step 1: Write the failing tests**

```ts
// tests/eval/selection.test.ts
it('scores a correct selection as correct', async () => {
  expect((await scoreSelection([task], index, picks('contacts.create_contact'))).correct).toBe(1);
});
it('scores a wrong selection as incorrect and records what was chosen', async () => {
  const r = await scoreSelection([task], index, picks('contacts.delete_contact'));
  expect(r.correct).toBe(0);
  expect(r.cases[0].chosenActionId).toBe('contacts.delete_contact');
});
it('treats an id that is not in the catalog as incorrect, not an error', async () => {
  expect((await scoreSelection([task], index, picks('made.up_action'))).cases[0].correct).toBe(false);
});
it('records null chosenActionId when the model returns unparseable output', async () => {  // Review Focus 3
  expect((await scoreSelection([task], index, alwaysProse)).cases[0].chosenActionId).toBeNull();
});
it('checks expected inputs when the task declares them', async () => { /* inputsCorrect true */ });
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm vitest run tests/eval`
Expected: FAIL — module unresolved.

- [ ] **Step 3: Implement `scoreSelection` in `src/eval/selection.ts`**

Prompt carries `actions/index.json` and one task, and asks for `{ "action_id": ..., "inputs": {...} }`. An unparseable response is a scored failure, not a thrown error — the eval must survive a bad response and report it.

- [ ] **Step 4: Write `data/eval-tasks.json`**

Twenty tasks phrased the way a user would phrase them ("add john@example.com to my newsletter list", "send the Friday promo to subscribers"), deliberately **not** reusing the catalog's own description wording — otherwise the eval tests retrieval of its own phrasing rather than comprehension. Include at least three pairs that are easy to confuse (create versus update contact, send now versus schedule).

- [ ] **Step 5: Implement `scripts/eval-selection.ts`**

Runs the eval with `--provider`, prints the score, writes `data/eval-report.json`. Add `pnpm eval`.

- [ ] **Step 6: Run tests and the real eval**

Run: `pnpm vitest run tests/eval && pnpm eval --provider groq`
Expected: tests PASS; a score printed. **Every failing case is a Reliability bug in a description — fix the description, re-run, and record both numbers.** The before/after pair is the most valuable line in the write-up.

- [ ] **Step 7: Commit**

```bash
git add src/eval scripts/eval-selection.ts data/eval-tasks.json tests/eval
git commit -m "feat: add selection eval measuring whether a model resolves tasks to the right action"
```

---

### Task 13: Documentation and delivery

**Files:**
- Create: `docs/modules.md`, `docs/approach.md`, `docs/decisions.md`, `docs/ai-usage.md`, `docs/gaps.md`, `docs/eval.md`, `src/docs/modules.ts`, `scripts/build-modules-doc.ts`
- Modify: `README.md`
- Test: `tests/docs/modules.test.ts`

**Interfaces:**
- Consumes: `CatalogIndex` (Task 9), `EvalReport` (Task 12).
- Produces: `buildModulesDoc(index: CatalogIndex, routes: string[]): string`.

- [ ] **Step 1: Write the failing test**

```ts
// tests/docs/modules.test.ts
it('groups actions under a heading per module', () => {
  expect(buildModulesDoc(index, routes)).toMatch(/## contacts/);
});
it('shows each action\'s verification status', () => {
  expect(buildModulesDoc(index, routes)).toContain('verified');
});
it('lists discovered routes that produced no action', () => {
  expect(buildModulesDoc(index, ['/unmapped'])).toContain('/unmapped');
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run tests/docs`
Expected: FAIL — module unresolved.

- [ ] **Step 3: Implement `buildModulesDoc` in `src/docs/modules.ts` and `scripts/build-modules-doc.ts`**

Generated, not hand-written, so it cannot drift from the catalog. Unmapped routes are listed explicitly — they are the honest coverage boundary. Add `pnpm build:docs`.

- [ ] **Step 4: Write `README.md`**

The reviewer's entry point, in this order: what this is; how to read the catalog; **the §7.2 confidence table verbatim**; the D17 fail-safe rule; the pipeline diagram; what is verified versus observed versus inferred, with counts; how to run each stage and which stages need the author's own account; and links to the four `docs/` write-ups and the design document.

- [ ] **Step 5: Write `docs/decisions.md`**

One entry per decision from spec §6, each with: the decision, the alternatives rejected, why, and **the cost accepted**. The entries that must be there because they will be probed on the call: why not just use the public API (D6 and the 79-of-292 finding); why UI execution over endpoint replay (D12); why two model providers (D5); why no MCP server (D4); why fail-safe flags (D17).

- [ ] **Step 6: Write `docs/approach.md`, `docs/ai-usage.md`, `docs/gaps.md`, `docs/eval.md`**

`approach.md`: how the problem was framed, what was prioritized and why; links to `decisions.md` rather than repeating it. `ai-usage.md`: Groq for breadth and headless Claude Code for judgment, the prompt-repair loop, and concretely what the models got wrong and what was corrected by hand. `gaps.md`: the uncovered surface named explicitly — automation, landing pages, forms, meetings, push; the partner/reseller exclusion; which capture path was used; what more time would buy. `eval.md`: the selection-eval numbers before and after description fixes, and what the failures taught.

- [ ] **Step 7: Run the full gate before pushing**

Run: `pnpm vitest run && pnpm typecheck && pnpm validate && pnpm build:index && pnpm build:docs && pnpm scan`
Expected: all PASS, and **`pnpm scan` exits 0** — this is the last line of defence before the repository becomes public.

- [ ] **Step 8: Commit and push**

```bash
git add docs/ README.md scripts/build-modules-doc.ts tests/docs
git commit -m "docs: add README, decision record, approach, AI usage, gaps and eval write-ups"
gh repo create brevo-agent-catalog --public --source=. --remote=origin --push
```

- [ ] **Step 9: Confirm nothing secret reached the remote**

Run: `git ls-files | grep -E '^(\.env|\.auth/|captures/raw/)' || echo CLEAN`
Expected: `CLEAN`.

---

## Stretch, not planned

The MCP server (spec D4) is deliberately not a task. If Tasks 1–13 are done and the write-ups are drafted, it is roughly a hundred lines over `actions/index.json` exposing `search_actions`, `get_action` and `list_modules` — and then there is a live demo for the 30-minute call. If it is not built, `docs/gaps.md` names it as the next step and nothing in the submission is missing.
