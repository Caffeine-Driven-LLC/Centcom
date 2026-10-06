/** Read-side check of a 2xx response body against the generated shape of its OpenAPI schema.
 *  Tolerant by design (CT-VER "Unknown data"): unknown fields and unknown enum values pass; missing required fields and wrong types fail.
 *  Must not: return or log any part of the value, only the JSON pointer where it went wrong. */
import { RESPONSE_SCHEMAS } from './generated/operations.js';
import type { Shape } from './spec.js';

const MAX_DEPTH = 64;
const esc = (k: string) => k.replace(/~/g, '~0').replace(/\//g, '~1');
const typeOk = (t: string, v: unknown): boolean => {
  switch (t) {
    case 'object': return v !== null && typeof v === 'object' && !Array.isArray(v);
    case 'array': return Array.isArray(v);
    case 'string': return typeof v === 'string';
    case 'integer': return typeof v === 'number' && Number.isInteger(v);
    case 'number': return typeof v === 'number' && Number.isFinite(v);
    case 'boolean': return typeof v === 'boolean';
    case 'null': return v === null;
    default: return true; /* a type this checker does not know is not the reader's problem */
  }
};

/** Returns null when the value fits, else the JSON pointer of the first problem. */
export function checkShape(s: Shape, v: unknown, schemas: Readonly<Record<string, Shape>> = RESPONSE_SCHEMAS, at = '', depth = 0): string | null {
  if (depth > MAX_DEPTH) return at || '/';
  if (s.ref !== undefined) { const t = schemas[s.ref]; return t ? checkShape(t, v, schemas, at, depth + 1) : null; }
  if ('const' in s && s.const !== v) return at;
  if (s.type && !s.type.some((t) => typeOk(t, v))) return at;
  if (s.allOf) for (const x of s.allOf) { const p = checkShape(x, v, schemas, at, depth + 1); if (p !== null) return p; }
  if (s.anyOf && !s.anyOf.some((x) => checkShape(x, v, schemas, at, depth + 1) === null)) return at;
  if (v !== null && typeof v === 'object' && !Array.isArray(v)) {
    const o = v as Record<string, unknown>;
    for (const k of s.required ?? []) if (!Object.prototype.hasOwnProperty.call(o, k)) return `${at}/${esc(k)}`;
    for (const [k, ps] of Object.entries(s.properties ?? {})) if (Object.prototype.hasOwnProperty.call(o, k)) { const p = checkShape(ps, o[k], schemas, `${at}/${esc(k)}`, depth + 1); if (p !== null) return p; }
    if (s.additionalProperties) for (const [k, x] of Object.entries(o)) if (!s.properties || !(k in s.properties)) { const p = checkShape(s.additionalProperties, x, schemas, `${at}/${esc(k)}`, depth + 1); if (p !== null) return p; }
  }
  if (Array.isArray(v) && s.items) for (let i = 0; i < v.length; i++) { const p = checkShape(s.items, v[i], schemas, `${at}/${i}`, depth + 1); if (p !== null) return p; }
  return null;
}
