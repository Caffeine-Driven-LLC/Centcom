import { afterEach, describe, expect, it } from 'vitest';
import { accountEnv, json, secretsOf, type Env } from './helpers.js';

const KEY = `cen_live_${'R4nd'.repeat(8)}`;
const TOKEN_SHAPES = [/eyJ[A-Za-z0-9_-]{6,}\.[A-Za-z0-9_-]{6,}/, /\brt_[A-Za-z0-9_-]{8,}/, /\bdc_[A-Za-z0-9_-]{8,}/, /cen_(live|test)_[A-Za-z0-9]{6,}/, /[A-Za-z0-9_-]{40,}/];
const envs: Env[] = []; afterEach(async () => { for (const e of envs.splice(0)) await e.stop(); });
const ME = { user: { id: 'usr_01JA3Z8K2M5N7P9Q0R1S2T3V4W', email: 'r@example.test', display_name: 'R', locale: 'en', telemetry: false, created_at: '2026-10-06T12:00:00.000Z' }, plan: 'pro', active_workspace: null, ent: 1 };

describe('no command prints a token, device code, refresh token or API key (acceptance 8)', () => {
  it('in every mode, success and failure, stdout and stderr', async () => {
    const outputs: string[] = []; const seen: Parameters<typeof secretsOf>[0] = [];
    const go = async (o: Parameters<typeof accountEnv>[0], steps: (e: Env) => Promise<void>) => { const e = await accountEnv(o); envs.push(e); await steps(e); outputs.push(...e.out, ...e.err); seen.push(...e.seen); };

    await go({}, async (e) => { await e.run('login', '--no-browser'); await e.run('login', '--json'); await e.run('whoami'); await e.run('whoami', '--json'); await e.run('devices', 'list'); await e.run('devices', 'list', '--json'); await e.run('devices', 'revoke', 'dev_01JA3Z8K2M5N7P9Q0R1S2T3V4X', '--yes'); await e.run('logout', '--revoke-device'); });
    await go({ onOut: (l, e) => { const c = /Code: (\S+)/.exec(l)?.[1]; if (c) void e.m.control('deny-device', { user_code: c }); } }, async (e) => { await e.run('login', '--json'); });
    await go({}, async (e) => { await e.run('login', '--no-browser'); await e.m.advance(16 * 60_000); await e.m.control('errors', { code: 'refresh_reuse_detected' }); await e.run('whoami', '--json'); await e.run('devices', 'list', '--json'); });
    await go({}, async (e) => { await e.run('login', '--no-browser'); e.ctl.offline = true; await e.run('whoami'); await e.run('logout'); });
    await go({ stdin: KEY, override: (r) => (r.auth === `Bearer ${KEY}` && r.path === '/v1/me' ? json(200, ME) : undefined) }, async (e) => { await e.run('login', '--api-key-stdin'); await e.run('login', '--api-key-stdin', '--json'); await e.run('whoami', '--json'); await e.run('logout'); });
    await go({ stdin: KEY }, async (e) => { await e.run('login', '--api-key-stdin'); });
    await go({ stdin: `${KEY.slice(0, -1)}!` }, async (e) => { await e.run('login', '--api-key-stdin', '--json'); });

    const secrets = secretsOf(seen, [KEY, `${KEY.slice(0, -1)}!`]);
    expect(secrets.length).toBeGreaterThan(6); /* every env uses seed 21, so several envs see the same values */ expect(outputs.length).toBeGreaterThan(30);
    const all = outputs.join('\n');
    for (const s of secrets) { expect(all).not.toContain(s); expect(all).not.toContain(s.slice(0, 20)); }
    for (const re of TOKEN_SHAPES) expect(all).not.toMatch(re);
    expect(all).toMatch(/Code: [A-Z2-9]{4}-[A-Z2-9]{4}/); /* the user code is the one thing that is shown */
  });
});
