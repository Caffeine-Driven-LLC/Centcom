import { createHmac } from 'node:crypto';
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { parseSignatureHeader, runWebhooks, signWebhook, verifyWebhookSignature } from '../../src/commands/webhooks/index.js';
import { rig } from './helpers.js';

const SECRET = 'test-signing-secret'; const BODY = new TextEncoder().encode('{"id":"dlv_x","type":"session.created"}'); const NOW = 1_790_000_000; const hdr = (t: number, ...v: string[]) => `t=${t},${v.map((x) => `v1=${x}`).join(',')}`;
const good = signWebhook(SECRET, NOW, BODY);
describe('signature (CT-WEBHOOKS)', () => {
  it('v1 is HMAC-SHA256 of t + "." + raw body, in hex', () => { expect(good).toBe(createHmac('sha256', SECRET).update(`${NOW}.`).update(BODY).digest('hex')); expect(good).toMatch(/^[0-9a-f]{64}$/); });
  it('valid, stale (both directions), wrong secret, wrong body and malformed headers', () => {
    const v = (o: Partial<Parameters<typeof verifyWebhookSignature>[0]> = {}) => verifyWebhookSignature({ secret: SECRET, header: hdr(NOW, good), rawBody: BODY, nowS: NOW, ...o });
    expect(v()).toEqual({ ok: true }); expect(v({ nowS: NOW + 300 }).ok).toBe(true); expect(v({ nowS: NOW + 301 })).toEqual({ ok: false, reason: 'stale' }); expect(v({ nowS: NOW - 301 })).toEqual({ ok: false, reason: 'stale' }); expect(v({ nowS: NOW + 301, toleranceS: 600 }).ok).toBe(true);
    expect(v({ secret: 'other' })).toEqual({ ok: false, reason: 'mismatch' }); expect(v({ rawBody: new TextEncoder().encode('{}') })).toEqual({ ok: false, reason: 'mismatch' });
    for (const h of ['', 'garbage', `t=abc,v1=${good}`, `v1=${good}`, `t=${NOW}`, `t=${NOW},v1=zz`, `t=${NOW},v1=${good.slice(2)}`, `t=${NOW},t=${NOW},v1=${good}`, `t=${NOW}v1=${good}`, 'x'.repeat(5000)]) expect(v({ header: h })).toEqual({ ok: false, reason: 'malformed' });
  });
  it('accepts when either of two v1 values matches (rotation overlap), and ignores other versions', () => {
    const old = signWebhook('old-secret', NOW, BODY); const v = (secret: string) => verifyWebhookSignature({ secret, header: hdr(NOW, old, good), rawBody: BODY, nowS: NOW }); expect(v(SECRET).ok).toBe(true); expect(v('old-secret').ok).toBe(true); expect(v('third').ok).toBe(false);
    expect(verifyWebhookSignature({ secret: SECRET, header: `t=${NOW},v2=abc,v1=${good}`, rawBody: BODY, nowS: NOW }).ok).toBe(true); expect(parseSignatureHeader(hdr(NOW, good, good, good, good, good))).toBeUndefined();
  });
  it('uppercase hex is accepted; the parser is strict about the timestamp', () => { expect(verifyWebhookSignature({ secret: SECRET, header: hdr(NOW, good.toUpperCase()), rawBody: BODY, nowS: NOW }).ok).toBe(true); expect(parseSignatureHeader(`t=-5,v1=${good}`)).toBeUndefined(); expect(parseSignatureHeader(`t=1.5,v1=${good}`)).toBeUndefined(); });
  it('property: random headers never throw and are never accepted without the right secret', () => {
    fc.assert(fc.property(fc.string({ maxLength: 200 }), (h) => { const r = verifyWebhookSignature({ secret: SECRET, header: h, rawBody: BODY, nowS: NOW }); return r.ok === false; }), { numRuns: 2000 });
    fc.assert(fc.property(fc.uint8Array({ maxLength: 100 }), fc.string({ minLength: 1, maxLength: 30 }), (body, secret) => { const t = NOW; const sig = signWebhook(secret, t, body); return verifyWebhookSignature({ secret, header: hdr(t, sig), rawBody: body, nowS: t }).ok; }), { numRuns: 300 });
  });
});
describe('verify command (acceptance 7)', () => {
  const run = (header: string, o: { stdin?: string; now?: number; extra?: string[]; file?: Uint8Array } = {}) => { const r = rig([() => new Response('{}')], { stdin: o.stdin ?? SECRET + '\n', now: (o.now ?? NOW) * 1000, files: { 'body.json': o.file ?? BODY } }); return runWebhooks(['verify', '--secret-stdin', '--signature', header, '--body-file', 'body.json', ...(o.extra ?? [])], r.deps).then((code) => ({ code, r })); };
  it('exit 0 for a valid one; 3 for stale, wrong secret, malformed; accepts the overlap', async () => {
    expect((await run(hdr(NOW, good))).code).toBe(0); expect((await run(hdr(NOW, good), { now: NOW + 400 })).code).toBe(3); expect((await run(hdr(NOW, good), { now: NOW + 400, extra: ['--tolerance', '500'] })).code).toBe(0); expect((await run(hdr(NOW, good), { stdin: 'wrong' })).code).toBe(3); expect((await run('nonsense')).code).toBe(3);
    expect((await run(hdr(NOW, signWebhook('old', NOW, BODY), good))).code).toBe(0); const j = await run(hdr(NOW, good), { now: NOW + 400, extra: ['--json'] }); expect(JSON.parse(j.r.out[0]!)).toEqual({ valid: false, reason: 'stale' });
  });
  it('the secret is never echoed; missing input is a usage error, not a failure of the signature', async () => {
    const a = await run(hdr(NOW, good), { stdin: SECRET }); expect(a.r.out.join() + a.r.err.join()).not.toContain(SECRET); const b = await run(hdr(NOW, good), { stdin: '' }); expect(b.code).toBe(1); const r = rig([() => new Response('{}')]); expect(await runWebhooks(['verify', '--signature', 'x'], r.deps)).toBe(1); expect(r.err[0]).toContain('--secret-stdin');
    const missing = rig([() => new Response('{}')], { stdin: SECRET }); expect(await runWebhooks(['verify', '--secret-stdin', '--signature', hdr(NOW, good), '--body-file', 'nope'], missing.deps)).toBe(1); expect((await run(hdr(NOW, good), { extra: ['--tolerance', '-1'] })).code).toBe(1);
  });
  it('makes no network request', async () => { const r = rig([() => new Response('{}')], { stdin: SECRET, files: { 'b': BODY } }); await runWebhooks(['verify', '--secret-stdin', '--signature', hdr(NOW, good), '--body-file', 'b'], r.deps); expect(r.seen).toHaveLength(0); });
});
