import React from 'react';
import { renderToString } from 'ink';
import { describe, expect, it } from 'vitest';
import { Rich } from '../src/components/ui.js';
import { sp } from '../src/util/text.js';
import { Transcript } from '../src/components/Transcript.js';
import { TranscriptLayout } from '../src/transcript/layout.js';
import { Approval } from '../src/components/Approval.js';

/** Text from the agent, a tool or a file may carry terminal control sequences (clear screen, set the title, write the clipboard with OSC 52). None may reach the terminal; only the app's own colours may. */
const EVIL = 'hello \x1b[2J\x1b[H\x1b]0;pwned\x07\x1b]52;c;QUJD\x07 world';
const nonStyleEscapes = (s: string) => s.match(/\x1b(?!\[[0-9;]*m)|\x07/g) ?? [];
describe('hostile text never reaches the terminal as control sequences', () => {
  it('a rich line', () => { const out = renderToString(<Rich line={[sp(EVIL)]} />, { columns: 80 }); expect(nonStyleEscapes(out)).toEqual([]); expect(out).toContain('hello'); expect(out).toContain('world'); });
  it('assistant text, a tool call and its result, and a notice with detail', () => {
    const items = [{ id: 'a', kind: 'assistant', text: EVIL, done: true }, { id: 't', kind: 'tool', name: 'Bash', status: 'ok', result: EVIL, summary: EVIL, input: EVIL }, { id: 'n', kind: 'notice', level: 'info', text: EVIL, detail: EVIL }] as never[];
    const out = renderToString(<Transcript layout={new TranscriptLayout().update(items, 70)} items={items} width={70} height={16} scroll={0} />, { columns: 80 }); expect(nonStyleEscapes(out)).toEqual([]);
  });
  it('a diff whose file content carries escapes, and a permission prompt for a hostile command or path', () => {
    const items = [{ id: 'e', kind: 'tool', name: 'Edit', status: 'ok', summary: 'x', diff: `--- a/f\n+++ b/f\n@@ -1 +1 @@\n-old ${EVIL}\n+new ${EVIL}\n` }] as never[];
    expect(nonStyleEscapes(renderToString(<Transcript layout={new TranscriptLayout().update(items, 70)} items={items} width={70} height={16} scroll={0} />, { columns: 80 }))).toEqual([]);
    const a = { req: { approval_id: 'a', agent_id: 'me', tool_id: 't', tool: 'Bash', summary: EVIL, risk: 'medium', command: `echo ${EVIL}`, path: undefined }, agentName: 'you', color: 'violet', resolve() {}, confirmHigh: false } as never;
    expect(nonStyleEscapes(renderToString(<Approval a={a} width={80} confirming={false} />, { columns: 80 }))).toEqual([]);
  });
});
