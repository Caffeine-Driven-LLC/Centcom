import { describe, expect, it } from 'vitest';
import { runWebhooks } from '../../src/commands/webhooks/index.js';
import { WHK, WS, json, problem, rig, webhook } from './helpers.js';

const SECRET = 'whsec_' + 'A1b2C3d4E5f6G7h8I9j0K1l2M3n4O5p6'; // centcom-synthetic-secret
const created = () => json(webhook({ secret: SECRET }), 201); const create = ['create', '--url', 'https://example.com/h', '--event', 'session.created'];
describe('create: the secret is shown once', () => {
  it('on a terminal it is printed once with a warning, and one POST carries an Idempotency-Key; a later show never has it', async () => {
    const r = rig([created]); expect(await runWebhooks(create, r.deps)).toBe(0); const post = r.calls()[0]!; expect(post).toMatchObject({ method: 'POST', body: { url: 'https://example.com/h', events: ['session.created'] } }); expect(post.url.pathname).toBe(`/v1/workspaces/${WS}/webhooks`); expect(post.headers['idempotency-key']).toMatch(/^[0-9A-Za-z-]{20,64}$/); expect(r.calls()).toHaveLength(1);
    expect(r.out.filter((l) => l.includes(SECRET))).toHaveLength(1); expect(r.out.join('\n')).toContain('only time'); const s = rig([() => json(webhook())]); await runWebhooks(['show', WHK], s.deps); expect(s.out.join('\n') + s.err.join('\n')).not.toContain(SECRET);
  });
  it('piped output hides it unless --show-secret is given; the exit code is 0 either way, with an explanation', async () => {
    const hidden = rig([created], { isTTY: false }); expect(await runWebhooks(create, hidden.deps)).toBe(0); expect(hidden.out.join('\n') + hidden.err.join('\n')).not.toContain(SECRET); expect(hidden.out.join('\n')).toContain('cannot be shown again');
    const shown = rig([created], { isTTY: false }); expect(await runWebhooks([...create, '--show-secret'], shown.deps)).toBe(0); expect(shown.out.filter((l) => l.includes(SECRET))).toHaveLength(1);
  });
  it('--json has the secret only when it would be printed, and says when it was held back', async () => {
    const tty = rig([created]); await runWebhooks([...create, '--json'], tty.deps); expect(JSON.parse(tty.out[0]!).secret).toBe(SECRET);
    const pipe = rig([created], { isTTY: false }); await runWebhooks([...create, '--json'], pipe.deps); const o = JSON.parse(pipe.out[0]!); expect(o.secret).toBeUndefined(); expect(o.secret_hidden).toBe(true); expect(pipe.out[0]).not.toContain(SECRET);
    const both = rig([created], { isTTY: false }); await runWebhooks([...create, '--json', '--show-secret'], both.deps); expect(JSON.parse(both.out[0]!).secret).toBe(SECRET);
  });
  it('rotate-secret prints the new secret once and states the 24 hour overlap; piped it is held back', async () => {
    const r = rig([() => json(webhook({ secret: SECRET }))]); expect(await runWebhooks(['rotate-secret', WHK], r.deps)).toBe(0); expect(r.calls()[0]).toMatchObject({ method: 'PATCH', body: { rotate_secret: true } }); expect(r.out.filter((l) => l.includes(SECRET))).toHaveLength(1); expect(r.out.join('\n')).toContain('24 hours');
    const p = rig([() => json(webhook({ secret: SECRET }))], { isTTY: false }); await runWebhooks(['rotate-secret', WHK, '--json'], p.deps); expect(p.out[0]).not.toContain(SECRET); expect(JSON.parse(p.out[0]!).overlap_hours).toBe(24);
  });
  it('the secret never appears in error output or in the update/list/deliveries output', async () => {
    const e = rig([() => problem('forbidden', 403, { detail: `no ${SECRET}` })]); await runWebhooks(create, e.deps); expect(e.err.join('\n') + e.out.join('\n')).not.toContain(SECRET);
    const u = rig([() => json(webhook({ secret: SECRET }))]); await runWebhooks(['update', WHK, '--enable'], u.deps); await runWebhooks(['list'], u.deps); expect(u.out.join('\n') + u.err.join('\n')).not.toContain(SECRET);
  });
});
