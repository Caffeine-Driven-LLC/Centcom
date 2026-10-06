import { describe, expect, it } from 'vitest';
import { AGT, mk } from '../engine/helpers.js';
import { mapState } from '../../src/index.js';
import { FILES, rig } from './helpers.js';

describe('status', () => {
  it('maps the engine words to states and keeps the engine\'s error text verbatim', () => {
    const r = rig({ status: (e) => (e === 'claude-code' ? { servers: [{ name: 'files', status: 'connected', tools: 12 }, { name: 'gh', status: 'needs-auth' }, { name: 'bad', status: 'failed' }, { name: 'slow', status: 'pending' }, { name: 'off', status: 'disabled' }, { name: 'weird', status: 'martian' }], errors: [{ name: 'bad', error: 'spawn ENOENT: some-mcp (Wörter mit "Zeichen")' }] } : undefined) });
    const claude = r.mgr.status().find((s) => s.engine === 'claude-code')!; expect(claude.reported).toBe(true); expect(Object.fromEntries(claude.servers.filter((s) => !s.builtin).map((s) => [s.name, s.state]))).toEqual({ files: 'connected', gh: 'needs_auth', bad: 'failed', slow: 'pending', off: 'disabled', weird: 'unknown' });
    expect(claude.servers.find((s) => s.name === 'bad')!.error).toBe('spawn ENOENT: some-mcp (Wörter mit "Zeichen")'); expect(claude.servers.find((s) => s.name === 'files')!.tools).toBe(12);
  });
  it('an engine that does not say shows "not reported" and the built-in entry as unknown; config edits still work', async () => {
    const r = rig(); const codex = r.mgr.status().find((s) => s.engine === 'codex')!; expect(codex.reported).toBe(false); expect(codex.servers).toEqual([{ name: 'centcom-approvals', state: 'unknown', builtin: true }]); const p = await r.mgr.plan({ kind: 'add', engine: 'codex', scope: 'project', def: FILES, root: r.root }); expect(p.targets).toHaveLength(1);
  });
  it('the built-in entry shows as connected when the engine reports it', () => { const r = rig({ status: () => ({ servers: [{ name: 'centcom-approvals', status: 'connected' }] }) }); expect(r.mgr.status()[0]!.servers[0]).toEqual({ name: 'centcom-approvals', state: 'connected', builtin: true }); });
  it('a session.started event on the bus updates the status and emits mcp:status', () => {
    const r = rig(); r.bus.emit('agent:event', { agent_id: AGT as never, seq: 1, event: mk({ type: 'session.started', engine: 'claude-code', engine_session_id: 's', model: 'm', tools: [], mcp_servers: [{ name: 'files', status: 'connected' }, { name: 'gh', status: 'needs-auth' }], capabilities: [], login_kind: 'unknown' }) });
    expect(r.events).toHaveLength(1); expect(r.events[0]).toMatchObject({ engine: 'claude-code' }); const s = r.mgr.status().find((x) => x.engine === 'claude-code')!; expect(s.reported).toBe(true); expect(s.servers.filter((x) => !x.builtin).map((x) => [x.name, x.state])).toEqual([['files', 'connected'], ['gh', 'needs_auth']]);
    r.bus.emit('agent:event', { agent_id: AGT as never, seq: 2, event: mk({ type: 'session.started', engine: 'fake', engine_session_id: 's', model: 'm', tools: [], mcp_servers: [], capabilities: [], login_kind: 'unknown' }) }); expect(r.events).toHaveLength(1);
  });
  it('dispose stops listening', () => { const r = rig(); r.mgr.dispose(); r.bus.emit('agent:event', { agent_id: AGT as never, seq: 1, event: mk({ type: 'session.started', engine: 'codex', engine_session_id: 's', model: 'm', tools: [], mcp_servers: [], capabilities: [], login_kind: 'unknown' }) }); expect(r.events).toEqual([]); });
  it.each([['connected', 'connected'], ['CONNECTED', 'connected'], ['needs-auth', 'needs_auth'], ['needs_auth', 'needs_auth'], ['failed', 'failed'], ['', 'unknown'], ['???', 'unknown']])('%j -> %s', (w, s) => { expect(mapState(w)).toBe(s); });
});

describe('test connection', () => {
  it('a missing command is failed command_not_found and no session is started', async () => { const r = rig({ which: () => undefined }); expect(await r.mgr.testServer(FILES, 'claude-code')).toEqual({ name: 'files', state: 'failed', error: 'command_not_found' }); expect(r.sessions).toEqual([]); });
  it('a good command starts exactly one session with a config holding only that server, and reports the engine\'s answer', async () => {
    const r = rig(); const s = await r.mgr.testServer(FILES, 'claude-code'); expect(s).toEqual({ name: 'files', state: 'connected', tools: 3 }); expect(r.sessions).toHaveLength(1); expect(r.sessions[0]!.engine).toBe('claude-code'); expect(JSON.parse(r.sessions[0]!.json)).toEqual({ mcpServers: { files: { type: 'stdio', command: 'npx', args: ['-y', 'some-mcp'] } } }); expect(r.clock.pending()).toBe(0);
  });
  it('the engine\'s error is passed through; a server missing from the answer is unknown', async () => {
    const f = rig({ testSession: async () => ({ servers: [{ name: 'files', status: 'failed' }], errors: [{ name: 'files', error: 'exit 1: bad token' }] }) }); expect(await f.mgr.testServer(FILES, 'codex')).toEqual({ name: 'files', state: 'failed', error: 'exit 1: bad token' });
    const u = rig({ testSession: async () => ({ servers: [] }) }); expect((await u.mgr.testServer(FILES, 'codex')).state).toBe('unknown');
  });
  it('a session that never answers is failed: timeout at exactly 30 s, and it is told to stop', async () => {
    let signal: AbortSignal | undefined; const r = rig({ testSession: (_e, _j, o) => { signal = o.signal; return new Promise(() => undefined); } }); let out: unknown; const p = r.mgr.testServer(FILES, 'claude-code').then((x) => { out = x; }); await new Promise((x) => setImmediate(x));
    await r.clock.advance(29_999); expect(out).toBeUndefined(); expect(signal!.aborted).toBe(false); await r.clock.advance(1); await p; expect(out).toEqual({ name: 'files', state: 'failed', error: 'timeout' }); expect(signal!.aborted).toBe(true);
  });
  it('a session that throws is failed, not an exception', async () => { const r = rig({ testSession: async () => { throw new Error('boom: sk-ant-api03-' + 'A'.repeat(30)); } }); const s = await r.mgr.testServer(FILES, 'claude-code'); expect(s).toEqual({ name: 'files', state: 'failed', error: 'session_failed' }); expect(JSON.stringify(s)).not.toContain('sk-ant'); });
  it('http://example.com is rejected, https://example.com and http://127.0.0.1:8080 are tried', async () => {
    const r = rig(); expect(await r.mgr.testServer({ name: 'a', transport: 'http', url: 'http://example.com' }, 'claude-code')).toMatchObject({ state: 'failed', error: 'invalid_definition' }); expect(r.sessions).toEqual([]); for (const url of ['https://example.com', 'http://127.0.0.1:8080']) expect((await r.mgr.testServer({ name: 'a', transport: 'http', url }, 'claude-code')).state).toBe('connected'); expect(r.sessions).toHaveLength(2);
  });
  it('a definition with a secret is failed without starting anything', async () => { const r = rig(); expect(await r.mgr.testServer({ ...FILES, args: ['ghp_' + 'x'.repeat(36)] }, 'claude-code')).toEqual({ name: 'files', state: 'failed', error: 'secret_rejected' }); expect(r.sessions).toEqual([]); });
  it('the command is only looked up, never executed by Centcom', async () => { const looked: string[] = []; const r = rig({ which: (c) => { looked.push(c); return c; } }); await r.mgr.testServer({ ...FILES, command: 'definitely-not-run; touch /tmp/x' }, 'claude-code'); expect(looked).toEqual(['definitely-not-run; touch /tmp/x']); });
});
