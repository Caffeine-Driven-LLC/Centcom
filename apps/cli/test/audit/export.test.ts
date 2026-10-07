import { describe, expect, it } from 'vitest';
import { runAudit } from '../../src/commands/audit/index.js';
import { EXP, WS, job, json, problem, rig } from './helpers.js';

const base = ['export', '--format', 'csv', '--wait', '--out', 'a.csv'];
describe('audit export', () => {
  it('posts with an Idempotency-Key, polls at 2, 4, 8, 10 s until ready, downloads to the file with mode 0600 and prints the byte count', async () => {
    const r = rig([() => json(job('pending'), 202), () => json(job('pending')), () => json(job('pending')), () => json(job('pending')), () => json(job('ready'))]); expect(await runAudit(base, r.deps)).toBe(0);
    const post = r.calls()[0]!; expect(post).toMatchObject({ method: 'POST', body: { format: 'csv' } }); expect(post.url.pathname).toBe(`/v1/workspaces/${WS}/audit/exports`); expect(post.headers['idempotency-key']).toBeTruthy();
    expect(r.clock.sleeps).toEqual([2000, 4000, 8000, 10_000]); expect(r.calls().slice(1).every((c) => c.method === 'GET' && c.url.pathname === `/v1/workspaces/${WS}/audit/exports/${EXP}`)).toBe(true);
    expect(r.files.get('a.csv')!.mode).toBe(0o600); expect(r.files.get('a.csv')!.data.toString()).toBe('a,b\n1,2\n'); expect(r.out[0]).toBe('Saved 8 bytes to a.csv'); expect(r.err[0]).toContain(EXP);
  });
  it('filters travel in the export request; --json prints the result as data', async () => {
    const r = rig([() => json(job('ready'), 202)]); await runAudit([...base, '--actor', 'usr_1', '--action', 'a.b', '--from', '7d', '--to', '2026-10-07T00:00:00Z', '--json'], r.deps); expect(r.calls()[0]!.body).toMatchObject({ format: 'csv', actor: 'usr_1', action: 'a.b', from: '2026-09-30T12:00:00.000Z', to: '2026-10-07T00:00:00.000Z' }); expect(JSON.parse(r.out[0]!)).toMatchObject({ export: EXP, file: 'a.csv', bytes: 8 });
  });
  it('a failed, expired or address-less job exits 1 and says why', async () => {
    const f = rig([() => json(job('failed', { code: 'export_failed' }), 202)]); expect(await runAudit(base, f.deps)).toBe(1); expect(f.err.join()).toContain('failed (export_failed)'); expect(f.files.size).toBe(0);
    const e = rig([() => json(job('expired'), 202)]); expect(await runAudit(base, e.deps)).toBe(1); expect(e.err.join()).toContain('expired'); const n = rig([() => json(job('ready', { download_url: null }), 202)]); expect(await runAudit(base, n.deps)).toBe(1);
  });
  it('gives up after 5 minutes with the export id in the message', async () => {
    const r = rig([() => json(job('pending'), 202)]); expect(await runAudit(base, r.deps)).toBe(1); expect(r.err.at(-1)).toContain(EXP); expect(r.err.at(-1)).toContain('5 minutes'); const total = r.clock.sleeps.reduce((a, b) => a + b, 0); expect(total).toBeGreaterThanOrEqual(300_000); expect(total).toBeLessThan(320_000); expect(r.files.size).toBe(0);
  });
  it('an existing file is left alone without --force (exit 1, no request); with --force it is replaced', async () => {
    const r = rig([() => json(job('ready'), 202)], { existing: ['a.csv'] }); expect(await runAudit(base, r.deps)).toBe(1); expect(r.err[0]).toContain('--force'); expect(r.files.get('a.csv')!.data.toString()).toBe('OLD'); expect(r.seen).toHaveLength(0);
    const f = rig([() => json(job('ready'), 202)], { existing: ['a.csv'] }); expect(await runAudit([...base, '--force'], f.deps)).toBe(0); expect(f.files.get('a.csv')!.data.toString()).toBe('a,b\n1,2\n');
  });
  it('a failed download deletes the partial file; so does a stop (SIGINT) in the middle', async () => {
    const half = rig([() => json(job('ready'), 202)], { download: () => new Response(new ReadableStream({ start(c) { c.enqueue(new TextEncoder().encode('a,b\n')); c.error(new Error('terminated')); } })) }); expect(await runAudit(base, half.deps)).toBe(1); expect(half.files.has('a.csv')).toBe(false); expect(half.events).toContain('abort a.csv'); expect(half.err.join()).toContain('partial file was removed');
    const bad = rig([() => json(job('ready'), 202)], { download: () => new Response('no', { status: 403 }) }); expect(await runAudit(base, bad.deps)).toBe(1); expect(bad.files.has('a.csv')).toBe(false);
    const ac = new AbortController(); const s = rig([() => json(job('ready'), 202)], { signal: ac.signal, download: () => new Response(new ReadableStream({ start(c) { c.enqueue(new TextEncoder().encode('x')); ac.abort(); c.error(new Error('aborted')); } })) }); expect(await runAudit(base, s.deps)).toBe(130); expect(s.files.has('a.csv')).toBe(false); expect(s.err.join()).toContain('Stopped');
  });
  it('without --wait or --out it only starts the export and tells how to get the file', async () => { const r = rig([() => json(job('pending'), 202)]); expect(await runAudit(['export', '--format', 'json'], r.deps)).toBe(0); expect(r.out[0]).toContain(EXP); expect(r.out[0]).toContain('--wait --out'); expect(r.calls()).toHaveLength(1); expect(r.downloads).toHaveLength(0); });
  it('bad input is refused locally; a plan without the audit log, a 403 and an idempotency conflict get plain messages', async () => {
    for (const a of [['export'], ['export', '--format', 'xml'], ['export', '--format', 'csv', '--from', 'soon'], ['export', '--format', 'csv', '--out']]) { const r = rig([() => json(job('ready'), 202)]); expect(await runAudit(a, r.deps)).toBe(1); expect(r.seen).toHaveLength(0); }
    const off = rig([() => json(job('ready'), 202)], { entitlementDays: 0 }); expect(await runAudit(base, off.deps)).toBe(1); expect(off.err[0]).toContain('not part of your plan'); expect(off.calls()).toHaveLength(0);
    const f = rig([() => problem('forbidden', 403)]); expect(await runAudit(base, f.deps)).toBe(1); expect(f.err[0]).toContain('admin or owner'); const c = rig([() => problem('idempotency_conflict', 409)]); expect(await runAudit(base, c.deps)).toBe(1); expect(c.err[0]).toContain('clashed');
  });
  it('no token and no signed address appears in any output', async () => {
    const r = rig([() => json(job('ready'), 202)]); await runAudit([...base, '--json'], r.deps); const all = r.out.join('\n') + r.err.join('\n'); expect(all).not.toContain('BEARER-TOKEN'); expect(all).not.toContain('SECRETSIG'); expect(all).not.toContain('downloads.centcom.dev');
    const bad = rig([() => json(job('ready'), 202)], { download: () => new Response('no', { status: 500 }) }); await runAudit(base, bad.deps); expect(bad.out.join() + bad.err.join()).not.toContain('SECRETSIG'); expect(r.downloads[0]).toContain('SECRETSIG');
  });
});
