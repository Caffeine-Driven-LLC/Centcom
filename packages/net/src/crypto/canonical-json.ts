/** RFC 8785 (JCS) canonical JSON: sorted keys (by UTF-16 code units), no whitespace, ECMAScript number formatting, minimal string escaping. */
export function canonicalJson(v: unknown): string {
  if (v === null) return 'null';
  switch (typeof v) {
    case 'boolean': return v ? 'true' : 'false';
    case 'number': if (!Number.isFinite(v)) throw new TypeError('JCS: numbers must be finite'); return Object.is(v, -0) ? '0' : JSON.stringify(v); // ECMAScript Number::toString is what RFC 8785 specifies
    case 'string': return JSON.stringify(v);
    case 'object': {
      if (Array.isArray(v)) return '[' + v.map((x) => (x === undefined ? 'null' : canonicalJson(x))).join(',') + ']';
      const keys = Object.keys(v as object).filter((k) => (v as Record<string, unknown>)[k] !== undefined).sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
      return '{' + keys.map((k) => JSON.stringify(k) + ':' + canonicalJson((v as Record<string, unknown>)[k])).join(',') + '}';
    }
    default: throw new TypeError(`JCS: cannot encode ${typeof v}`);
  }
}
