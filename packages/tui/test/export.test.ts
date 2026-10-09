import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { DemoEngine } from '@centcom/agent';
import { AppController } from '../src/controller.js';
import { codeBlocks, lastAnswer, toMarkdown } from '../src/util/export.js';

const items = [
  { id: 'u1', kind: 'user', text: 'fix the bug', ts: 1 }, { id: 't1', kind: 'tool', toolId: 't', agentId: 'a', name: 'Read', summary: 'src/a.ts', risk: 'low', status: 'ok', result: '12 lines' },
  { id: 'a1', kind: 'assistant', messageId: 'm', agentId: 'a', text: 'Here is the fix:\n\n```ts\nconst a = 1;\n```\n\nAnd a second one:\n\n```sh\nnpm test\n```\n\nDone.', done: true },
  { id: 't2', kind: 'tool', toolId: 't2', agentId: 'a', name: 'Edit', summary: 'src/a.ts', risk: 'medium', status: 'ok', diff: '--- a/src/a.ts\n+++ b/src/a.ts\n@@ -1 +1 @@\n-old\n+new\n' },
  { id: 'n1', kind: 'notice', level: 'warn', text: 'careful', detail: 'a detail' }, { id: 'th', kind: 'thinking', messageId: 'x', agentId: 'a', text: 'secret thoughts', ms: 5, done: true },
] as never[];
describe('pieces of the conversation', () => {
  it('the last answer, and the code blocks in it (fenced with ``` or ~~~, any language)', () => {
    expect(lastAnswer(items)).toContain('Here is the fix'); expect(lastAnswer([items[0]!])).toBeUndefined(); expect(codeBlocks(lastAnswer(items)!)).toEqual(['const a = 1;', 'npm test']);
    expect(codeBlocks('x\n~~~\ntilde block\n~~~\ny')).toEqual(['tilde block']); expect(codeBlocks('no code here')).toEqual([]); expect(codeBlocks('````md\n```inner```\n````')).toEqual(['```inner```']);
  });
  it('Markdown has the title, who said what, the tools with their diffs, and leaves out the agent\'s private thinking', () => {
    const md = toMarkdown(items, { title: 'fix the bug', engine: 'Claude Code', cwd: '/p', when: new Date('2026-10-09T00:10:00Z') });
    expect(md).toContain('# fix the bug'); expect(md).toContain('Exported 2026-10-09 00:10 from `/p` (Claude Code).'); expect(md).toContain('## You\n\nfix the bug'); expect(md).toContain('## Cento\n\nHere is the fix'); expect(md).toContain('> **Read** src/a.ts'); expect(md).toContain('```diff\n--- a/src/a.ts'); expect(md).toContain('> _warn: careful_'); expect(md).not.toContain('secret thoughts'); expect(md.endsWith('\n')).toBe(true);
  });
  it('scrubs secrets from what is exported', () => {
    const md = toMarkdown([{ id: 'u', kind: 'user', text: 'my key is sk-ant-api03-abcdefghijklmnopqrstuvwxyz0123456789ABCDEF ok', ts: 1 }] as never[], { title: 't', engine: 'e', cwd: '/', when: new Date() }); expect(md).not.toContain('abcdefghijklmnopqrstuvwxyz0123456789'); expect(md).toContain('my key is');
  });
});
const tick = () => new Promise((r) => setTimeout(r, 10));
describe('/copy and /export choices', () => {
  const mk = () => { const copied: string[] = []; const c = new AppController({ engine: new DemoEngine({ speed: 100 }), demo: true, cwd: '/tmp', version: 't', skills: [], clipboard: (t) => copied.push(t) }); return { c, copied }; };
  it('/copy with code in the answer asks what to copy (the answer, or any one code block) and copies that', async () => {
    const { c, copied } = mk(); c.patch({ items }); const run = c.runCommand('/copy'); await tick(); expect(c.state.pick!.title).toBe('Copy'); const ids = c.state.pick!.options.map((o) => o.id); expect(ids[0]).toBe('answer'); expect(ids.length).toBeGreaterThanOrEqual(2);
    c.pickKey('down'); c.pickKey('enter'); await run; expect(copied).toEqual(['const a = 1;']); const second = c.runCommand('/copy'); await tick(); c.pickKey('down'); c.pickKey('down'); c.pickKey('enter'); await second; expect(copied.at(-1)).toBe('npm test'); copied.pop(); copied.pop(); copied.push('const a = 1;'); const again = c.runCommand('/copy'); await tick(); c.pickKey('cancel'); await again; expect(copied).toHaveLength(1); // cancelling copies nothing
    c.patch({ items: [items[0]!, { ...(items[2] as unknown as object), text: 'no code here' } as never] }); await c.runCommand('/copy'); expect(copied.at(-1)).toBe('no code here'); expect(c.state.mode).toBe('chat'); // no code: no question, it just copies
    c.stop();
  });
  it('/export offers a file or the clipboard; the clipboard gets the same Markdown', async () => {
    const { c, copied } = mk(); c.patch({ items }); const run = c.runCommand('/export'); await tick(); c.pickKey('down'); c.pickKey('enter'); await run; expect(copied).toHaveLength(1); expect(copied[0]).toContain('## You\n\nfix the bug'); c.stop();
  });
});
describe('/copy and /export', () => {
  const make = (cwd = '/tmp') => { const copied: string[] = []; const c = new AppController({ engine: new DemoEngine({ speed: 100 }), demo: true, cwd, version: 't', skills: [], clipboard: (t) => copied.push(t) }); return { c, copied }; };
  it('/copy takes the last answer, /copy code its last code block; each says when there is nothing', async () => {
    const { c, copied } = make(); await c.runCommand('/copy'); expect(c.state.toasts.at(-1)!.text).toBe('Nothing to copy yet.'); c.patch({ items });
    await c.runCommand('/copy answer'); await c.runCommand('/copy code'); expect(copied[0]).toContain('And a second one'); expect(copied[1]).toBe('npm test'); await c.runCommand('/copy everything'); expect(c.state.toasts.at(-1)!.text).toMatch(/\/copy code/);
    c.patch({ items: [items[0]!, { ...(items[2] as unknown as object), text: 'no code' } as never] }); await c.runCommand('/copy code'); expect(c.state.toasts.at(-1)!.text).toBe('The last answer has no code block.');
  });
  it('/export writes a Markdown file in the folder (private to you), never overwrites, and accepts a name', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'cc-export-')); const { c } = make(dir); await c.runCommand('/export'); expect(c.state.toasts.at(-1)!.text).toBe('Nothing to export yet.'); c.patch({ items });
    await c.runCommand('/export notes0.md'); const nf = readdirSync(dir).length; expect(nf).toBe(1); rmSync(join(dir, 'notes0.md')); const run = c.runCommand('/export'); await tick(); expect(c.state.pick!.options.map((o) => o.id)).toEqual(['file', 'clipboard']); c.pickKey('enter'); await run; const files = readdirSync(dir); expect(files).toHaveLength(1); expect(files[0]).toMatch(/^centcom-\d{8}-\d{4}\.md$/); expect(statSync(join(dir, files[0]!)).mode & 0o777).toBe(0o600); expect(readFileSync(join(dir, files[0]!), 'utf8')).toContain('## You\n\nfix the bug');
    await c.runCommand('/export notes.md'); expect(existsSync(join(dir, 'notes.md'))).toBe(true); const before = readFileSync(join(dir, 'notes.md'), 'utf8'); c.patch({ items: [items[0]!] }); await c.runCommand('/export notes.md'); expect(c.state.toasts.at(-1)!.text).toMatch(/already exists/); expect(readFileSync(join(dir, 'notes.md'), 'utf8')).toBe(before);
  });
});

describe('Codex asks through its question gate: one list, and the answer round-trips (real mock Codex process, through the controller)', () => {
  it('the question appears once, picking an option reaches Codex, and its reply shows in the conversation', async () => {
    const { CodexEngine } = await import('@centcom/agent'); const { mkdtempSync } = await import('node:fs'); const { resolve } = await import('node:path');
    const BIN = resolve(__dirname, '../../../tools/codex/bin/codex'); process.env.MOCK_CODEX_HOME = mkdtempSync(join(tmpdir(), 'mock-home-'));
    const c = new AppController({ engine: new CodexEngine({ bin: BIN, stallMs: 0 }) as never, demo: false, cwd: mkdtempSync(join(tmpdir(), 'mock-proj-')), version: 't', skills: [] });
    try {
      await c.start(); await c.submit('ask Which colour? | red | blue');
      const until = async (f: () => boolean, ms = 10000) => { const t0 = Date.now(); while (!f()) { if (Date.now() - t0 > ms) throw new Error('timeout; mode=' + c.state.mode + ' pick=' + JSON.stringify(c.state.pick?.title)); await new Promise((r) => setTimeout(r, 15)); } };
      await until(() => c.state.mode === 'pick'); const first = c.state.pick!; expect(first.options.map((o) => o.label)).toEqual(['red', 'blue']); await new Promise((r) => setTimeout(r, 150)); expect(c.state.pick!.title).toBe(first.title); expect(c.state.pick!.options.map((o) => o.label)).toEqual(['red', 'blue']); // nothing replaced it
      c.pickKey('down'); c.pickKey('enter'); await until(() => c.state.items.some((i) => i.kind === 'assistant' && i.text.includes('You chose: blue.')));
      await until(() => !c.state.busy); expect(c.state.mode).toBe('chat'); expect(c.state.items.some((i) => i.kind === 'user' && /blue/.test(i.text) && !/ask Which/.test(i.text))).toBe(false); // the choice went to Codex as its answer, not as a chat message
    } finally { c.stop(); }
  }, 40_000);
});
