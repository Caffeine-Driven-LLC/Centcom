import React from 'react';
import { Text, renderToString } from 'ink';
import { describe, expect, it } from 'vitest';
import { STATE_NAMES } from '@centcom/protocol';
import type { NormalisedEvent } from '@centcom/agent';
import { MotionProvider, allowedAnimation, announce, assertGlyphAndWord, assertNoColorCodes, assertNoEscape, createLinearRenderer, describeState, plain, resolveA11yMode, screenReaderTraits, useMotion } from '../../src/a11y/index.js';
import { ProgressBar } from '../../src/tasks/ProgressBar.js';
import { TaskList } from '../../src/tasks/TaskList.js';

const ev = (b: object): NormalisedEvent => ({ v: 1, seq: 1, ts: 'x', agent_id: 'agt_x', ...b }) as NormalisedEvent;
function rig(answers: (string | undefined)[] = []) { let out = ''; const asked: string[] = []; const r = createLinearRenderer({ out: { write: (s) => { out += s; } }, readLine: async (p) => { asked.push(p); return answers.shift(); } }); return { r, out: () => out, asked }; }

describe('mode', () => {
  it('flag, env or config switch it on, and it implies reduced motion; CENTO_REDUCE_MOTION alone is just reduced motion', () => {
    expect(resolveA11yMode({ env: {}, flags: {} })).toEqual({ screenReader: false, reducedMotion: false }); expect(resolveA11yMode({ env: {}, flags: { screenReader: true } })).toEqual({ screenReader: true, reducedMotion: true });
    expect(resolveA11yMode({ env: { CENTO_SCREEN_READER: '1' }, flags: {} }).screenReader).toBe(true); expect(resolveA11yMode({ env: {}, flags: {}, config: { screenReader: true } }).reducedMotion).toBe(true);
    expect(resolveA11yMode({ env: { CENTO_REDUCE_MOTION: '1' }, flags: {} })).toEqual({ screenReader: false, reducedMotion: true });
    expect(screenReaderTraits({ screenReader: true, reducedMotion: true })).toEqual({ mascot: false, altScreen: false, borders: false, redraw: false }); expect(screenReaderTraits({ screenReader: false, reducedMotion: false }).mascot).toBe(true);
  });
  it('the motion context defaults to full and reduced withholds crash, glitch and panic', () => {
    const C = () => <Text>{useMotion()}</Text>; expect(renderToString(<C />)).toBe('full'); expect(renderToString(<MotionProvider value="reduced"><C /></MotionProvider>)).toBe('reduced');
    for (const a of ['crash', 'glitch', 'panic']) { expect(allowedAnimation(a, 'reduced')).toBe(false); expect(allowedAnimation(a, 'full')).toBe(true); } expect(allowedAnimation('wave', 'reduced')).toBe(true);
  });
});

describe('state sentences', () => {
  it('every state has its own sentence; an unknown one says Cento is working', () => {
    for (const s of STATE_NAMES) { const t = describeState(s); expect(t.length, s).toBeGreaterThan(5); expect(t, s).not.toBe('Cento is working'); } expect(describeState('future')).toBe('Cento is working');
    expect(describeState('editing-file', { count: 3 })).toBe('Cento is editing 3 files'); expect(describeState('editing-file')).toBe('Cento is editing a file'); expect(describeState('thinking', { owner: 'Sam' })).toBe("Sam's Cento is thinking"); expect(describeState('awaiting-approval')).toBe('Waiting for your approval');
  });
});

describe('linear renderer', () => {
  it('prints a scripted session as plain lines: no ESC at all, every line ends in a newline, states as sentences', () => {
    const { r, out } = rig(); r.handle(ev({ type: 'status', state: 'thinking' })); r.handle(ev({ type: 'tool.requested', tool_id: 't', name: 'Read', input_summary: 'src/a.ts', risk: 'low' })); r.handle(ev({ type: 'tool.result', tool_id: 't', status: 'ok', summary: '120 lines' }));
    r.handle(ev({ type: 'status', state: 'editing-file' })); r.handle(ev({ type: 'text.done', message_id: 'm', text: 'All \u001b[31mdone\u001b[0m \u001b]0;title\u0007here.' })); r.handle(ev({ type: 'turn.done', outcome: 'ok' }));
    const o = out(); expect(o).toBe('Status: Cento is thinking.\nTool: Read src/a.ts\nResult: 120 lines\nStatus: Cento is editing a file.\nAssistant: All done here.\nDone.\n'); assertNoEscape(o); expect(o.endsWith('\n')).toBe(true); expect(o).not.toContain('?1049h');
  });
  it('a blocking state or error is announced as Error:, a normal change as Status:, on its own line', () => {
    const { r, out } = rig(); r.handle(ev({ type: 'status', state: 'auth-required' })); r.handle(ev({ type: 'error', code: 'provider_not_signed_in', tool_message: 'Not signed in', fatal: true })); r.handle(ev({ type: 'status', state: 'searching' }));
    expect(out().split('\n')).toEqual(['Error: You need to sign in before Cento can continue.', 'Error: Not signed in', 'Status: Cento is searching.', '']); const b = rig(); announce({ write: (s) => { b.r.line(s); } }, 'x', 'polite'); expect(b.out()).toBe('Status: x\n');
  });
  it('the permission question shows the exact command and folder, accepts y, n or a, asks again on anything else and never answers by itself', async () => {
    const { r, asked, out } = rig(['maybe', '', 'Y']); expect(await r.ask({ command: 'rm -rf dist', cwd: '/w/app', summary: 'x', tool: 'Bash' })).toBe('y'); expect(asked).toHaveLength(3); expect(asked[0]).toBe('Allow Cento to run: rm -rf dist in /w/app? [y/n/a] '); expect(out().match(/Please type y, n or a\./g)).toHaveLength(2);
    expect(await rig(['a']).r.ask({ summary: 'x', tool: 'Bash', command: 'ls' })).toBe('a'); expect(await rig(['n']).r.ask({ summary: 'edit src/a.ts', tool: 'Edit' })).toBe('n'); expect(await rig([undefined]).r.ask({ summary: 's', tool: 'Bash', command: 'ls' })).toBe('n'); /* input ended: no, never yes */
  });
  it('control characters in command text cannot reach the screen reader', async () => { const { r, asked } = rig(['y']); await r.ask({ command: 'echo \u001b[2J hi\nrm x', cwd: '/w', summary: '', tool: 'Bash' }); expect(asked[0]).not.toMatch(/\u001b/); expect(asked[0]).not.toContain('\n'); expect(plain('a\u0007b\rc')).toBe('abc'); });
});

describe('conformance under NO_COLOR and reduced motion', () => {
  const strip = (s: string) => s; /* the output is checked as rendered: nothing is stripped first */
  it('task list and progress bar show glyph and word, carry no colour codes, and hold still when reduced', () => {
    const tasks = renderToString(<TaskList items={[{ id: '1', text: 'one', status: 'completed' }, { id: '2', text: 'two', status: 'in_progress' }, { id: '3', text: 'three', status: 'pending' }]} width={40} />, { columns: 40 }); assertNoColorCodes(strip(tasks)); assertGlyphAndWord(tasks, ['one', 'two', 'three']);
    const a = renderToString(<ProgressBar label="Indexing" width={40} motion="reduced" />, { columns: 40 }); const b = renderToString(<ProgressBar label="Indexing" width={40} motion="reduced" />, { columns: 40 }); expect(a).toBe(b); assertNoColorCodes(a); assertGlyphAndWord(a, ['Indexing']);
  });
  it('the helpers fail when they should', () => { expect(() => assertNoColorCodes('\u001b[31mred')).toThrow(); expect(() => assertNoEscape('\u001b[2J')).toThrow(); expect(() => assertGlyphAndWord('✓', ['done'])).toThrow(); expect(() => assertNoColorCodes('plain')).not.toThrow(); });
});
