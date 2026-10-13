import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { chooseEngine, type EngineName } from '../src/engine-pick.js';
import { startRemoteFlags, watchEngineFlag } from '../src/remote-flags.js';

const feed = (flags: Record<string, unknown>, etag = 'W/"1"') => (async () => new Response(JSON.stringify({ flags, rev: 7, ttl_s: 60 }), { status: 200, headers: { 'content-type': 'application/json', etag } })) as unknown as typeof fetch;
const tick = async () => { for (let i = 0; i < 20; i++) await new Promise((r) => setTimeout(r, 5)); };
const run = (have: EngineName[], blocked: EngineName[], o: { explicit?: EngineName; preferred?: EngineName } = {}) => chooseEngine({ demo: false, explicit: o.explicit, preferred: o.preferred, installed: async (e) => have.includes(e), blocked: (e) => blocked.includes(e) });

describe('which agent starts when the service has switched one off (lane C067)', () => {
  it('a switched-off agent is not used: the other installed one is, and the note says why and that it comes back by itself', async () => {
    const r = await run(['claude-code', 'codex'], ['claude-code']); expect(r.engine).toBe('codex'); expect(r.note).toContain('Claude Code has been switched off by Centcom for now, so this session uses Codex'); expect(r.note).toContain('comes back by itself'); expect(r.note).not.toContain('not found');
  });
  it('an agent asked for with --engine is never swapped silently: the demo, with the reason', async () => {
    const r = await run(['claude-code', 'codex'], ['codex'], { explicit: 'codex' }); expect(r.engine).toBe('demo'); expect(r.note).toContain('Codex has been switched off by Centcom for now, so this is the demo agent');
  });
  it('both off is the demo; nothing off changes nothing', async () => {
    expect((await run(['claude-code', 'codex'], ['claude-code', 'codex'])).engine).toBe('demo'); expect(await run(['claude-code'], [])).toEqual({ engine: 'claude-code', note: '' });
  });
});

describe('the flags client in the app', () => {
  it('without any answer yet everything is on; after the feed says false the agent is blocked, and it stays blocked from the saved copy on the next start with no network', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'cc-flags-')); const a = startRemoteFlags({ baseUrl: 'http://127.0.0.1:9', version: 't', dir, env: {}, fetch: feed({ 'provider.claude_code': false, 'provider.codex': true }) });
    expect(a.blocked('claude-code')).toBe(false); await tick(); expect(a.blocked('claude-code')).toBe(true); expect(a.blocked('codex')).toBe(false); a.stop();
    const offline = (async () => { throw new Error('no network'); }) as unknown as typeof fetch; const b = startRemoteFlags({ baseUrl: 'http://127.0.0.1:9', version: 't', dir, env: {}, fetch: offline }); expect(b.blocked('claude-code')).toBe(true); await tick(); expect(b.blocked('claude-code')).toBe(true); b.stop();
  });
  it('a feed that cannot be reached, or sends nonsense or the wrong type, leaves everything on', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'cc-flags-')); const a = startRemoteFlags({ baseUrl: 'http://127.0.0.1:9', version: 't', dir, env: {}, fetch: feed({ 'provider.claude_code': 'no', 'provider.codex': 0 }) }); await tick(); expect(a.blocked('claude-code')).toBe(false); expect(a.blocked('codex')).toBe(false); a.stop();
    const dir2 = mkdtempSync(join(tmpdir(), 'cc-flags-')); const b = startRemoteFlags({ baseUrl: 'http://127.0.0.1:9', version: 't', dir: dir2, env: {}, fetch: (async () => { throw new Error('down'); }) as never }); await tick(); expect(b.blocked('claude-code')).toBe(false); b.stop();
  });
  it('while the app runs, a switch-off of the agent in use is said once and nothing is stopped; other flags and the other agent say nothing', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'cc-flags-')); let body: Record<string, unknown> = { 'provider.claude_code': true }; const f = (async () => new Response(JSON.stringify({ flags: body, rev: 8, ttl_s: 30 }), { status: 200, headers: { 'content-type': 'application/json' } })) as unknown as typeof fetch;
    const a = startRemoteFlags({ baseUrl: 'http://127.0.0.1:9', version: 't', dir, env: {}, fetch: f }); await tick(); const said: string[] = []; const off = watchEngineFlag(a, 'claude-code', (t) => said.push(t));
    body = { 'provider.claude_code': false }; await a.client.refresh(); expect(said).toHaveLength(1); expect(said[0]).toContain('Claude Code has been switched off'); await a.client.refresh(); expect(said).toHaveLength(1); off(); a.stop();
    const b = startRemoteFlags({ baseUrl: 'http://127.0.0.1:9', version: 't', dir: mkdtempSync(join(tmpdir(), 'cc-flags-')), env: {}, fetch: f }); const s2: string[] = []; watchEngineFlag(b, 'codex', (t) => s2.push(t)); body = { 'provider.claude_code': false, 'provider.codex': true }; await b.client.refresh(); expect(s2).toEqual([]); b.stop();
  });
});
