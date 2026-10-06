/** Builds deterministic example data from an OpenAPI/JSON schema, so every operation can answer with something valid. */
import type { Rng } from '../core/prng.js';

type S = Record<string, any>;
export interface GenCtx { doc: S; rng: Rng; now: () => number; maxDepth?: number }

const ULID = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
export const resolve = (doc: S, ref: string): S => { let cur: any = doc; for (const p of ref.replace(/^#\//, '').split('/')) cur = cur?.[p.replace(/~1/g, '/').replace(/~0/g, '~')]; if (!cur) throw new Error('unresolvable $ref ' + ref); return cur; };
export function deref(doc: S, s: S): S { let x = s; for (let i = 0; i < 20 && x && x.$ref; i++) x = resolve(doc, x.$ref); return x; }

/** A tiny generator for the regex subset the contract uses: literals, [classes], \d \w, groups, |, ?, +, *, {n}, {n,m}. */
export function fromPattern(pattern: string, rng: Rng): string {
  let i = 0; const src = pattern.replace(/^\^/, '').replace(/\$$/, '');
  const classOf = (body: string): string[] => {
    const out: string[] = []; const neg = body.startsWith('^'); const b = neg ? body.slice(1) : body;
    for (let k = 0; k < b.length; k++) { let c = b[k]!; if (c === '\\') { const e = b[++k]!; if (e === 'd') { for (const d of '0123456789') out.push(d); continue; } if (e === 'w') { for (const d of 'abcdefghijklmnopqrstuvwxyz0123456789_') out.push(d); continue; } c = e; } if (b[k + 1] === '-' && b[k + 2] !== undefined) { const to = b[k + 2]!; for (let x = c.charCodeAt(0); x <= to.charCodeAt(0); x++) out.push(String.fromCharCode(x)); k += 2; } else out.push(c); }
    if (!neg) return out; const all = [...'abcdefghijklmnopqrstuvwxyz0123456789']; return all.filter((x) => !out.includes(x));
  };
  function seq(): string {
    let out = '';
    while (i < src.length && src[i] !== ')' && src[i] !== '|') {
      let unit: () => string; const c = src[i]!;
      if (c === '(') { i++; if (src.slice(i, i + 2) === '?:') i += 2; const alts: string[][] = [[]]; const start = i; let depth = 1; let j = i; while (j < src.length && depth) { if (src[j] === '(') depth++; else if (src[j] === ')') depth--; j++; } const inner = src.slice(start, j - 1); i = j;
        const parts = splitAlt(inner); void alts; unit = () => fromPattern(parts[rng.int(parts.length)]!.replace(/^/, '^'), rng); }
      else if (c === '[') { const end = src.indexOf(']', i + 1); const set = classOf(src.slice(i + 1, end)); i = end + 1; unit = () => set[rng.int(set.length)]!; }
      else if (c === '\\') { const e = src[i + 1]!; i += 2; unit = e === 'd' ? () => String(rng.int(10)) : e === 'w' ? () => 'abcdefghijklmnopqrstuvwxyz'[rng.int(26)]! : () => e; }
      else if (c === '.') { i++; unit = () => 'abcdefghijklmnopqrstuvwxyz'[rng.int(26)]!; }
      else { i++; unit = () => c; }
      let min = 1, max = 1; const q = src[i];
      if (q === '?') { min = 0; max = 1; i++; } else if (q === '+') { min = 1; max = 3; i++; } else if (q === '*') { min = 0; max = 3; i++; }
      else if (q === '{') { const end = src.indexOf('}', i); const [a, b] = src.slice(i + 1, end).split(','); min = Number(a); max = b === undefined ? min : b === '' ? min + 2 : Number(b); i = end + 1; }
      const n = min === max ? min : Math.max(min, Math.min(max, min + 1)); for (let k = 0; k < n; k++) out += unit();
    }
    return out;
  }
  function splitAlt(s: string): string[] { const parts: string[] = []; let d = 0, cur = ''; for (const ch of s) { if (ch === '(') d++; if (ch === ')') d--; if (ch === '|' && d === 0) { parts.push(cur); cur = ''; } else cur += ch; } parts.push(cur); return parts; }
  const alts = splitAlt(src); if (alts.length > 1) return fromPattern(alts[0]!, rng);
  return seq();
}

function ulid(rng: Rng) { let s = ''; for (let k = 0; k < 26; k++) s += ULID[rng.int(32)]; return s; }

export function generate(schema: S, ctx: GenCtx, depth = 0, hint = ''): unknown {
  const s = deref(ctx.doc, schema); if (!s || (s as unknown) === true) return null;
  if ('const' in s) return s.const; if (s.example !== undefined) return s.example; if (s.default !== undefined) return s.default; if (s.enum) return s.enum[0];
  if (s.allOf) { const parts = s.allOf.map((p: S) => generate(p, ctx, depth + 1, hint)); return parts.every((p: unknown) => p && typeof p === 'object' && !Array.isArray(p)) ? Object.assign({}, ...parts) : parts[0]; }
  if (s.oneOf || s.anyOf) return generate((s.oneOf ?? s.anyOf)[0], ctx, depth + 1, hint);
  const type: string = Array.isArray(s.type) ? (s.type.find((t: string) => t !== 'null') ?? 'null') : s.type ?? (s.properties ? 'object' : s.items ? 'array' : 'string');
  switch (type) {
    case 'null': return null;
    case 'boolean': return true;
    case 'integer': case 'number': { let v = s.minimum ?? (s.exclusiveMinimum !== undefined ? s.exclusiveMinimum + 1 : 1); if (s.maximum !== undefined && v > s.maximum) v = s.maximum; if (s.multipleOf) v = Math.ceil(v / s.multipleOf) * s.multipleOf; return type === 'integer' ? Math.round(v) : v; }
    case 'string': {
      if (s.pattern) { const m = /^\^?([a-z]{3})_\[0-9A-HJKMNP-TV-Z\]\{26\}\$?$/.exec(s.pattern); if (m) return `${m[1]}_${ulid(ctx.rng)}`; for (let k = 0; k < 8; k++) { const v = fromPattern(s.pattern, ctx.rng); if (new RegExp(s.pattern).test(v) && (s.maxLength === undefined || v.length <= s.maxLength) && v.length >= (s.minLength ?? 0)) return v; } throw new Error('cannot generate for pattern ' + s.pattern); }
      switch (s.format) { case 'date-time': return new Date(ctx.now()).toISOString(); case 'date': return new Date(ctx.now()).toISOString().slice(0, 10); case 'uri': case 'url': return 'https://example.test/' + (hint || 'resource'); case 'email': return 'user@example.test'; case 'uuid': return '00000000-0000-4000-8000-000000000000'; case 'byte': case 'binary': return 'AAAA'; }
      let v = hint ? `sample-${hint}` : 'sample'; while (v.length < (s.minLength ?? 0)) v += 'x'; return s.maxLength !== undefined ? v.slice(0, s.maxLength) : v;
    }
    case 'array': { const n = Math.max(s.minItems ?? 0, depth > (ctx.maxDepth ?? 6) ? 0 : 1); return Array.from({ length: n }, () => generate(s.items ?? {}, ctx, depth + 1, hint)); }
    case 'object': {
      const out: Record<string, unknown> = {}; const req: string[] = s.required ?? [];
      for (const [k, v] of Object.entries<S>(s.properties ?? {})) { if (depth > (ctx.maxDepth ?? 6) && !req.includes(k)) continue; out[k] = generate(v, ctx, depth + 1, k); }
      for (const k of req) if (!(k in out)) out[k] = 'sample';
      return out;
    }
    default: return null;
  }
}
