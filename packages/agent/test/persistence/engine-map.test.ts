import { describe, expect, it } from 'vitest';
import { FakeEngine } from '@centcom/testkit';
import { ProviderError, resumeSession, type AgentEngine, type NormalisedEvent } from '../../src/index.js';
import { claudeGolden, rig } from './rig.js';

describe('engine session map and resume', () => {
  it('the recorded Claude Code stream stores its session id, and resume starts the engine with exactly that id', async () => {
    const { store } = rig(); const golden = claudeGolden(); const init = golden.find((e) => e.type === 'session.started') as Extract<NormalisedEvent, { type: 'session.started' }>;
    const h = store.sync.create({ cwd: '/w' }); h.note('user.message', { text: 'list the files' }); for (const e of golden) h.append(e); await h.close();
    const s = store.sync.open(h.id); expect(s.engineSessions[0]).toMatchObject({ engine: 'claude-code', engineSessionId: init.engine_session_id }); expect(s.engineSessions).toHaveLength(1);
    const engine = new FakeEngine({ id: 'claude-code' }); const r = await resumeSession({ store, engines: { get: (id) => (id === 'claude-code' ? (engine as unknown as AgentEngine) : undefined) } }, h.id, { start: { cwd: '/w' } });
    expect(r.mode).toBe('engine-resumed'); expect(engine.starts[0]!.resume).toBe(init.engine_session_id);
  });
  it('an engine without resume, or one that refuses the id, continues fresh from a summary of the last 40 messages (at most 8 KiB); a new engine session row is added', async () => {
    const { store } = rig(); const h = store.sync.create({ cwd: '/w' });
    for (let i = 0; i < 60; i++) { h.note('user.message', { text: `question ${i}` }); h.append({ v: 1, seq: i, ts: 'x', agent_id: 'agt_01JTEST0000000000000000001', type: 'text.done', message_id: `m${i}`, text: `answer ${i} ` + 'z'.repeat(300) } as NormalisedEvent); }
    h.append({ v: 1, seq: 99, ts: 'x', agent_id: 'agt_01JTEST0000000000000000001', type: 'session.started', engine: 'codex', engine_session_id: 'thread_1', model: 'm', tools: [], mcp_servers: [], capabilities: [], login_kind: 'subscription' } as unknown as NormalisedEvent); await h.close();
    const noResume = new FakeEngine({ id: 'codex' }); noResume.capabilities = () => new Set(['streaming']) as never; const r = await resumeSession({ store, engines: { get: () => noResume as unknown as AgentEngine } }, h.id, { start: { cwd: '/w' } });
    expect(r.mode).toBe('fresh-with-summary'); expect(Buffer.byteLength(r.summary!)).toBeLessThanOrEqual(8 * 1024 + 100); expect(r.summary).toContain('answer 59'); expect(r.summary).not.toContain('question 19'); expect(noResume.starts[0]!.resume).toBeUndefined(); expect(noResume.sessions[0]!.o.systemPromptAppend).toContain('answer 59');
    const refusing = { id: 'codex', label: 'Codex', provider: 'openai', capabilities: () => new Set(['resume']), start: async (o: { resume?: unknown }) => { if (o.resume) throw new ProviderError('provider_capability_missing', 'codex', 'thread not found'); return { agentId: 'a', events: (async function* () {})(), send: async () => ({ turn_id: 't' }), interrupt: async () => ({ stopped: false }), stop: async () => undefined, resumeToken: () => 'thread_2' }; } } as unknown as AgentEngine;
    const r2 = await resumeSession({ store, engines: { get: () => refusing } }, h.id, { start: { cwd: '/w' } }); expect(r2.mode).toBe('fresh-with-summary'); expect(r2.reason).toContain('thread not found');
    const h2 = store.sync.resume(h.id); h2.append({ v: 1, seq: 1, ts: 'x', agent_id: 'agt_01JTEST0000000000000000001', type: 'session.started', engine: 'codex', engine_session_id: 'thread_2', model: 'm', tools: [], mcp_servers: [], capabilities: [], login_kind: 'subscription' } as unknown as NormalisedEvent); await h2.close();
    expect(store.sync.open(h.id).engineSessions.map((e) => e.engineSessionId)).toEqual(['thread_1', 'thread_2']);
  });
  it('no engine here: read-only', async () => {
    const { store } = rig(); const h = store.sync.create({ cwd: '/w' }); h.recordEngineSession({ engine: 'codex', engineSessionId: 't', sinceSeq: 1 }); await h.close();
    expect((await resumeSession({ store, engines: { get: () => undefined } }, h.id)).mode).toBe('read-only');
  });
  it('toSnapshotEvents gives the normalised events from a sequence number on, in order, redacted', async () => {
    const { store } = rig(); const golden = claudeGolden(); const h = store.sync.create({ cwd: '/w' }); for (const e of golden) h.append(e); await h.close();
    const evs = await store.toSnapshotEvents(h.id, { fromSeq: 10 }); expect(evs.length).toBeGreaterThan(0); expect(evs.every((e) => e.seq >= 10)).toBe(true); expect(evs.map((e) => e.seq)).toEqual([...evs.map((e) => e.seq)].sort((a, b) => a - b));
    const all = await store.toSnapshotEvents(h.id); expect(all.map((e) => e.type)).toEqual(golden.map((e) => e.type)); expect(all.some((e) => (e as { type: string }).type === 'session.meta')).toBe(false);
  });
});
