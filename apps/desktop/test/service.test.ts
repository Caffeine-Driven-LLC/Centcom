import { mkdirSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { createBoard } from '@centcom/agent';
import { LocalService, listDir, sanitise } from '../src/local/service.js';
import { Workspace } from '../src/local/workspace.js';

describe('messages from a screen are checked', () => {
  it('drops junk and caps text', () => {
    for (const bad of [null, 5, 'x', {}, { t: 5 }, { t: 'nope' }, { t: 'browse' }, { t: 'open', dir: 5 }, { t: 'setMode', mode: 'yolo' }, { t: 'setModel' }]) expect(sanitise(bad), JSON.stringify(bad)).toBeUndefined();
    expect((sanitise({ t: 'submit', text: 'a'.repeat(150_000) }) as { text: string }).text).toHaveLength(100_000); expect(sanitise({ t: 'submit', text: 'a'.repeat(250_000) })).toBeUndefined();
    expect(sanitise({ t: 'approve', decision: 'maybe', scope: 'forever', extra: 1 })).toEqual({ t: 'approve', decision: 'deny' }); expect(sanitise({ t: 'open', dir: '/x', engine: 'evil', demo: 'yes' })).toEqual({ t: 'open', dir: '/x', demo: false, engine: 'claude-code' });
    expect(sanitise({ t: 'setEffort', effort: 'high' })).toEqual({ t: 'setEffort', effort: 'high' }); expect(sanitise({ t: 'setEffort', effort: 'a b; rm' })).toBeUndefined(); expect(sanitise({ t: 'setEffort' })).toBeUndefined(); expect(sanitise({ t: 'note', type: 'warning', text: ' x ' })).toEqual({ t: 'note', type: 'warning', text: 'x' }); expect(sanitise({ t: 'note', type: 'evil', text: 'y' })).toEqual({ t: 'note', type: 'decision', text: 'y' }); expect(sanitise({ t: 'note', text: '   ' })).toBeUndefined(); expect(sanitise({ t: 'note', text: 'a'.repeat(281) })).toBeUndefined();
    expect(sanitise({ t: 'teamWatch', agent: 'agt_1' })).toEqual({ t: 'teamWatch', agent: 'agt_1' }); expect(sanitise({ t: 'teamWatch' })).toEqual({ t: 'teamWatch' }); expect(sanitise({ t: 'shareActivity', on: true })).toEqual({ t: 'shareActivity', on: true });
    expect(sanitise({ t: 'shareHandoff', to: 'mem_1', note: 'x' })).toEqual({ t: 'shareHandoff', to: 'mem_1', note: 'x' }); expect(sanitise({ t: 'shareHandoff' })).toBeUndefined(); expect(sanitise({ t: 'shareHandoffAnswer', id: 'h1', accept: true })).toEqual({ t: 'shareHandoffAnswer', id: 'h1', accept: true });
    expect(sanitise({ t: 'notePin', id: 'e1', pinned: 'yes' })).toEqual({ t: 'notePin', id: 'e1', pinned: false }); expect(sanitise({ t: 'notePin' })).toBeUndefined(); expect(sanitise({ t: 'noteRemove', id: 5 })).toBeUndefined(); expect(sanitise({ t: 'board', extra: 1 })).toEqual({ t: 'board' });
    expect(sanitise({ t: 'leave', extra: 1 })).toEqual({ t: 'leave' }); expect(sanitise({ t: 'models', extra: 1 })).toEqual({ t: 'models' }); expect(sanitise({ t: 'compact' })).toEqual({ t: 'compact' });
    expect(sanitise({ t: 'pref', theme: 'neon', side: 'no' })).toEqual({ t: 'pref' }); expect(sanitise({ t: 'setMode', mode: 'plan' })).toEqual({ t: 'setMode', mode: 'plan' });
  });
});
describe('the folder picker', () => {
  it('lists folders only, git first, without hidden ones or node_modules', () => {
    const d = mkdtempSync(join(tmpdir(), 'cc-ls-')); for (const n of ['b', 'a', '.hid', 'node_modules', 'g/.git']) mkdirSync(join(d, n), { recursive: true });
    const r = listDir(d, d); expect(r.entries.map((e) => e.name)).toEqual(['g', 'a', 'b']); expect(r.git).toBe(false); expect(listDir(join(d, 'nope'), d).error).toBe('Cannot read this folder.');
  });
});
describe('the service', () => {
  it('opening a missing folder is an error notice; a window that detaches is forgotten', async () => {
    const home = mkdtempSync(join(tmpdir(), 'cc-home-')); const svc = new LocalService({ home, cwd: home }); const got: { t: string; text?: string }[] = [];
    const w = svc.attach('w1', (m) => got.push(m as never)); await w.handle({ t: 'open', dir: join(home, 'missing') }); await w.handle('junk');
    expect(got).toEqual([{ t: 'notice', level: 'error', text: 'That folder does not exist.' }]); await w.handle({ t: 'browse', path: home }); expect(got.at(-1)).toMatchObject({ t: 'dir', path: home }); w.detach(); svc.shutdown();
  });
});

describe('running sessions', () => {
  it('every window is told which sessions are alive; leaving a project keeps its agent, closing it ends it', async () => {
    const home = mkdtempSync(join(tmpdir(), 'cc-run-')); const dir = join(home, 'proj'); mkdirSync(dir); const svc = new LocalService({ home, cwd: home });
    const a: { t: string; sessions?: { dir: string; demo: boolean }[] }[] = []; const b: typeof a = [];
    const wa = svc.attach('a', (m) => a.push(m as never)); const wb = svc.attach('b', (m) => b.push(m as never));
    await wb.handle({ t: 'hello' }); expect(b.find((m) => m.t === 'running')?.sessions).toEqual([]);
    await wa.handle({ t: 'open', dir, demo: true });
    const last = (xs: typeof a) => xs.filter((m) => m.t === 'running').at(-1)?.sessions;
    expect(last(a)).toMatchObject([{ dir, demo: true, busy: false, waiting: 0 }]); expect(last(b)).toMatchObject([{ dir, demo: true }]);
    await wa.handle({ t: 'leave' }); expect(a.at(-1)).toEqual({ t: 'closed' }); expect(last(a)).toMatchObject([{ dir }]);
    await wa.handle({ t: 'open', dir, demo: true }); await wa.handle({ t: 'close' }); expect(last(a)).toEqual([]); expect(last(b)).toEqual([]); wa.detach(); wb.detach(); svc.shutdown();
  }, 30_000);
  it('a model list request in the demo answers with models and no per-agent menu', async () => {
    const home = mkdtempSync(join(tmpdir(), 'cc-mm-')); const dir = join(home, 'proj'); mkdirSync(dir); const svc = new LocalService({ home, cwd: home });
    const got: { t: string }[] = []; const w = svc.attach('a', (m) => got.push(m as never)); await w.handle({ t: 'open', dir, demo: true }); await w.handle({ t: 'models' });
    expect(got.some((m) => m.t === 'models')).toBe(true); expect(got.some((m) => m.t === 'engineModels')).toBe(false); w.detach(); svc.shutdown();
  }, 30_000);
  it('the opened message says which agent the window shows', async () => {
    const home = mkdtempSync(join(tmpdir(), 'cc-eng-')); const dir = join(home, 'proj'); mkdirSync(dir); const svc = new LocalService({ home, cwd: home });
    const got: { t: string; engine?: string; demo?: boolean }[] = []; const w = svc.attach('a', (m) => got.push(m as never));
    await w.handle({ t: 'open', dir, demo: true }); expect(got.find((m) => m.t === 'opened')).toMatchObject({ engine: 'claude-code', demo: true });
    w.detach(); svc.shutdown();
  }, 30_000);
});

describe('the context board in a session', () => {
  it('the demo has no board (its runtime keeps simple rules), and the screen is told so', async () => {
    const home = mkdtempSync(join(tmpdir(), 'cc-board-')); const dir = join(home, 'proj'); mkdirSync(dir); const svc = new LocalService({ home, cwd: home });
    const got: { t: string; enabled?: boolean }[] = []; const w = svc.attach('w', (m) => got.push(m as never));
    await w.handle({ t: 'board' }); expect(got.at(-1)).toEqual({ t: 'board', enabled: false, notes: [] });
    await w.handle({ t: 'open', dir, demo: true }); await w.handle({ t: 'board' }); expect(got.at(-1)).toEqual({ t: 'board', enabled: false, notes: [] }); w.detach(); svc.shutdown();
  }, 30_000);
  it('the notes of a workspace are the board, newest first, with who wrote them; pin and remove go to the board and refresh the screens', () => {
    let t = 1_000; const board = createBoard({ file: join(mkdtempSync(join(tmpdir(), 'cc-bf-')), 'board.jsonl'), now: () => t });
    t += 1; board.post({ author: { kind: 'agent', id: 'a1', name: 'Agent 1' }, type: 'finding', text: 'tests need the mock backend', files: ['a.ts'] });
    t += 1; board.post({ author: { kind: 'person', id: 'you', name: 'you' }, type: 'decision', text: 'use pnpm', pinned: true });
    const pushed: number[] = []; const ws = { board, lastBoard: 'old', push: () => pushed.push(1) };
    const r = Workspace.prototype.notes.call(ws as never);
    expect(r.enabled).toBe(true); expect(r.notes.map((n) => [n.text, n.author, n.person, n.pinned, n.type])).toEqual([['use pnpm', 'you', true, true, 'decision'], ['tests need the mock backend', 'Agent 1', false, false, 'finding']]); expect(r.notes[1]!.files).toEqual(['a.ts']);
    const id = r.notes[0]!.id; Workspace.prototype.pinNote.call(ws as never, id, false); expect(board.get(id)!.pinned).toBe(false); expect(ws.lastBoard).toBe(''); expect(pushed).toHaveLength(1);
    Workspace.prototype.removeNote.call(ws as never, id); expect(board.get(id)).toBeUndefined(); expect(pushed).toHaveLength(2);
    expect(Workspace.prototype.notes.call({ board: undefined } as never)).toEqual({ enabled: false, notes: [] });
  });
});
