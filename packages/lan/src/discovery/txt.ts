/**
 * The CT-LAN §1 TXT record: exactly the keys v, p, sid, name, host, fp, n, pair. Pure and fuzzable.
 * Owns: encoding our record and validating received ones. Must not: carry anything secret, or accept a record with any invalid field.
 */

export const TXT_KEYS = ['v', 'p', 'sid', 'name', 'host', 'fp', 'n', 'pair'] as const;
export const MAX_TXT_ENTRY = 255;
export const MAX_NAME_CHARS = 40;
export const MAX_MEMBERS = 8;
export const SID_RE = /^ses_[0-9A-HJKMNP-TV-Z]{26}$/;
/** CT-CRYPTO §1 display form, as in schemas/lan-pair.schema.json. */
export const FP_RE = /^[A-Z2-7]{4}(-[A-Z2-7]{4}){2}$/;

export interface TxtRecord { v: '1'; p: string; sid: string; name: string; host: string; fp: string; n: number; pair: boolean }

/** Control characters (C0, DEL, C1), bidi overrides and isolates, and lone surrogates. */
const STRIP = /[\p{Cc}‎‏‪-‮⁦-⁩﻿]|\p{Cs}/gu;

/** NFC, control characters removed, cut to `max` code points (so never inside a UTF-8 sequence), trimmed. */
export function cleanText(s: string, max = MAX_NAME_CHARS): string {
  return Array.from(s.normalize('NFC').replace(STRIP, '')).slice(0, max).join('').trim();
}

/** Cut a string so its UTF-8 form is at most `maxBytes`, never splitting a code point. */
export function truncateUtf8(s: string, maxBytes: number): string {
  const e = new TextEncoder(); let out = ''; let used = 0;
  for (const ch of s) { const n = e.encode(ch).length; if (used + n > maxBytes) break; out += ch; used += n; }
  return out;
}

const enc = new TextEncoder();
const dec = new TextDecoder('utf-8', { fatal: false });

/** Encode a record as TXT strings `key=value`, in the documented key order. Throws TypeError when a field would be invalid on the wire. */
export function encodeTxt(rec: TxtRecord): Buffer[] {
  if (!SID_RE.test(rec.sid)) throw new TypeError('sid is not a ses_ id');
  if (!FP_RE.test(rec.fp)) throw new TypeError('fp is not in the fingerprint display format');
  if (!Number.isInteger(rec.n) || rec.n < 0 || rec.n > MAX_MEMBERS) throw new TypeError('n must be an integer 0..8');
  if (!/^[0-9]+(,[0-9]+)*$/.test(rec.p) || !rec.p.split(',').includes('1')) throw new TypeError('p must list protocol 1');
  const values: Record<(typeof TXT_KEYS)[number], string> = { v: '1', p: rec.p, sid: rec.sid, name: cleanText(rec.name), host: cleanText(rec.host), fp: rec.fp, n: String(rec.n), pair: rec.pair ? '1' : '0' };
  return TXT_KEYS.map((k) => { const b = Buffer.from(enc.encode(`${k}=${values[k]}`)); if (b.length > MAX_TXT_ENTRY) throw new TypeError('TXT entry over 255 bytes'); return b; });
}

/**
 * Parse and validate received TXT strings. Returns null unless: every entry is <= 255 bytes, v is 1, p lists 1, sid and fp have their formats, n is 0..8, and pair is present.
 * Keys are matched case-insensitively and the first occurrence wins (RFC 6763 §6.4); unknown keys are ignored. Never throws.
 */
export function parseTxt(buf: readonly Uint8Array[]): TxtRecord | null {
  try {
    if (!Array.isArray(buf) || buf.length > 64) return null;
    const m = new Map<string, string>();
    for (const e of buf) {
      if (!(e instanceof Uint8Array) || e.length > MAX_TXT_ENTRY) return null;
      const s = dec.decode(e); const i = s.indexOf('='); const key = (i < 0 ? s : s.slice(0, i)).toLowerCase(); if (!key || m.has(key)) continue;
      m.set(key, i < 0 ? '' : s.slice(i + 1));
    }
    const v = m.get('v'), p = m.get('p'), sid = m.get('sid'), fp = m.get('fp'), n = m.get('n'), pair = m.get('pair');
    if (v !== '1' || p === undefined || !p.split(',').map((x) => x.trim()).includes('1')) return null;
    if (sid === undefined || !SID_RE.test(sid) || fp === undefined || !FP_RE.test(fp)) return null;
    if (n === undefined || !/^[0-9]{1,2}$/.test(n) || Number(n) > MAX_MEMBERS) return null;
    if (pair !== '1' && pair !== '0') return null;
    return { v: '1', p: cleanText(p, 16), sid, name: cleanText(m.get('name') ?? ''), host: cleanText(m.get('host') ?? ''), fp, n: Number(n), pair: pair === '1' };
  } catch { return null; }
}
