import { describe, expect, it } from 'vitest';
import { buildLines, itemLines } from '../src/util/transcript.js';
import { lineWidth } from '../src/util/text.js';
import type { Item } from '../src/state/model.js';

const txt = (l: { t: string }[]) => l.map((s) => s.t).join('');
const tool = (o: Partial<Extract<Item, { kind: 'tool' }>> = {}): Item => ({ kind: 'tool', id: 'x1', toolId: 't1', agentId: 'a', name: 'Edit', summary: 'src/a.ts', risk: 'medium', status: 'running', startedAt: 0, path: 'src/a.ts', ...o });

describe('transcript', () => {
  it('renders user messages with a marker and hanging indent', () => {
    const l = itemLines({ kind: 'user', id: 'u', text: 'add retry logic to the relay client and write tests for it please', ts: 0 }, 30);
    expect(txt(l[0]!).startsWith(' ❯ you  ')).toBe(true); expect(txt(l[1]!).startsWith('        ')).toBe(true);
    expect(l.every((x) => lineWidth(x) === 30)).toBe(true); // a block across the whole width, tinted behind the text
    expect(l.every((x) => x.every((s) => s.bg === 'bg.hover'))).toBe(true);
    const a = itemLines({ kind: 'assistant', id: 'a', messageId: 'm', agentId: 'x', text: 'Hello there.\n\nSecond paragraph.', done: true } as never, 40); expect(txt(a[0]!).startsWith('◆ Hello there.')).toBe(true); expect(txt(a.find((x, i) => i > 0 && txt(x).includes('Second'))!).startsWith('  Second')).toBe(true); // only the first line carries the marker
  });
  it('shows a streaming caret until the message is done', () => {
    const streaming = itemLines({ kind: 'assistant', id: 'a', messageId: 'm', agentId: 'x', text: 'hello', done: false }, 40);
    const done = itemLines({ kind: 'assistant', id: 'a', messageId: 'm', agentId: 'x', text: 'hello', done: true }, 40);
    expect(txt(streaming.at(-1)!)).toContain('▍'); expect(txt(done.at(-1)!)).not.toContain('▍');
  });
  it('renders tool calls with approval, result and diff', () => {
    const pending = itemLines(tool({ approval: 'pending' }), 60).map(txt);
    expect(pending[0]).toBe('● Edit(src/a.ts)'); expect(pending[1]).toContain('waiting for your approval');
    const diff = '--- a/a.ts\n+++ b/a.ts\n@@ -1,1 +1,1 @@\n-a\n+b\n';
    const ok = itemLines(tool({ status: 'ok', approval: 'approved', result: 'Updated 1 file', diff }), 60).map(txt);
    expect(ok[1]).toContain('└ Updated 1 file'); expect(ok[1]).toContain('+1 -1'); expect(ok.some((x) => x.includes('-') && x.includes(' a'))).toBe(true);
  });
  it('flags high-risk commands and shows denials calmly', () => {
    expect(itemLines(tool({ name: 'Bash', command: 'rm -rf dist', path: undefined, risk: 'high' }), 80).map(txt)[0]).toContain('high risk');
    const d = itemLines(tool({ status: 'denied', result: 'You declined this action.' }), 80).map(txt);
    expect(d[1]).toContain('You declined');
  });
  it('summarises thinking when done and adds spacing only between groups', () => {
    expect(txt(itemLines({ kind: 'thinking', id: 't', messageId: 'm', agentId: 'a', text: 'x', ms: 4200, done: true }, 40)[0]!)).toContain('thought for 4s');
    const lines = buildLines([{ kind: 'user', id: 'u', text: 'hi', ts: 0 }, tool({ status: 'ok' }), tool({ toolId: 't2', status: 'ok' }), { kind: 'assistant', id: 'a', messageId: 'm', agentId: 'x', text: 'done', done: true }], 60).map(txt);
    const blanks = lines.map((l, i) => (l === '' ? i : -1)).filter((i) => i >= 0);
    expect(blanks).toHaveLength(2); // user|tool and tool|assistant, none between the two tools
  });
});
