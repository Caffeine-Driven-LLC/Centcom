/** CT-IDS: prefixed ULIDs. `<prefix>_<26 Crockford base32>`, lowercase prefix, uppercase ULID, at most 40 bytes. */
export const ID_PREFIXES = ['usr', 'wsp', 'dev', 'mem', 'inv', 'key', 'whk', 'ntf', 'snp', 'blb', 'ses', 'agt', 'que', 'msg', 'apr', 'sub', 'dlv', 'aud', 'prj', 'req', 'exp', 'psh', 'use', 'inc'] as const;
export type IdPrefix = (typeof ID_PREFIXES)[number];
export type Id<P extends IdPrefix = IdPrefix> = `${P}_${string}`;

const ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ'; // Crockford: no I, L, O, U
const ULID_RE = '[0-9A-HJKMNP-TV-Z]{26}';
const ID_RE = new RegExp(`^(${ID_PREFIXES.join('|')})_${ULID_RE}$`);

export const isId = <P extends IdPrefix>(prefix: P, s: unknown): s is Id<P> => typeof s === 'string' && s.startsWith(prefix + '_') && ID_RE.test(s);
export const idPrefix = (s: string): IdPrefix | undefined => (ID_RE.test(s) ? (s.slice(0, 3) as IdPrefix) : undefined);

export interface IdDeps { now: () => number; random: (n: number) => Uint8Array }

/** Monotonic: IDs from one generator strictly increase, even within a single millisecond (the random part is incremented). */
export function newIdGenerator(deps: IdDeps): { next<P extends IdPrefix>(prefix: P): Id<P> } {
  let lastTime = -1; let rand: Uint8Array = new Uint8Array(10);
  const encode = (time: number, r: Uint8Array): string => {
    let t = ''; let n = time; for (let i = 0; i < 10; i++) { t = ALPHABET[n % 32] + t; n = Math.floor(n / 32); }
    let bits = 0n; for (const b of r) bits = (bits << 8n) | BigInt(b);
    let tail = ''; for (let i = 0; i < 16; i++) { tail = ALPHABET[Number(bits & 31n)] + tail; bits >>= 5n; }
    return t + tail;
  };
  return {
    next(prefix) {
      let now = Math.max(deps.now(), lastTime); // a clock that steps back must not break ordering
      if (now === lastTime) { // same millisecond: bump the random part by one
        const r = rand.slice(); let i = 9; while (i >= 0 && r[i] === 255) { r[i] = 0; i--; }
        if (i < 0) { now = lastTime + 1; rand = deps.random(10); } else { r[i]!++; rand = r; }
      } else rand = deps.random(10);
      lastTime = now; return `${prefix}_${encode(now, rand)}` as Id<typeof prefix>;
    },
  };
}
