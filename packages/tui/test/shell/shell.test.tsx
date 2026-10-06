import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import React from 'react';
import { Text, renderToString } from 'ink';
import { describe, expect, it } from 'vitest';
import { DuplicateActionError, ENTER, LEAVE, Shell, TOO_SMALL, computeLayout, createActionRegistry, createScreenGuard, FocusStack, renderApp, type ShellSlots } from '../../src/shell/index.js';
import { sanitizeForTerminal, stringWidth, truncate, wrapText } from '../../src/text/index.js';

const filler = (label: string, n = 40) => <>{Array.from({ length: n }, (_, i) => <Text key={i}>{`${label} ${i}`}</Text>)}</>;
const slots = (o: Partial<ShellSlots> = {}): ShellSlots => ({ header: <Text>HEADER</Text>, transcript: filler('row'), prompt: <Text>PROMPT</Text>, footer: <Text>FOOTER</Text>, ...o });
const frame = (s: ShellSlots, cols: number, rows: number) => renderToString(<Shell slots={s} cols={cols} rows={rows} />, { columns: cols }).split('\n');

describe('layout', () => {
  it('at 80x24: one header row, one footer row, a 3-row prompt, the scrollback fills the rest (19 rows)', () => {
    const l = computeLayout({ cols: 80, rows: 24 }); expect(l).toMatchObject({ cls: 'ok', transcriptRows: 19, promptRows: 3, railVisible: false }); const f = frame(slots(), 80, 24); expect(f).toHaveLength(24); expect(f[0]).toContain('HEADER'); expect(f.at(-1)).toContain('FOOTER'); expect(f.filter((x) => x.startsWith('row '))).toHaveLength(19);
    expect(f.indexOf(f.find((x) => x.includes('PROMPT'))!)).toBe(20);
  });
  it('a toast row takes one row from the scrollback; the prompt grows to 12 and no further', () => { expect(computeLayout({ cols: 80, rows: 24, toast: true }).transcriptRows).toBe(18); expect(computeLayout({ cols: 80, rows: 40, promptRows: 30 }).promptRows).toBe(12); expect(computeLayout({ cols: 80, rows: 40, promptRows: 1 }).promptRows).toBe(3); });
  it('the rail shows only from 100 columns, is 28 wide, and the scrollback gives up 29 columns', () => {
    expect(computeLayout({ cols: 99, rows: 30, rail: true }).railVisible).toBe(false); const l = computeLayout({ cols: 100, rows: 30, rail: true }); expect(l).toMatchObject({ railVisible: true, railWidth: 28, transcriptCols: 71 }); expect(computeLayout({ cols: 120, rows: 30 }).railVisible).toBe(false);
    const f = frame(slots({ rail: <Text>RAIL</Text> }), 100, 30); expect(f.some((x) => x.includes('RAIL'))).toBe(true); expect(frame(slots({ rail: <Text>RAIL</Text> }), 90, 30).some((x) => x.includes('RAIL'))).toBe(false);
  });
  it('below 40 columns or 10 rows only the too-small line is shown; a valid size brings the layout back', () => {
    expect(TOO_SMALL).toBe('Terminal too small. Need 80x24.'); expect(frame(slots(), 39, 24).join('\n').trim()).toBe(TOO_SMALL.slice(0, 39)); expect(frame(slots(), 80, 9).join('\n')).toContain('Terminal too small.'); expect(frame(slots(), 80, 24).join('\n')).toContain('HEADER');
    expect(frame(slots(), 60, 20)).toHaveLength(20); expect(computeLayout({ cols: 60, rows: 20 }).cls).toBe('narrow'); expect(computeLayout({ cols: 80, rows: 20 }).cls).toBe('short');
  });
  it('an overlay is drawn over everything', () => { expect(frame(slots({ overlay: <Text>OVERLAY</Text> }), 80, 24).join('\n')).toContain('OVERLAY'); });
});

describe('resize', () => {
  it('120x40, then 80x24, then 60x20: each settles into the right layout with nothing left over', async () => {
    const out = Object.assign(new PassThrough(), { columns: 120, rows: 40, isTTY: false }) as unknown as NodeJS.WriteStream & PassThrough; const frames: string[] = []; out.on('data', (c) => frames.push(String(c)));
    const app = renderApp({ slots: slots({ transcript: filler('x', 60) }), stdout: out, altScreen: false, debug: true, proc: new EventEmitter() as never }); await new Promise((r) => setTimeout(r, 80));
    const lastFull = () => [...frames].reverse().find((f) => f.includes('HEADER') && f.includes('FOOTER'))!.replace(/\u001b\[[0-9;?]*[A-Za-z]/g, '').split('\n');
    expect(lastFull()).toHaveLength(40);
    for (const [c, r] of [[80, 24], [60, 20]] as const) { frames.length = 0; const o = out as unknown as { columns: number; rows: number }; o.columns = c; o.rows = r; out.emit('resize'); out.emit('resize'); out.emit('resize'); await new Promise((x) => setTimeout(x, 200)); const f = lastFull(); expect(f).toHaveLength(r); expect(f[0]).toContain('HEADER'); expect(f.at(-1)).toContain('FOOTER'); expect(Math.max(...f.map((l) => l.length))).toBeLessThanOrEqual(c); }
    app.unmount();
  });
});

describe('alternate screen', () => {
  function rig(enabled = true) { const w: string[] = []; const proc = Object.assign(new EventEmitter(), { pid: 1, killed: [] as string[], kill(_p: number, sig: string) { this.killed.push(sig); } }); const g = createScreenGuard({ stdout: { write: (s) => w.push(s) }, proc: proc as never, enabled }); return { w, proc, g }; }
  it('entered at start and left at normal exit, SIGINT, SIGTERM and an uncaught error, with the cursor shown again', () => {
    for (const ev of ['exit', 'SIGINT', 'SIGTERM', 'uncaughtException']) { const { w, proc, g } = rig(); g.enter(); expect(w).toEqual([ENTER]); expect(ENTER).toContain('?1049h'); proc.emit(ev); expect(w).toEqual([ENTER, LEAVE]); expect(LEAVE).toContain('?25h'); expect(LEAVE).toContain('?1049l'); expect(g.active()).toBe(false); }
  });
  it('after a signal the process is signalled again once so it ends as it would have; leaving twice writes once; disabled writes nothing; dispose removes the listeners', () => {
    const a = rig(); a.g.enter(); a.proc.emit('SIGTERM'); expect(a.proc.killed).toEqual(['SIGTERM']); a.g.leave(); expect(a.w).toHaveLength(2);
    const off = rig(false); off.g.enter(); off.proc.emit('exit'); expect(off.w).toEqual([]); const d = rig(); d.g.enter(); d.g.dispose(); expect(d.proc.listenerCount('SIGINT')).toBe(0); expect(d.proc.listenerCount('exit')).toBe(0);
  });
  it('renderApp leaves the screen on unmount', async () => { const out = Object.assign(new PassThrough(), { columns: 80, rows: 24, isTTY: false }) as unknown as NodeJS.WriteStream & PassThrough; let text = ''; out.on('data', (c) => (text += c)); const proc = new EventEmitter(); const app = renderApp({ slots: slots(), stdout: out, proc: proc as never }); await new Promise((r) => setTimeout(r, 30)); expect(text).toContain('?1049h'); app.unmount(); await app.waitUntilExit(); expect(text).toContain('?1049l'); expect(proc.listenerCount('SIGINT')).toBe(0); });
});

describe('actions and focus', () => {
  it('a duplicate id throws; the disposer removes it; the key goes to the action of the focus top, overlay before prompt', () => {
    const r = createActionRegistry(); const ran: string[] = []; const off = r.register({ id: 'a', group: 'g', description: 'd', defaultKey: 'esc', context: 'prompt', run: () => { ran.push('prompt'); } }); r.register({ id: 'b', group: 'g', description: 'd', defaultKey: 'esc', context: 'overlay', run: () => { ran.push('overlay'); } });
    expect(() => r.register({ id: 'a', group: 'g', description: 'd', run: () => undefined })).toThrow(DuplicateActionError); const f = new FocusStack(); expect(r.dispatch('esc', f.stack)).toBe(true); f.push('overlay'); r.dispatch('esc', f.stack); f.pop(); f.pop(); expect(f.current).toBe('prompt'); expect(ran).toEqual(['prompt', 'overlay']);
    off(); expect(r.dispatch('esc', ['prompt'])).toBe(false); expect(r.list().map((a) => a.id)).toEqual(['b']); expect(r.dispatch('x', ['prompt'])).toBe(false);
  });
});

describe('text helpers', () => {
  it('widths: a is 1, 漢 is 2, e + accent is 1, the technologist emoji is 2', () => { expect([stringWidth('a'), stringWidth('漢'), stringWidth('é'), stringWidth('👩‍💻'), stringWidth('')]).toEqual([1, 2, 1, 2, 0]); });
  it('truncate cuts with …, never splitting a character', () => { expect(truncate('hello world', 8)).toBe('hello w…'); expect(truncate('short', 8)).toBe('short'); expect(truncate('日本語です', 5)).toBe('日本…'); expect(truncate('x', 0)).toBe(''); expect(truncate('hello', 3, '..')).toBe('h..'); expect(stringWidth(truncate('👩‍💻👩‍💻👩‍💻', 5))).toBeLessThanOrEqual(5); });
  it('sanitize removes escape sequences and bells, expands tabs, keeps newlines', () => { expect(sanitizeForTerminal('a\u001b[31mb\u0007c')).toBe('a[31mbc'); expect(sanitizeForTerminal('a\tb')).toBe('a    b'); expect(sanitizeForTerminal('x\ny\r\nz\u009bq')).toBe('x\ny\nzq'); });
  it('wrap breaks at spaces, splits long words, keeps newlines and never exceeds the width', () => {
    expect(wrapText('the quick brown fox', 10)).toEqual(['the quick', 'brown fox']); expect(wrapText('abcdefghij', 4)).toEqual(['abcd', 'efgh', 'ij']); expect(wrapText('a\n\nb', 5)).toEqual(['a', '', 'b']); expect(wrapText('日本語日本語', 6)).toEqual(['日本語', '日本語']);
    for (const l of wrapText('A longer sentence with 漢字 and 👩‍💻 inside it, to check the widths hold.', 12)) expect(stringWidth(l)).toBeLessThanOrEqual(12);
  });
});
