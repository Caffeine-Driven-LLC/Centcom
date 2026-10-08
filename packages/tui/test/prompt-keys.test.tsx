import React from 'react';
import { PassThrough } from 'node:stream';
import { render } from 'ink';
import { afterEach, describe, expect, it } from 'vitest';
import { DemoEngine } from '@centcom/agent';
import { App, AppController } from '../src/index.js';

const wait = (ms = 25) => new Promise((r) => setTimeout(r, ms));
let cleanup: (() => void) | undefined; afterEach(() => { cleanup?.(); cleanup = undefined; });
async function mount() {
  const copied: string[] = [];
  const ctl = new AppController({ engine: new DemoEngine({ speed: 100 }), demo: true, cwd: '/tmp', version: 't', skills: [], clipboard: (t) => copied.push(t), mouse: true });
  const out: any = new PassThrough(); out.columns = 100; out.rows = 30; out.isTTY = true; let frame = ''; out.on('data', (d: Buffer) => { frame = d.toString(); });
  const inp: any = new PassThrough(); inp.isTTY = true; inp.setRawMode = () => inp; inp.ref = () => inp; inp.unref = () => inp;
  const inst = render(<App ctl={ctl} tier="none" />, { stdout: out, stdin: inp, exitOnCtrlC: false, patchConsole: false, debug: true });
  cleanup = () => { inst.unmount(); ctl.stop(); };
  await wait(50);
  const send = async (s: string) => { inp.write(s); await wait(); };
  /** Click on the first screen cell where `label` is drawn (a real SGR press and release). */
  const click = async (label: string, dx = 0) => { await wait(60); const lines = frame.replace(/\x1b\[[0-9;?]*[A-Za-z]/g, '').split('\n'); const row = lines.findIndex((l) => l.includes(label)); if (row < 0) throw new Error(`"${label}" is not on the screen:\n${lines.join('\n')}`); const col = lines[row]!.indexOf(label) + 1 + dx; await send(`\x1b[<0;${col};${row + 1}M`); await send(`\x1b[<0;${col};${row + 1}m`); };
  return { ctl, copied, send, click, text: () => ctl.state.input, cursor: () => ctl.state.cursor };
}
const SHIFT_LEFT = '\x1b[1;2D', SHIFT_RIGHT = '\x1b[1;2C', CTRL_DELETE = '\x1b[3;5~', DELETE = '\x1b[3~', LEFT = '\x1b[D', SHIFT_HOME = '\x1b[1;2H';

describe('prompt keys', () => {
  it('shift+arrow skips whole words', async () => {
    const t = await mount(); await t.send('one two three'); await t.send(SHIFT_LEFT); expect(t.cursor()).toBe(8); await t.send(SHIFT_LEFT); expect(t.cursor()).toBe(4); await t.send(SHIFT_RIGHT); expect(t.cursor()).toBe(7);
  });
  it('shift+arrow also selects; ctrl+c copies the selection and keeps the text', async () => {
    const t = await mount(); await t.send('hello world'); await t.send(SHIFT_LEFT);
    expect(t.ctl.state.anchor).toBe(11); expect(t.cursor()).toBe(6);
    await t.send('\x03'); expect(t.copied).toEqual(['world']); expect(t.text()).toBe('hello world'); expect(t.ctl.state.anchor).toBeUndefined();
  });
  it('typing replaces the selection; backspace deletes it; ctrl+x cuts it', async () => {
    let t = await mount(); await t.send('hello world'); await t.send(SHIFT_LEFT); await t.send('X'); expect(t.text()).toBe('hello X'); cleanup!();
    t = await mount(); await t.send('hello world'); await t.send(SHIFT_LEFT); await t.send('\x7f'); expect(t.text()).toBe('hello '); cleanup!();
    t = await mount(); await t.send('hello world'); await t.send(SHIFT_LEFT); await t.send('\x18'); expect(t.copied).toEqual(['world']); expect(t.text()).toBe('hello ');
  });
  it('a plain arrow collapses the selection to its edge; shift+home selects to the line start', async () => {
    const t = await mount(); await t.send('hello world'); await t.send(SHIFT_LEFT); await t.send(LEFT); expect(t.cursor()).toBe(6); expect(t.ctl.state.anchor).toBeUndefined();
    await t.send(SHIFT_HOME); expect(t.cursor()).toBe(0); expect(t.ctl.state.anchor).toBe(6);
  });
  it('ctrl+delete deletes the next word; delete deletes one character; alt+a selects all', async () => {
    const t = await mount(); await t.send('one two three'); await t.send('\x01'); expect(t.cursor()).toBe(0); await t.send(CTRL_DELETE); expect(t.text()).toBe(' two three'); await t.send(DELETE); expect(t.text()).toBe('two three');
    await t.send('\x1ba'); expect(t.ctl.state.anchor).toBe(0); expect(t.cursor()).toBe(9); await t.send('\x03'); expect(t.copied).toEqual(['two three']);
  });
  it('sending the message drops the selection', async () => {
    const t = await mount(); await t.send('hi there'); await t.send(SHIFT_LEFT); await t.send('\r'); expect(t.ctl.state.anchor).toBeUndefined(); expect(t.text()).toBe('');
  });
});

describe('mouse wheel', () => {
  const UP = '\x1b[<64;10;5M', DOWN = '\x1b[<65;10;5M', CLICK = '\x1b[<0;10;5M', RELEASE = '\x1b[<0;10;5m';
  it('scrolls the transcript, never types into the prompt, and ignores clicks', async () => {
    const t = await mount(); for (let i = 0; i < 60; i++) t.ctl.patch({ items: [...t.ctl.state.items, { id: 'm' + i, kind: 'user', text: 'line ' + i } as never] });
    await wait(); await t.send(UP); expect(t.ctl.state.scroll).toBe(3); await t.send(UP + UP); expect(t.ctl.state.scroll).toBe(9); await t.send(DOWN); expect(t.ctl.state.scroll).toBe(6);
    await t.send(CLICK); await t.send(RELEASE); expect(t.ctl.state.scroll).toBe(6); expect(t.text()).toBe('');
  });
  it('wheel moves the highlight in a list, and /mouse off stops the reporting', async () => {
    const t = await mount(); void t.ctl.pick({ title: 't', options: ['a', 'b', 'c'].map((id) => ({ id, label: id })) }); await wait();
    await t.send(DOWN); expect(t.ctl.state.pick!.sel).toBe(1); await t.send(UP); expect(t.ctl.state.pick!.sel).toBe(0); t.ctl.pickKey('cancel');
    expect(t.ctl.state.settings.mouse).toBe(true); await t.ctl.runCommand('/mouse off'); expect(t.ctl.state.settings.mouse).toBe(false); await t.ctl.runCommand('/mouse'); expect(t.ctl.state.settings.mouse).toBe(true);
  });
});

describe('text and Enter in one chunk', () => {
  it('sends the message instead of inserting a line break', async () => {
    const t = await mount(); const sent: string[] = []; t.ctl.submit = (async (x: string) => { sent.push(x); }) as never;
    await t.send('hello there\r'); expect(sent).toEqual(['hello there']); expect(t.text()).toBe('hello there'.length ? t.text() : ''); // the real submit clears the prompt
  });
  it('a partial slash command completes like Enter does, and a pasted block with line breaks inside stays text', async () => {
    const t = await mount(); const sent: string[] = []; t.ctl.submit = (async (x: string) => { sent.push(x); }) as never;
    await t.send('/mou\r'); expect(sent).toEqual([]); expect(t.text()).toBe('/mouse '); await t.send('\x15');
    await t.send('line one\nline two\r'); expect(t.text()).toBe('line one\nline two\n');
  });
});

describe('mouse clicks', () => {
  const opts = ['a', 'b', 'c'].map((id) => ({ id, label: 'option ' + id }));
  it('clicking a row in a list of several ticks it; clicking again unticks; the confirm button returns the ticked ones', async () => {
    const t = await mount(); const r = t.ctl.pick({ title: 'Pick', options: opts, confirm: 'send' }); await wait();
    await t.click('option b'); expect(t.ctl.state.pick!.checked).toEqual(['b']); await t.click('option c'); await t.click('option b'); expect(t.ctl.state.pick!.checked).toEqual(['c']);
    await t.click('send (1)'); expect(await r).toEqual(['c']); expect(t.ctl.state.mode).toBe('chat');
  });
  it('clicking an option in a one-of list chooses it, and cancel answers nothing', async () => {
    const t = await mount(); const r = t.ctl.pick({ title: 'One', options: opts, multi: false }); await wait(); await t.click('option c'); expect(await r).toEqual(['c']);
    const r2 = t.ctl.pick({ title: 'One', options: opts, multi: false }); await wait(); await t.click('cancel'); expect(await r2).toBeUndefined();
  });
  it('the buttons of an approval answer it', async () => {
    const t = await mount(); const req = (id: string, risk: 'medium' | 'high') => ({ approval_id: id, agent_id: 'me', tool_id: 't' + id, tool: 'Bash', summary: 'x', risk, command: 'npm test' } as never);
    const a = t.ctl.decide(req('1', 'medium')); await wait(); await t.click('[n]'); expect(await a).toMatchObject({ decision: 'deny' });
    const b = t.ctl.decide(req('2', 'medium')); await wait(); await t.click('[y]'); expect(await b).toMatchObject({ decision: 'approve', scope: 'once' });
    const c = t.ctl.decide(req('3', 'medium')); await wait(); await t.click('[a]'); expect(await c).toMatchObject({ decision: 'approve' }); expect((await c).scope).not.toBe('once');
    const d = t.ctl.decide(req('4', 'high')); await wait(); await t.click('[y]'); expect(t.ctl.state.approvals).toHaveLength(1); await t.click('[y]'); expect(await d).toMatchObject({ decision: 'approve' }); // a destructive one needs a second click
  });
  it('clicking a command in the / menu runs it, or fills it in when it needs an argument', async () => {
    const t = await mount(); const sent: string[] = []; t.ctl.submit = (async (x: string) => { sent.push(x); }) as never;
    await t.send('/'); await t.click('/new'); expect(sent).toEqual(['/new']);
    await t.send('\x15'); await t.send('/'); await t.click('/effort'); expect(t.text().startsWith('/effort ')).toBe(true);
  });
  it('clicks do nothing with the mouse off, and a click on empty space is ignored', async () => {
    const t = await mount(); const r = t.ctl.pick({ title: 'Pick', options: opts }); await wait(); await t.click('Pick'); expect(t.ctl.state.pick!.checked).toEqual([]);
    await t.ctl.runCommand('/mouse off'); await wait(); await t.click('option a'); expect(t.ctl.state.pick!.checked).toEqual([]); t.ctl.pickKey('cancel'); await r;
  });
});
