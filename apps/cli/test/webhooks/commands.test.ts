import { describe, expect, it } from 'vitest';
import { runWebhooks } from '../../src/commands/webhooks/index.js';
import { DLV, WHK, WS, delivery, json, page, problem, rig, webhook } from './helpers.js';

describe('webhooks commands against scripted answers', () => {
  it('list: uses the active workspace, pages through every page, shows the plan limit; --json is plain data', async () => {
    const r = rig([() => page([webhook()], 'c1'), (q) => { expect(q.url.searchParams.get('cursor')).toBe('c1'); return page([webhook({ id: 'whk_01JA3Z8K2M5N7P9Q0R1S2T3V5X', events: ['a', 'b', 'c'] })]); }]); expect(await runWebhooks(['list'], r.deps)).toBe(0);
    expect(r.calls()[0]!.url.pathname).toBe(`/v1/workspaces/${WS}/webhooks`); expect(r.calls()).toHaveLength(2); expect(r.out.join('\n')).toContain(WHK); expect(r.out.at(-1)).toBe('2 of 5 webhooks used on your plan.'); expect(r.out.join('\n')).toContain('+1');
    const j = rig([() => page([webhook({ secret: 'LEAK' })])]); expect(await runWebhooks(['list', '--json', '--workspace', WS], j.deps)).toBe(0); const o = JSON.parse(j.out[0]!); expect(o.webhooks).toHaveLength(1); expect(j.out[0]).not.toContain('LEAK'); expect(j.seen.some((s) => s.url.pathname === '/v1/me')).toBe(false);
    const empty = rig([() => page([])]); await runWebhooks(['list'], empty.deps); expect(empty.out[0]).toContain('No webhooks yet');
  });
  it('show: prints the details and says the secret is never shown again; --json has no secret', async () => {
    const r = rig([() => json(webhook({ secret_rotated_at: '2026-10-06T10:00:00.000Z', secret_overlap_until: '2026-10-07T10:00:00.000Z' }))]); expect(await runWebhooks(['show', WHK], r.deps)).toBe(0); expect(r.out.join('\n')).toContain('never shown again'); expect(r.out.join('\n')).toContain('old secret valid until'); expect(r.calls()[0]!.url.pathname).toBe(`/v1/webhooks/${WHK}`);
    const j = rig([() => json(webhook({ secret: 'LEAK' }))]); await runWebhooks(['show', WHK, '--json'], j.deps); expect(j.out[0]).not.toContain('LEAK'); expect(await runWebhooks(['show', 'nope'], rig([() => json({})]).deps)).toBe(1);
  });
  it('update: sends only what changed, validates first; delete asks on a terminal and needs --yes otherwise; test and redeliver post', async () => {
    const u = rig([() => json(webhook({ enabled: false }))]); expect(await runWebhooks(['update', WHK, '--disable', '--event', 'session.ended'], u.deps)).toBe(0); expect(u.calls()[0]).toMatchObject({ method: 'PATCH', body: { enabled: false, events: ['session.ended'] } });
    for (const bad of [['--event', 'foo.bar'], ['--url', 'http://x.com'], ['--enable', '--disable'], []]) { const x = rig([() => json(webhook())]); expect(await runWebhooks(['update', WHK, ...bad], x.deps)).toBe(1); expect(x.calls()).toHaveLength(0); }
    const del = rig([() => new Response(null, { status: 204 })]); expect(await runWebhooks(['delete', WHK], del.deps)).toBe(0); expect(del.calls()[0]!.method).toBe('DELETE'); const no = rig([() => new Response(null, { status: 204 })], { confirm: false }); expect(await runWebhooks(['delete', WHK], no.deps)).toBe(1); expect(no.calls()).toHaveLength(0);
    const pipe = rig([() => new Response(null, { status: 204 })], { isTTY: false }); expect(await runWebhooks(['delete', WHK], pipe.deps)).toBe(1); expect(pipe.err[0]).toContain('--yes'); expect(await runWebhooks(['delete', WHK, '--yes'], pipe.deps)).toBe(0);
    const t = rig([() => json(delivery(), 202)]); expect(await runWebhooks(['test', WHK], t.deps)).toBe(0); expect(t.calls()[0]).toMatchObject({ method: 'POST' }); expect(t.calls()[0]!.url.pathname).toBe(`/v1/webhooks/${WHK}/test`);
    const rd = rig([() => json(delivery({ attempt: 3 }), 202)]); expect(await runWebhooks(['redeliver', WHK, DLV], rd.deps)).toBe(0); expect(rd.calls()[0]!.url.pathname).toBe(`/v1/webhooks/${WHK}/deliveries/${DLV}/redeliver`); expect(rd.out[0]).toContain('attempt 3'); expect(await runWebhooks(['redeliver', WHK, 'x'], rd.deps)).toBe(1);
  });
  it('deliveries: pages with cursors, honours --limit (1..200), prints the columns', async () => {
    const d = (n: number) => ({ id: `dlv_01JA3Z8K2M5N7P9Q0R1S2T3V${String(n).padStart(2, '0')}`, webhook: WHK, event_type: 'session.created', attempt: 1, status: 'failed', response_status: 500, created_at: '2026-10-05T18:07:41.123Z' });
    const r = rig([() => page([d(10), d(11)], 'c1'), () => page([d(12)])]); expect(await runWebhooks(['deliveries', WHK, '--limit', '200'], r.deps)).toBe(0); expect(r.calls()).toHaveLength(2); expect(r.calls()[0]!.url.searchParams.get('limit')).toBe('200'); expect(r.out[0]).toMatch(/ID\s+EVENT\s+ATTEMPT\s+STATUS\s+TIME/); expect(r.out).toHaveLength(4); expect(r.out[1]).toContain('failed (500)');
    const two = rig([() => page([d(10), d(11), d(12)], 'c1')]); await runWebhooks(['deliveries', WHK, '--limit', '2', '--json'], two.deps); expect(JSON.parse(two.out[0]!).deliveries).toHaveLength(2);
    for (const bad of ['0', '201', 'x', '1.5']) { const x = rig([() => page([])]); expect(await runWebhooks(['deliveries', WHK, '--limit', bad], x.deps)).toBe(1); expect(x.calls()).toHaveLength(0); }
  });
  it('unknown commands and options print help or a plain message', async () => {
    const r = rig([() => json({})]); expect(await runWebhooks([], r.deps)).toBe(1); expect(r.err[0]).toContain('Usage: centcom webhooks'); expect(await runWebhooks(['help'], r.deps)).toBe(0); expect(await runWebhooks(['wat'], r.deps)).toBe(1);
    expect(await runWebhooks(['list', '--nope'], r.deps)).toBe(1); expect(r.err.at(-1)).toContain('Unknown option'); expect(await runWebhooks(['list', '--workspace'], r.deps)).toBe(1); expect(await runWebhooks(['list', '--workspace', 'bad'], r.deps)).toBe(1);
  });
  it('registerWebhookCommands adds one command that runs the subcommands', async () => {
    const { registerWebhookCommands } = await import('../../src/commands/webhooks/index.js'); const reg: Record<string, (a: string[]) => Promise<number>> = {}; const r = rig([() => page([])]); registerWebhookCommands({ command: (n, f) => { reg[n] = f; } }, r.deps); expect(Object.keys(reg)).toEqual(['webhooks']); expect(await reg.webhooks!(['list'], )).toBe(0);
  });
});
void problem;
