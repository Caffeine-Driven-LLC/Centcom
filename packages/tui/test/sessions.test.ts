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
const meta = (id: string, cwd = '/p', at = 1) => ({ id, cwd, engine: 'fake', title: id, createdAt: at, updatedAt: at, messages: 1 });
const idle = async (c: AppController) => { for (let i = 0; i < 400 && (c.state.busy || c.state.approvals.length); i++) await new Promise((r) => setTimeout(r, 25)); };

describe('session store', () => {
  it('saves, lists newest first for one folder, and loads back', () => {
    const st = tmp(); st.save(meta('ses_a', '/p', 1), [user('first')]); st.save(meta('ses_b', '/p', 5), [user('second')]); st.save(meta('ses_c', '/other', 9), [user('x')]);
    expect(st.list('/p').map((m) => m.id)).toEqual(['ses_b', 'ses_a']); expect(st.list().map((m) => m.id)[0]).toBe('ses_c');
    expect(st.load('ses_a')!.items[0]).toMatchObject({ kind: 'user', text: 'first' });
  });
  it('keeps files private and refuses ids that could escape the folder', () => {
    const st = tmp(); st.save(meta('ses_a'), [user('hi')]);
    expect(statSync(join(st.dir, 'ses_a.items.json')).mode & 0o777).toBe(0o600); expect(readdirSync(st.dir).some((f) => f.endsWith('.tmp'))).toBe(false);
    expect(st.load('../../etc/passwd')).toBeUndefined(); st.delete('../x'); expect(st.list('/p')).toHaveLength(1);
  });
  it('survives a damaged file', () => { const st = tmp(); st.save(meta('ses_a'), [user('hi')]); require('node:fs').writeFileSync(join(st.dir, 'ses_zz.meta.json'), '{oops'); expect(st.list('/p')).toHaveLength(1); });
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
    const f = join(st.dir, `${a.state.sessionId}.meta.json`); const t1 = statSync(f).mtimeMs; await new Promise((r) => setTimeout(r, 30)); a.persist(); expect(statSync(f).mtimeMs).toBe(t1); a.stop();
  });
});
