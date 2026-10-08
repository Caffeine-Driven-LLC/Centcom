import { existsSync, mkdtempSync, readFileSync, readdirSync, statSync } from 'node:fs';
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
describe('/copy and /export', () => {
  const make = (cwd = '/tmp') => { const copied: string[] = []; const c = new AppController({ engine: new DemoEngine({ speed: 100 }), demo: true, cwd, version: 't', skills: [], clipboard: (t) => copied.push(t) }); return { c, copied }; };
  it('/copy takes the last answer, /copy code its last code block; each says when there is nothing', async () => {
    const { c, copied } = make(); await c.runCommand('/copy'); expect(c.state.toasts.at(-1)!.text).toBe('Nothing to copy yet.'); c.patch({ items });
    await c.runCommand('/copy'); await c.runCommand('/copy code'); expect(copied[0]).toContain('And a second one'); expect(copied[1]).toBe('npm test'); await c.runCommand('/copy everything'); expect(c.state.toasts.at(-1)!.text).toMatch(/\/copy code/);
    c.patch({ items: [items[0]!, { ...(items[2] as unknown as object), text: 'no code' } as never] }); await c.runCommand('/copy code'); expect(c.state.toasts.at(-1)!.text).toBe('The last answer has no code block.');
  });
  it('/export writes a Markdown file in the folder (private to you), never overwrites, and accepts a name', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'cc-export-')); const { c } = make(dir); await c.runCommand('/export'); expect(c.state.toasts.at(-1)!.text).toBe('Nothing to export yet.'); c.patch({ items });
    await c.runCommand('/export'); const files = readdirSync(dir); expect(files).toHaveLength(1); expect(files[0]).toMatch(/^centcom-\d{8}-\d{4}\.md$/); expect(statSync(join(dir, files[0]!)).mode & 0o777).toBe(0o600); expect(readFileSync(join(dir, files[0]!), 'utf8')).toContain('## You\n\nfix the bug');
    await c.runCommand('/export notes.md'); expect(existsSync(join(dir, 'notes.md'))).toBe(true); const before = readFileSync(join(dir, 'notes.md'), 'utf8'); c.patch({ items: [items[0]!] }); await c.runCommand('/export notes.md'); expect(c.state.toasts.at(-1)!.text).toMatch(/already exists/); expect(readFileSync(join(dir, 'notes.md'), 'utf8')).toBe(before);
  });
});
