/**
 * Deterministic enrichment from Brevo's published OpenAPI specification.
 *
 * Where an internal endpoint seen in the app maps onto a public operation, the
 * entry inherits real typed inputs, enums and required fields instead of
 * anything a model inferred — and `public_api` fills itself.
 *
 * The matching is the part that earns its keep: the spec declares
 * `/contacts/{identifier}` while a capture shows `/contacts/42`. A naive string
 * compare reports "no public API" for nearly every operation and silently
 * destroys the enrichment this whole stage exists for.
 */

import { load } from 'js-yaml';
import { escapeRegExp } from '../sanitize/patterns.js';

export type PublicApiOperation = {
  operationId: string | null;
  method: string;
  pathTemplate: string;
  required: string[];
  enums: Record<string, string[]>;
  tags: string[];
};

export type PublicApiIndex = {
  operations: PublicApiOperation[];
  lookup(method: string, concretePath: string): PublicApiOperation | null;
};

const METHODS = new Set(['get', 'post', 'put', 'patch', 'delete', 'head', 'options']);

/** Server prefixes stripped before matching, longest first. */
const SERVER_PREFIXES = ['/v3'];

type SchemaNode = {
  required?: unknown;
  properties?: Record<string, { enum?: unknown }> | undefined;
};

type ParameterNode = {
  name?: unknown;
  required?: unknown;
  schema?: { enum?: unknown } | undefined;
};

type OperationNode = {
  operationId?: unknown;
  tags?: unknown;
  parameters?: unknown;
  requestBody?: {
    content?: Record<string, { schema?: SchemaNode }> | undefined;
  };
};

/**
 * Compiles an OpenAPI path template into an anchored regex whose parameters
 * match exactly one path segment.
 */
export function pathTemplateToRegex(template: string): RegExp {
  const pattern = template
    .split(/(\{[^}]+\})/)
    .map((part) => (/^\{[^}]+\}$/.test(part) ? '[^/]+' : escapeRegExp(part)))
    .join('');
  return new RegExp(`^${pattern}$`);
}

function isTemplated(template: string): boolean {
  return template.includes('{');
}

function bodySchema(operation: OperationNode): SchemaNode | null {
  const content = operation.requestBody?.content;
  if (!content) return null;
  for (const media of Object.values(content)) {
    if (media?.schema) return media.schema;
  }
  return null;
}

function collectRequired(operation: OperationNode): string[] {
  const required = new Set<string>();

  if (Array.isArray(operation.parameters)) {
    for (const parameter of operation.parameters as ParameterNode[]) {
      if (parameter?.required === true && typeof parameter.name === 'string') {
        required.add(parameter.name);
      }
    }
  }

  const schema = bodySchema(operation);
  if (schema && Array.isArray(schema.required)) {
    for (const field of schema.required) {
      if (typeof field === 'string') required.add(field);
    }
  }

  return [...required];
}

function collectEnums(operation: OperationNode): Record<string, string[]> {
  const enums: Record<string, string[]> = {};

  const record = (name: unknown, values: unknown): void => {
    if (typeof name !== 'string' || !Array.isArray(values)) return;
    const strings = values.filter((v): v is string => typeof v === 'string');
    if (strings.length > 0) enums[name] = strings;
  };

  if (Array.isArray(operation.parameters)) {
    for (const parameter of operation.parameters as ParameterNode[]) {
      record(parameter?.name, parameter?.schema?.enum);
    }
  }

  const properties = bodySchema(operation)?.properties;
  if (properties) {
    for (const [name, property] of Object.entries(properties)) {
      record(name, property?.enum);
    }
  }

  return enums;
}

/** Reduces a captured url or path to a bare, prefix-stripped path. */
function normalizePath(concretePath: string): string {
  let path = concretePath;

  try {
    path = new URL(concretePath).pathname;
  } catch {
    const queryAt = path.indexOf('?');
    if (queryAt !== -1) path = path.slice(0, queryAt);
  }

  for (const prefix of SERVER_PREFIXES) {
    if (path.startsWith(`${prefix}/`) || path === prefix) {
      path = path.slice(prefix.length) || '/';
      break;
    }
  }

  return path;
}

export function buildPublicApiIndex(specYaml: string): PublicApiIndex {
  const spec = load(specYaml) as { paths?: Record<string, Record<string, unknown>> };
  const paths = spec?.paths;

  if (!paths || typeof paths !== 'object') {
    throw new Error('Not an OpenAPI document: expected a top-level `paths` object.');
  }

  const operations: PublicApiOperation[] = [];

  for (const [pathTemplate, pathItem] of Object.entries(paths)) {
    for (const [method, node] of Object.entries(pathItem ?? {})) {
      if (!METHODS.has(method.toLowerCase())) continue;
      const operation = (node ?? {}) as OperationNode;

      operations.push({
        operationId: typeof operation.operationId === 'string' ? operation.operationId : null,
        method: method.toUpperCase(),
        pathTemplate,
        required: collectRequired(operation),
        enums: collectEnums(operation),
        tags: Array.isArray(operation.tags)
          ? (operation.tags as unknown[]).filter((t): t is string => typeof t === 'string')
          : [],
      });
    }
  }

  // Literal paths are checked before templated ones, so `/contacts/lists` is
  // never stolen by `/contacts/{identifier}`.
  const literal = operations.filter((o) => !isTemplated(o.pathTemplate));
  const templated = operations
    .filter((o) => isTemplated(o.pathTemplate))
    .map((operation) => ({ operation, pattern: pathTemplateToRegex(operation.pathTemplate) }));

  return {
    operations,
    lookup(method: string, concretePath: string): PublicApiOperation | null {
      const wanted = method.toUpperCase();
      const path = normalizePath(concretePath);

      const exact = literal.find((o) => o.method === wanted && o.pathTemplate === path);
      if (exact) return exact;

      const matched = templated.find(
        ({ operation, pattern }) => operation.method === wanted && pattern.test(path),
      );
      return matched?.operation ?? null;
    },
  };
}
