/** The receiver check of CT-WEBHOOKS: `Centcom-Signature: t=<unix>,v1=<hex>` with `v1 = HMAC_SHA256(secret, t + "." + raw_body)`. During a secret rotation the header carries two `v1` values and either may match. */
import { createHmac, timingSafeEqual } from 'node:crypto';
export const DEFAULT_TOLERANCE_S = 300; const MAX_HEADER = 2048;
export interface ParsedSignature { t: number; v1: string[] }
export function parseSignatureHeader(header: string): ParsedSignature | undefined {
  if (typeof header !== 'string' || header.length === 0 || header.length > MAX_HEADER) return undefined; let t: number | undefined; const v1: string[] = [];
  for (const part of header.split(',')) { const i = part.indexOf('='); if (i < 0) return undefined; const k = part.slice(0, i).trim(); const v = part.slice(i + 1).trim(); if (k === 't') { if (t !== undefined || !/^\d{1,12}$/.test(v)) return undefined; t = Number(v); } else if (k === 'v1') { if (!/^[0-9a-f]{64}$/i.test(v)) return undefined; v1.push(v.toLowerCase()); } /* unknown keys (v2=...) are ignored */ }
  return t === undefined || v1.length === 0 || v1.length > 4 ? undefined : { t, v1 };
}
export const signWebhook = (secret: string, t: number, rawBody: Uint8Array): string => createHmac('sha256', secret).update(`${t}.`).update(rawBody).digest('hex');
export function verifyWebhookSignature(o: { secret: string; header: string; rawBody: Uint8Array; nowS: number; toleranceS?: number }): { ok: boolean; reason?: 'malformed' | 'stale' | 'mismatch' } {
  const p = parseSignatureHeader(o.header); if (!p) return { ok: false, reason: 'malformed' };
  if (Math.abs(o.nowS - p.t) > (o.toleranceS ?? DEFAULT_TOLERANCE_S)) return { ok: false, reason: 'stale' };
  const want = Buffer.from(signWebhook(o.secret, p.t, o.rawBody), 'hex'); let ok = false;
  for (const v of p.v1) { const got = Buffer.from(v, 'hex'); if (got.length === want.length && timingSafeEqual(got, want)) ok = true; } /* every candidate is compared, so the time does not tell which one matched */
  return ok ? { ok: true } : { ok: false, reason: 'mismatch' };
}
