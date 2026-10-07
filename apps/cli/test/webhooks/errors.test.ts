import { describe, expect, it } from 'vitest';
import { runWebhooks } from '../../src/commands/webhooks/index.js';
import { WHK, json, problem, rig, webhook } from './helpers.js';

const create = ['create', '--url', 'https://example.com/h', '--event', 'session.created'];
describe('error mapping (acceptance 4, 9)', () => {
  it('a non-admin gets a plain message with exit 1 and no stack trace', async () => { for (const code of ['forbidden', 'role_insufficient']) { const r = rig([() => problem(code, 403)]); expect(await runWebhooks(create, r.deps)).toBe(1); expect(r.err[0]).toContain('admins and owners'); expect(r.err.join('\n')).not.toMatch(/\bat |Error:|stack/); } });
  it('hitting the webhook limit names the plan limit', async () => { for (const code of ['webhook_limit_reached', 'entitlement_required']) { const r = rig([() => problem(code, 403)]); expect(await runWebhooks(create, r.deps)).toBe(1); expect(r.err[0]).toContain('allows 5 webhooks'); } });
  it('idempotency_conflict is explained; a signed-out user is told to log in (exit 2); not found is plain', async () => {
    const c = rig([() => problem('idempotency_conflict', 409)]); expect(await runWebhooks(create, c.deps)).toBe(1); expect(c.err[0]).toContain('clashed'); const a = rig([() => problem('token_invalid', 401)]); expect(await runWebhooks(['list'], a.deps)).toBe(2); expect(a.err[0]).toContain('centcom login');
    const n = rig([() => problem('not_found', 404)]); expect(await runWebhooks(['show', WHK], n.deps)).toBe(1); expect(n.err[0]).toContain('not found'); const u = rig([() => problem('webhook_url_invalid', 422)]); await runWebhooks(create, u.deps); expect(u.err[0]).toContain('https://');
  });
  it('a retried create (502 then ok) sends the same Idempotency-Key both times', async () => {
    const r = rig([() => problem('bad_gateway', 502), () => json(webhook({ secret: 'x'.repeat(20) }), 201)]); expect(await runWebhooks(create, r.deps)).toBe(0); const posts = r.calls().filter((q) => q.method === 'POST'); expect(posts).toHaveLength(2); expect(posts[0]!.headers['idempotency-key']).toBe(posts[1]!.headers['idempotency-key']);
  });
  it('an unexpected failure and a network failure give a plain message', async () => { const r = rig([() => { throw new Error('socket hang up /home/alex/x'); }]); const code = await runWebhooks(['list'], r.deps); expect(code).toBe(1); expect(r.err.join('\n')).not.toContain('/home/alex'); });
});
