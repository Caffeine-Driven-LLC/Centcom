import { mkdtempSync, readdirSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { DemoEngine } from '@centcom/agent';
import { AppController } from '../src/controller.js';
import { SessionStore, ago, sanitizeItems, titleFrom } from '../src/sessions.js';
import type { Item } from '../src/state/model.js';

const tmp = () => new SessionStore(mkdtempSync(join(tmpdir(), 'cc-sessions-')));
const user = (t: string): Item => ({ kind: 'user', id: 'u' + t, text: t, ts: 1 });
const A = 'ses_01JTEST000000000000000000A', B = 'ses_01JTEST000000000000000000B', C = 'ses_01JTEST000000000000000000C';
const meta = (id: string, cwd = '/p', at = 1) => ({ id, cwd, engine: 'fake', title: id, createdAt: at, updatedAt: at, messages: 1 });
const idle = async (c: AppController) => { for (let i = 0; i < 400 && (c.state.busy || c.state.approvals.length); i++) await new Promise((r) => setTimeout(r, 25)); };

describe('session store', () => {
  it('saves, lists newest first for one folder, and loads back', () => {
    const st = tmp(); st.save(meta(A, '/p', 1), [user('first')]); st.close(); const t = Date.now() + 5000; while (Date.now() < t && st.list('/p')[0]?.updatedAt === undefined) break;
    st.save(meta(B, '/p', 5), [user('second')]); st.save(meta(C, '/other', 9), [user('x')]); st.close();
    expect(new Set(st.list('/p').map((m) => m.id))).toEqual(new Set([A, B])); expect(st.list().map((m) => m.id)).toHaveLength(3);
    expect(st.load(A)!.items[0]).toMatchObject({ kind: 'user', text: 'first' }); expect(st.load(A)!.meta).toMatchObject({ cwd: '/p', title: A, engine: 'fake' });
  });
  it('keeps files private and refuses ids that could escape the folder', () => {
    const st = tmp(); st.save(meta(A), [user('hi')]); st.close();
    for (const f of readdirSync(join(st.dir, A))) expect(statSync(join(st.dir, A, f)).mode & 0o777).toBe(0o600); expect(readdirSync(join(st.dir, A)).some((f) => f.endsWith('.tmp'))).toBe(false);
    expect(st.load('../../etc/passwd')).toBeUndefined(); st.delete('../x'); expect(st.list('/p')).toHaveLength(1);
  });
  it('survives a damaged file', () => { const st = tmp(); st.save(meta(A), [user('hi')]); st.close(); require('node:fs').writeFileSync(join(st.dir, 'index.json'), '{oops'); expect(st.list('/p')).toHaveLength(1); });
  it('moves conversations saved by older versions into the log, once', () => {
    const dir = mkdtempSync(join(tmpdir(), 'cc-sessions-')); const fs = require('node:fs'); fs.mkdirSync(join(dir, 'sessions')); fs.writeFileSync(join(dir, 'sessions', 'old1.meta.json'), JSON.stringify({ ...meta('old1'), engine: 'claude-code', resumeToken: 'claude-sess-1' })); fs.writeFileSync(join(dir, 'sessions', 'old1.items.json'), JSON.stringify([user('from before')]));
    const st = new SessionStore(dir); const l = st.list('/p'); expect(l).toHaveLength(1); expect(l[0]!.id).toMatch(/^ses_[0-9A-HJKMNP-TV-Z]{26}$/); expect(l[0]).toMatchObject({ engine: 'claude-code', resumeToken: 'claude-sess-1' });
    expect(st.load(l[0]!.id)!.items[0]).toMatchObject({ text: 'from before' }); expect(fs.existsSync(join(dir, 'sessions', 'old1.meta.json'))).toBe(false); st.close();
  });
  it('without a saved view, the transcript is rebuilt from the log', async () => {
    const st = tmp(); st.noteUser(A, '/p', 'question'); st.append(A, '/p', { v: 1, seq: 1, ts: 'x', agent_id: 'agt_x', type: 'text.done', message_id: 'm', text: 'the answer' } as never); st.close();
    expect(st.load(A)!.items.map((i) => i.kind)).toEqual(['user', 'assistant']); expect(st.list('/p')[0]).toMatchObject({ title: 'question', messages: 2 });
  });
  it('never replays half-finished work as if it were still running', () => {
    const items = sanitizeItems([{ kind: 'tool', id: 't', toolId: 't', agentId: 'a', name: 'Bash', summary: 'x', risk: 'low', status: 'running', startedAt: 0, approval: 'pending', result: 'y'.repeat(9000) }, { kind: 'assistant', id: 'a', messageId: 'm', agentId: 'a', text: 'hi', done: false }, { kind: 'notice', id: 'n', level: 'ok', text: 'Continuing "old"' }]);
    expect(items).toHaveLength(2); expect(items[0]).toMatchObject({ status: 'canceled', approval: undefined }); expect((items[0] as any).result.length).toBe(4000); expect(items[1]).toMatchObject({ done: true });
  });
  it('titles from the first message and words ages plainly', () => {
    expect(titleFrom([user('  fix   the\nauth bug ')])).toBe('fix the auth bug'); expect(titleFrom([])).toBe('Untitled');
    expect([ago(0, 30_000), ago(0, 5 * 60_000), ago(0, 3 * 3_600_000), ago(0, 2 * 86_400_000)]).toEqual(['just now', '5 min ago', '3 h ago', '2 days ago']);
  });
});

describe('continuing a conversation', () => {
  const make = (st: SessionStore, resume?: string) => new AppController({ engine: new DemoEngine({ speed: 200 }), demo: true, cwd: '/proj', version: 't', skills: [], sessions: st, resume });
  it('saves a finished turn, then /resume brings it back in a new process', async () => {
    const st = tmp(); const a = make(st); await a.start(); a.setMode('bypassPermissions'); await a.submit('fix the failing test in the auth module'); await idle(a); a.persist(); const sid = a.state.sessionId; a.stop();
    expect(st.list('/proj')).toHaveLength(1);
    const b = make(st, 'last'); await b.start();
    expect(b.state.sessionId).toBe(sid); expect(b.state.items.some((i) => i.kind === 'user' && i.text.includes('auth module'))).toBe(true); expect(b.state.items.some((i) => i.kind === 'assistant')).toBe(true);
    expect(b.state.items.some((i) => i.kind === 'notice' && /Continuing/.test(i.text))).toBe(true); b.stop();
  });
  it('/new keeps the old conversation saved and starts empty; /resume 1 returns to it', async () => {
    const st = tmp(); const a = make(st); await a.start(); a.setMode('bypassPermissions'); await a.submit('find where isExpired is used'); await idle(a); a.persist();
    const old = a.state.sessionId; await a.runCommand('/new'); expect(a.state.items).toHaveLength(0); expect(a.state.sessionId).not.toBe(old);
    expect(st.list('/proj').map((m) => m.id)).toContain(old);
    await a.runCommand('/resume 1'); expect(a.state.sessionId).toBe(old); expect(a.state.items.some((i) => i.kind === 'user')).toBe(true); a.stop();
  });
  it('says so when there is nothing to continue', async () => {
    const c = make(tmp(), 'last'); await c.start(); expect(c.state.items.some((i) => i.kind === 'notice' && /No saved conversation/.test(i.text))).toBe(true); c.stop();
  });
  it('does not rewrite the file when nothing changed', async () => {
    const st = tmp(); const a = make(st); await a.start(); a.setMode('bypassPermissions'); await a.submit('find where isExpired is used'); await idle(a); a.persist();
    const f = join(st.dir, a.state.sessionId, 'view.json'); const t1 = statSync(f).mtimeMs; await new Promise((r) => setTimeout(r, 30)); a.persist(); expect(statSync(f).mtimeMs).toBe(t1); a.stop();
  });
});

describe('saving a long conversation stays cheap', () => {
  const meta = (token?: string, engine = 'claude-code') => ({ id: A, cwd: '/tmp/p', engine, title: 't', createdAt: 1, updatedAt: 2, messages: 1, ...(token ? { resumeToken: token } : {}) });
  it('the log is read once per conversation, not on every save, and a changed engine session is still recorded', () => {
    const st = tmp(); let opens = 0; const sync = (st as any).store.sync; const open = sync.open.bind(sync); sync.open = (...a: unknown[]) => { opens++; return open(...a); };
    for (let i = 0; i < 6; i++) st.save(meta('tok-1'), [user('hello'), user('again ' + i)]); expect(opens).toBe(1);
    st.save(meta('tok-2'), [user('hello')]); expect(st.load(A)!.meta.resumeToken).toBe('tok-2'); st.save(meta('tok-2'), [user('hello')]); expect(st.load(A)!.meta.resumeToken).toBe('tok-2');
    st.save(meta('tok-3', 'codex'), [user('hello')]); expect(st.load(A)!.meta).toMatchObject({ resumeToken: 'tok-3', engine: 'codex' });
  });
  it('the first user message is recorded once, and what was saved loads back', () => {
    const st = tmp(); st.save(meta(), [user('first question')]); st.save(meta(), [user('first question'), user('second')]); const l = st.load(A)!; expect(l.items.map((i) => (i as { text?: string }).text)).toEqual(['first question', 'second']);
  });
});
