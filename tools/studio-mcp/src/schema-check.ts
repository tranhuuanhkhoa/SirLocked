/**
 * Local copy of the server's schema check (JsonSchema.Net, draft 2020-12, formats not enforced): the same answer
 * that passes here passes there, and errors come back as "$.path[0].field: reason (keyword)" like the server's.
 */
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
// ajv ships CommonJS; the 2020-12 build matches the server's dialect.
const Ajv2020 = require('ajv/dist/2020').default as new (options: Record<string, unknown>) => any;

export interface SchemaCheckResult {
  valid: boolean;
  errors: string[];
  errorCount: number;
}

const cache = new Map<string, any>();

function compile(schema: unknown): any {
  const key = JSON.stringify(schema);
  let validate = cache.get(key);
  if (!validate) {
    const ajv = new Ajv2020({ allErrors: true, strict: false, validateFormats: false, allowUnionTypes: true });
    const copy = typeof schema === 'object' && schema ? { ...(schema as Record<string, unknown>) } : schema;
    // The server ignores $schema dialect hints (always 2020-12); a draft-07 hint must not make ajv refuse the schema.
    if (copy && typeof copy === 'object') delete (copy as Record<string, unknown>).$schema;
    validate = ajv.compile(copy);
    if (cache.size > 64) cache.clear();
    cache.set(key, validate);
  }
  return validate;
}

/** "/stages/0/title" -> "$.stages[0].title" */
export function toPath(pointer: string): string {
  if (!pointer) return '$';
  return '$' + pointer.split('/').slice(1).map((raw) => {
    const part = raw.replace(/~1/g, '/').replace(/~0/g, '~');
    return /^\d+$/.test(part) ? `[${part}]` : /^[A-Za-z_$][\w$]*$/.test(part) ? `.${part}` : `['${part}']`;
  }).join('');
}

function describe(error: any): string {
  const where = toPath(error.instancePath ?? '');
  switch (error.keyword) {
    case 'required':
      return `${toPath(`${error.instancePath ?? ''}/${error.params.missingProperty}`)}: missing required property (required)`;
    case 'additionalProperties':
      return `${toPath(`${error.instancePath ?? ''}/${error.params.additionalProperty}`)}: property is not allowed (additionalProperties)`;
    case 'enum':
      return `${where}: must be one of ${JSON.stringify(error.params.allowedValues).slice(0, 200)} (enum)`;
    case 'const':
      return `${where}: must be ${JSON.stringify(error.params.allowedValue)} (const)`;
    default:
      return `${where}: ${error.message ?? 'is invalid'} (${error.keyword})`;
  }
}

export function checkAgainstSchema(schema: unknown, answer: unknown, maxErrors = 40): SchemaCheckResult {
  if (answer === null || typeof answer !== 'object' || Array.isArray(answer)) {
    return { valid: false, errors: ['$: the answer must be exactly one JSON object'], errorCount: 1 };
  }
  if (!schema || (typeof schema === 'object' && Object.keys(schema as object).length === 0)) {
    return { valid: true, errors: [], errorCount: 0 };
  }
  const validate = compile(schema);
  if (validate(answer)) return { valid: true, errors: [], errorCount: 0 };
  const seen = new Set<string>();
  const errors: string[] = [];
  for (const error of validate.errors ?? []) {
    // anyOf/oneOf branches repeat the same failure several times: keep each line once.
    const line = describe(error);
    if (seen.has(line)) continue;
    seen.add(line);
    errors.push(line);
  }
  return { valid: false, errors: errors.slice(0, maxErrors), errorCount: errors.length };
}
