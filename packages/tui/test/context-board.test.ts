import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createBoard, type Board } from '@centcom/agent';
import { FakeEngine } from '@centcom/testkit';
import { describe, expect, it } from 'vitest';
import { AppController } from '../src/controller.js';

const until = async (f: () => boolean, ms = 4000) => { const t0 = Date.now(); while (!f()) { if (Date.now() - t0 > ms) throw new Error('timeout'); await new Promise((r) => setTimeout(r, 15)); } };
const tick = () => new Promise((r) => setTimeout(r, 20));
async function rig(withBoard = true) {
  const board = withBoard ? createBoard({ file: join(mkdtempSync(join(tmpdir(), 'cc-ctlboard-')), 'board.jsonl') }) : undefined; const engine = new FakeEngine({ id: 'claude-code' });
  const ctl = new AppController({ engine: engine as never, demo: false, cwd: '/tmp', version: 't', skills: [], ...(board ? { board } : {}) }); await ctl.start(); return { ctl, engine, board: board as Board };
}
const other = { kind: 'agent' as const, id: 'agt_other', name: 'Agent 2' };
const notices = (c: AppController) => c.state.items.filter((i) => i.kind === 'notice') as { text: string; detail?: string }[];

describe('notes from other agents go along with the next message', () => {
  it('the prompt starts with the block, the transcript shows what you typed plus a notice of what was added, and the next message has nothing new', async () => {
    const { ctl, engine, board } = await rig(); board.post({ author: other, type: 'warning', text: 'src/parse.ts is being rewritten', files: ['src/parse.ts'] });
    await ctl.submit('fix the importer'); await until(() => engine.sessions[0]!.prompts.length === 1); await until(() => !ctl.state.busy); const p = engine.sessions[0]!.prompts[0]!;
    expect(p.startsWith('<team-context>')).toBe(true); expect(p).toContain('[warning] src/parse.ts is being rewritten (src/parse.ts) · Agent 2'); expect(p.endsWith('</team-context>\n\nfix the importer')).toBe(true);
    expect(ctl.state.items.filter((i) => i.kind === 'user').map((i) => (i.kind === 'user' ? i.text : ''))).toEqual(['fix the importer']); expect(notices(ctl).at(-1)).toMatchObject({ text: '1 note from other agents went along with this message' }); expect(notices(ctl).at(-1)!.detail).toContain('src/parse.ts is being rewritten');
    await ctl.submit('and now the tests'); await until(() => engine.sessions[0]!.prompts.length === 2); expect(engine.sessions[0]!.prompts[1]).toBe('and now the tests'); ctl.stop();
  });
  it('its own notes are not sent back to it; with the board off nothing is added and nothing breaks', async () => {
    const { ctl, engine, board } = await rig(); board.post({ author: { kind: 'agent', id: 'agt_you', name: 'you' }, type: 'finding', text: 'my own finding' }); await ctl.submit('go'); await until(() => engine.sessions[0]!.prompts.length === 1); expect(engine.sessions[0]!.prompts[0]).toBe('go'); ctl.stop();
    const off = await rig(false); await off.ctl.submit('go'); await until(() => off.engine.sessions[0]!.prompts.length === 1); expect(off.engine.sessions[0]!.prompts[0]).toBe('go'); await off.ctl.runCommand('/context'); expect(off.ctl.state.toasts.at(-1)!.text).toMatch(/turned off/); off.ctl.stop();
  });
  it('a new conversation is told everything again (the agent starts empty); after a compaction too', async () => {
    const { ctl, engine, board } = await rig(); board.post({ author: other, type: 'decision', text: 'use pnpm, never npm', pinned: true }); await ctl.submit('one'); await until(() => engine.sessions[0]!.prompts.length === 1); await until(() => !ctl.state.busy);
    await ctl.runCommand('/new'); await ctl.submit('two'); await until(() => engine.sessions.length === 2 && engine.sessions[1]!.prompts.length === 1); expect(engine.sessions[1]!.prompts[0]).toContain('use pnpm, never npm'); ctl.stop();
  });
});

describe('/note and /context', () => {
  it('/note pins a decision for every agent; a prefix picks the kind; bare /note asks what to say; an empty note says so', async () => {
    const { ctl, board } = await rig(); await ctl.runCommand('/note we ship on Friday'); await ctl.runCommand('/note warning: the staging DB is down'); await ctl.runCommand('/note finding:the cache key is the file path');
    expect(board.list().map((e) => [e.type, e.text, e.pinned, e.author.kind])).toEqual([['decision', 'we ship on Friday', true, 'person'], ['warning', 'the staging DB is down', true, 'person'], ['finding', 'the cache key is the file path', true, 'person']]); expect(ctl.state.toasts.at(-1)!.text).toBe('Noted: every agent gets it with its next message.');
    const ask = ctl.runCommand('/note'); await tick(); expect(notices(ctl).at(-1)!.text).toBe('What should every agent know?'); await ctl.submit('never edit generated files'); await ask; expect(board.list().at(-1)).toMatchObject({ type: 'decision', text: 'never edit generated files' });
    const none = ctl.runCommand('/note'); await tick(); (ctl as unknown as { cancelQuestions(): void }).cancelQuestions(); await none; expect(board.list()).toHaveLength(4); ctl.stop();
  });
  it('/context lists the board newest first; open an entry to pin it, take it off, or close; an empty board says how to fill it', async () => {
    const { ctl, board } = await rig(); await ctl.runCommand('/context'); expect(ctl.state.toasts.at(-1)!.text).toMatch(/The board is empty/);
    const a = board.post({ author: other, type: 'finding', text: 'older finding', files: ['a.ts'] })!; await new Promise((r) => setTimeout(r, 5)); const b = board.post({ author: { kind: 'person', id: 'you', name: 'you' }, type: 'decision', text: 'newer decision', pinned: true })!;
    const run = ctl.runCommand('/context'); await tick(); expect(ctl.state.pick!.title).toBe('Context board (2)'); expect(ctl.state.pick!.options.map((o) => o.id)).toEqual([b.id, a.id]); expect(ctl.state.pick!.options[0]!.label).toBe('★ [decision] newer decision'); expect(ctl.state.pick!.options[1]!.hint).toMatch(/Agent 2 · .* · a\.ts/);
    ctl.pickKey('down'); ctl.pickKey('enter'); await tick(); expect(ctl.state.pick!.options.map((o) => o.id)).toEqual(['pin', 'retract', 'close']); ctl.pickKey('enter'); await run; expect(board.get(a.id)!.pinned).toBe(true);
    const again = ctl.runCommand('/context'); await tick(); ctl.pickKey('enter'); await tick(); ctl.pickKey('down'); ctl.pickKey('enter'); await again; expect(board.get(b.id)).toBeUndefined(); expect(ctl.state.toasts.at(-1)!.text).toBe('Taken off the board.');
    const esc = ctl.runCommand('/context'); await tick(); ctl.pickKey('cancel'); await esc; expect(board.list()).toHaveLength(1); ctl.stop();
  });
});
