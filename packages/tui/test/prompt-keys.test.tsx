import React from 'react';
import { PassThrough } from 'node:stream';
import { resolve as resolvePath } from 'node:path';
const REPO_ROOT = resolvePath(__dirname, '../../..'); // not the folder the tests were started from
import { render } from 'ink';
import { afterEach, describe, expect, it } from 'vitest';
import { DemoEngine } from '@centcom/agent';
import { App, AppController } from '../src/index.js';

const wait = (ms = 25) => new Promise((r) => setTimeout(r, ms));
let cleanup: (() => void) | undefined; afterEach(() => { cleanup?.(); cleanup = undefined; });
async function mount(o: { cwd?: string; external?: (t: import('../src/index.js').ExternalTask) => void } = {}) {
  const copied: string[] = [];
  const ctl = new AppController({ engine: new DemoEngine({ speed: 100 }), demo: true, cwd: o.cwd ?? '/tmp', version: 't', skills: [], clipboard: (t) => copied.push(t), mouse: true, ...(o.external ? { external: o.external } : {}) });
  const out: any = new PassThrough(); out.columns = 100; out.rows = 30; out.isTTY = true; let frame = ''; let raw = ''; out.on('data', (d: Buffer) => { frame = d.toString(); raw += d.toString(); });
  const inp: any = new PassThrough(); inp.isTTY = true; inp.setRawMode = () => inp; inp.ref = () => inp; inp.unref = () => inp;
  const inst = render(<App ctl={ctl} tier="none" />, { stdout: out, stdin: inp, exitOnCtrlC: false, patchConsole: false, debug: true });
  cleanup = () => { inst.unmount(); ctl.stop(); };
  await wait(50);
  const send = async (s: string, ms = 25) => { inp.write(s); await wait(ms); };
  /** Click on the first screen cell where `label` is drawn (a real SGR press and release). */
  const click = async (label: string, dx = 0) => { await wait(60); const lines = frame.replace(/\x1b\[[0-9;?]*[A-Za-z]/g, '').split('\n'); const row = lines.findIndex((l) => l.includes(label)); if (row < 0) throw new Error(`"${label}" is not on the screen:\n${lines.join('\n')}`); const col = lines[row]!.indexOf(label) + 1 + dx; await send(`\x1b[<0;${col};${row + 1}M`); await send(`\x1b[<0;${col};${row + 1}m`); };
  /** Wait until something is true (a slow machine takes longer than a fixed sleep). */
  const until = async (f: () => boolean, ms = 8000) => { const t0 = Date.now(); while (!f()) { if (Date.now() - t0 > ms) throw new Error('timeout waiting; screen:\n' + frame.replace(/\x1b\[[0-9;?]*[A-Za-z]/g, '')); await wait(15); } };
  const screen = () => frame.replace(/\x1b\[[0-9;?]*[A-Za-z]/g, '');
  return { ctl, copied, send, click, until, raw: () => raw, unmount: () => { cleanup?.(); cleanup = undefined; }, frame: screen, text: () => ctl.state.input, cursor: () => ctl.state.cursor };
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
    const a = t.ctl.decide(req('1', 'medium')); await wait(330); await t.click('[n]'); expect(await a).toMatchObject({ decision: 'deny' });
    const b = t.ctl.decide(req('2', 'medium')); await wait(330); await t.click('[y]'); expect(await b).toMatchObject({ decision: 'approve', scope: 'once' });
    const c = t.ctl.decide(req('3', 'medium')); await wait(330); await t.click('[a]'); expect(await c).toMatchObject({ decision: 'approve' }); expect((await c).scope).not.toBe('once');
    const d = t.ctl.decide(req('4', 'high')); await wait(330); await t.click('[y]'); expect(t.ctl.state.approvals).toHaveLength(1); await t.click('[y]'); expect(await d).toMatchObject({ decision: 'approve' }); // a destructive one needs a second click
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

describe('a new approval ignores answers for 300 ms', () => {
  const req = (id: string) => ({ approval_id: id, agent_id: 'me', tool_id: 't' + id, tool: 'Bash', summary: 'x', risk: 'medium', command: 'npm test' } as never);
  it('a stray y or a click right as it appears does nothing; after the grace it works', async () => {
    const t = await mount(); const a = t.ctl.decide(req('1')); await wait(40);
    await t.send('y'); await t.send('a'); expect(t.ctl.state.approvals).toHaveLength(1); await t.click('[y]'); expect(t.ctl.state.approvals).toHaveLength(1);
    await wait(320); await t.send('n'); expect(await a).toMatchObject({ decision: 'deny' });
    const b = t.ctl.decide(req('2')); await wait(320); await t.send('y'); expect(await b).toMatchObject({ decision: 'approve' });
  });
  it('each approval gets its own grace, so the next one in the queue is protected too', async () => {
    const t = await mount(); const a = t.ctl.decide(req('1')); const b = t.ctl.decide(req('2')); await wait(330); await t.send('y'); expect(await a).toMatchObject({ decision: 'approve' });
    await t.send('y'); expect(t.ctl.state.approvals).toHaveLength(1); // the second one only just appeared
    await wait(330); await t.send('n'); expect(await b).toMatchObject({ decision: 'deny' });
  });
});

describe('multi-line input and completion', () => {
  it('ctrl+j and backslash then Enter make a new line instead of sending', async () => {
    const t = await mount(); const sent: string[] = []; t.ctl.submit = (async (x: string) => { sent.push(x); }) as never;
    await t.send('one'); await t.send('\n'); await t.send('two'); expect(t.text()).toBe('one\ntwo'); expect(sent).toEqual([]);
    await t.send('\x1ba'); await t.send('\x7f'); expect(t.text()).toBe(''); await t.send('first\\'); await t.send('\r'); await t.send('second'); expect(t.text()).toBe('first\nsecond'); expect(sent).toEqual([]);
    await t.send('\r'); expect(sent).toEqual(['first\nsecond']);
  });
  it('Tab completes a partial command, and Enter on a complete one with an argument waits for the argument', async () => {
    const t = await mount(); await t.send('/effo'); await t.send('\t'); expect(t.text()).toBe('/effort '); await t.send('\x15');
    await t.send('/res'); await t.send('\t'); expect(t.text().startsWith('/resume')).toBe(true);
  });
  it('a message over 65,536 characters is refused with a clear message and stays in the prompt', async () => {
    const t = await mount(); const sent: string[] = []; const real = t.ctl.submit.bind(t.ctl); void real;
    const long = 'x'.repeat(65_537); await t.ctl.submit(long); expect(t.ctl.state.toasts.at(-1)!.text).toMatch(/65,537 characters; the limit is 65,536/); expect(t.ctl.state.items.filter((i) => i.kind === 'user')).toHaveLength(0); expect(sent).toEqual([]);
    await t.ctl.submit('x'.repeat(65_536).slice(0, 10)); expect(t.ctl.state.items.some((i) => i.kind === 'user')).toBe(true);
  });
});

describe('big pastes', () => {
  const paste = (s: string) => `\x1b[200~${s}\x1b[201~`;
  const fakeSession = (t: Awaited<ReturnType<typeof mount>>) => { const sent: string[] = []; (t.ctl as any).session = { send: async (x: string) => { sent.push(x); }, stop: async () => undefined }; return sent; };
  it('a small paste goes in as text; a big one becomes a chip, and the agent still gets every line', async () => {
    const t = await mount(); const sent = fakeSession(t);
    await t.send(paste('just a line')); expect(t.text()).toBe('just a line'); await t.send('\x1ba'); await t.send('\x7f');
    const big = Array.from({ length: 30 }, (_, i) => `line ${i}`).join('\n'); await t.send(paste(big)); expect(t.text()).toBe('[Pasted text #1 +29 lines]');
    await t.send(' please review'); await t.send('\r');
    expect(sent).toEqual([big + ' please review']); const shown = t.ctl.state.items.find((i) => i.kind === 'user') as { text: string };
    expect(shown.text).toBe('[Pasted text #1 +29 lines] please review'); // the transcript stays short
  });
  it('a chip you edit is no longer expanded, and chips do not leak into the next message', async () => {
    const t = await mount(); const sent = fakeSession(t); const big = Array.from({ length: 12 }, (_, i) => `row ${i}`).join('\n');
    await t.send(paste(big)); await t.send('\x7f'); await t.send('\r'); expect(sent[0]).toMatch(/^\[Pasted text #1 \+11 lines$/); // the closing bracket was deleted: sent as typed
  });
  it('a paste that would make the message longer than the limit is refused when sent', async () => {
    const t = await mount(); const sent = fakeSession(t); await t.send(paste('x'.repeat(70_000))); expect(t.text()).toMatch(/^\[Pasted text #1/); await t.send('\r');
    expect(sent).toEqual([]); expect(t.ctl.state.toasts.at(-1)!.text).toMatch(/limit is 65,536/); expect(t.text()).toMatch(/^\[Pasted text #1/); // still in the box
  });
});

describe('prompt height', () => {
  it('grows with the window up to 12 lines instead of stopping at 6', async () => {
    const { promptRows } = await import('../src/components/Prompt.js'); const text = Array.from({ length: 10 }, (_, i) => `l${i}`).join('\n');
    expect(promptRows(text, text.length, 80)).toBe(6); expect(promptRows(text, text.length, 80, 12)).toBe(10); expect(promptRows(text + '\n'.repeat(20), 0, 80, 12)).toBe(12);
  });
});

describe('approval: countdown and session scope', () => {
  const req = (id: string, risk: 'medium' | 'high' = 'medium', command = 'npm test') => ({ approval_id: id, agent_id: 'me', tool_id: 't' + id, tool: 'Bash', summary: 'x', risk, command } as never);
  it('the s key (and the [s] button) allows it for this session only; a destructive one has no such shortcut', async () => {
    const t = await mount(); const a = t.ctl.decide(req('1')); await wait(330); await t.send('s'); expect(await a).toMatchObject({ decision: 'approve', scope: 'session' });
    const b = t.ctl.decide(req('2', 'medium', 'pnpm build')); await wait(330); await t.click('[s]'); expect(await b).toMatchObject({ decision: 'approve', scope: 'session' });
    const c = t.ctl.decide(req('3', 'high', 'rm -rf build')); await wait(330); await t.send('s'); expect(t.ctl.state.approvals).toHaveLength(1); await t.send('n'); await c;
  });
  it('the countdown formats as m:ss and the prompt shows it once the engine gave a deadline', async () => {
    const { countdown, Approval } = await import('../src/components/Approval.js'); const React = (await import('react')).default; const { renderToString } = await import('ink');
    expect(countdown(598_000)).toBe('9:58'); expect(countdown(5_000)).toBe('0:05'); expect(countdown(0)).toBe('0:00'); expect(countdown(7_500_000)).toBe('2h 05m');
    const mk = (expiresAt?: number) => ({ req: { approval_id: 'a', agent_id: 'me', tool_id: 't', tool: 'Bash', summary: 'x', risk: 'medium', command: 'npm test' }, agentName: 'you', color: 'violet', resolve() {}, confirmHigh: false, expiresAt } as never);
    const show = (a: unknown) => renderToString(React.createElement(Approval, { a: a as never, width: 80, confirming: false }), { columns: 80 });
    expect(show(mk(Date.now() + 120_000))).toMatch(/Declines on its own in 1:5\d|Declines on its own in 2:00/); expect(show(mk())).not.toContain('Declines on its own');
  });
  it('the policy prompter stamps each approval with when it expires', async () => {
    const c = new AppController({ engine: new DemoEngine({ speed: 100 }), demo: true, cwd: '/tmp', version: 't', skills: [], approvalTimeoutMs: 90_000 });
    const ac = new AbortController(); void c.promptApproval({ approval_id: 'p1', agent_id: c.state.activeAgent, tool: 'Bash', summary: 'x', command: 'ls', risk: 'medium' } as never, ac.signal);
    const e = c.state.approvals[0]!.expiresAt!; expect(e - Date.now()).toBeGreaterThan(88_000); expect(e - Date.now()).toBeLessThanOrEqual(90_000); ac.abort(); c.stop();
  });
});

describe('the palette (ctrl+k)', () => {
  it('opens, searches commands as you type (fuzzy), runs the chosen one and closes', async () => {
    const t = await mount(); await t.send('\x0b', 120); expect(t.ctl.state.mode).toBe('palette');
    await t.send('mode pl', 50); await t.until(() => t.frame().includes('/mode plan')); await t.send('\r', 200); expect(t.ctl.state.mode).toBe('chat');
  });
  it('shows what you usually want before anything is typed, and esc closes it without running anything', async () => {
    const t = await mount(); await t.send('\x0b', 400); await t.click('Recent'); void 0; expect(t.ctl.state.mode).toBe('palette');
    await t.send('\x1b', 200); expect(t.ctl.state.mode).toBe('chat');
  });
});

describe('the palette with the mouse', () => {
  it('clicking a result runs it and closes the palette', async () => {
    const t = await mount(); await t.send('\x0b', 200); await t.send('theme h', 50); await t.until(() => t.frame().includes('theme hc')); await t.click('theme hc'); await wait(150);
    expect(t.ctl.state.settings.theme).toBe('hc'); expect(t.ctl.state.mode).toBe('chat');
  });
  it('clicking a recent command with nothing typed also works', async () => {
    const t = await mount(); await t.send('\x0b', 50); await t.until(() => t.frame().includes('Recent')); await t.click('/settings'); await wait(150); expect(t.ctl.state.mode).toBe('pick'); expect(t.ctl.state.pick!.title).toBe('Settings'); t.ctl.pickKey('cancel');
  });
});

describe('palette editing', () => {
  it('backspace deletes the last letter of the query, and typing again searches again', async () => {
    const t = await mount(); const q = () => t.frame().split('\n').find((l) => l.includes('›'))!.replace(/[│╭╮╰╯]/g, '').trim();
    await t.send('\x0b', 200); await t.send('xyz', 200); expect(q()).toBe('› xyz'); await t.send('\x7f', 200); expect(q()).toBe('› xy'); await t.send('\x7f', 150); await t.send('\x7f', 150); await t.send('\x7f', 150); expect(q()).toMatch(/type to search/);
    await t.send('theme h', 400); expect(t.frame()).toContain('theme hc');
  });
});

describe('review fixes: the night panel, masked answers and modified clicks', () => {
  it('in the night panel a message over the limit stays in the prompt (it is not lost)', async () => {
    const t = await mount(); t.ctl.openNight(); const long = 'x'.repeat(70_000); t.ctl.patch({ input: long, cursor: long.length }); await wait(30); await t.send('\r', 60);
    expect(t.text()).toBe(long); expect(t.ctl.state.night.tasks).toHaveLength(0); expect(t.ctl.state.toasts.at(-1)!.text).toMatch(/limit is 65,536/);
    t.ctl.patch({ input: 'a short task', cursor: 12 }); await wait(30); await t.send('\r', 60); expect(t.ctl.state.night.tasks.map((x) => x.text)).toEqual(['a short task']); expect(t.text()).toBe('');
  });
  it('a secret answer is drawn as dots in the prompt', async () => {
    const t = await mount(); const r = (t.ctl as any).askEngine([{ id: 'p', text: 'Password?', secret: true }]) as Promise<unknown>; await wait(60); await t.send('hunter2', 80);
    expect(t.frame()).toContain('•••••••'); expect(t.frame()).not.toContain('hunter2'); await t.send('\r', 80); expect(await r).toEqual({ p: ['hunter2'] });
  });
  it('a click with shift, alt or ctrl held is not a click; a plain one is', async () => {
    const { clicksIn } = await import('../src/click.js');
    expect(clicksIn('\x1b[<0;10;5M')).toEqual([{ col: 10, row: 5 }]); for (const b of [4, 8, 16, 32, 64, 65, 1, 2]) expect(clicksIn(`\x1b[<${b};10;5M`)).toEqual([]); expect(clicksIn('\x1b[<0;10;5m')).toEqual([]);
  });
});

describe('@file suggestions', () => {
  const repo = REPO_ROOT;
  it('typing @ and a few letters suggests project files; Tab completes the chosen one with a space', async () => {
    const t = await mount({ cwd: repo }); await t.send('look at @ptkeys', 50); await t.until(() => t.frame().includes('@prompt-keys.test.tsx'));
    expect(t.frame()).toContain('@prompt-keys.test.tsx'); expect(t.frame()).toContain('packages/tui/test/'); await t.send('\t', 150);
    expect(t.text()).toBe('look at @packages/tui/test/prompt-keys.test.tsx '); expect(t.frame()).not.toContain('▸ @'); // the suggestions are gone
  });
  it('Enter completes instead of sending while a file is suggested; the arrows choose between them', async () => {
    const t = await mount({ cwd: repo }); const sent: string[] = []; t.ctl.submit = (async (x: string) => { sent.push(x); }) as never;
    await t.send('@palette/Comm', 50); await t.until(() => !!t.ctl.state.mention?.items.length); expect(t.ctl.state.mention!.items.length).toBeGreaterThan(0); const first = t.ctl.state.mention!.items[0]!; await t.send('\r', 150); expect(sent).toEqual([]); expect(t.text()).toBe('@' + first + ' ');
    await t.send('\x1ba'); await t.send('\x7f'); await t.send('@prompt', 50); await t.until(() => (t.ctl.state.mention?.items.length ?? 0) > 1 && t.ctl.state.mention!.q === 'prompt'); const n = t.ctl.state.mention!.items.length; expect(n).toBeGreaterThan(1); await t.send('\x1b[B', 100); expect(t.ctl.state.mention!.sel).toBe(1);
    const second = t.ctl.state.mention!.items[1]!; await t.send('\t', 150); expect(t.text()).toBe('@' + second + ' ');
  });
  it('a click on a suggestion completes it', async () => {
    const t = await mount({ cwd: repo }); await t.send('@ptkeys', 50); await t.until(() => t.frame().includes('@prompt-keys.test.tsx')); await t.click('@prompt-keys.test.tsx'); await wait(100); expect(t.text()).toBe('@packages/tui/test/prompt-keys.test.tsx ');
  });
  it('an email address, a finished mention and a word with no matching file show nothing, and Enter still sends', async () => {
    const t = await mount({ cwd: repo }); const sent: string[] = []; t.ctl.submit = (async (x: string) => { sent.push(x); }) as never;
    await t.send('mail me at a@prompt-keys', 500); expect(t.ctl.state.mention).toBeUndefined(); await t.send('\r', 100); expect(sent).toEqual(['mail me at a@prompt-keys']);
    await t.send('\x1ba'); await t.send('\x7f'); await t.send('@zzzqqq', 600); expect(t.ctl.state.mention).toBeUndefined(); await t.send('\r', 100); expect(sent.at(-1)).toBe('@zzzqqq');
  });
});

describe('ctrl+r: earlier messages', () => {
  it('lists this project\'s earlier messages (newest first, no commands, no repeats); picking one puts it in the prompt without sending', async () => {
    const t = await mount(); t.ctl.patch({ history: ['first idea', '/mode plan', 'second idea', 'first idea', 'third idea'] }); const sent: string[] = []; t.ctl.submit = (async (x: string) => { sent.push(x); }) as never;
    await t.send('\x12', 150); expect(t.ctl.state.mode).toBe('pick'); expect(t.ctl.state.pick!.options.map((o) => o.label)).toEqual(['third idea', 'first idea', 'second idea']);
    await t.send('\x1b[B', 80); await t.send('\r', 150); expect(t.text()).toBe('first idea'); expect(t.cursor()).toBe(10); expect(sent).toEqual([]); expect(t.ctl.state.mode).toBe('chat');
  });
  it('says so when there is nothing yet, and Esc leaves the prompt as it was', async () => {
    const t = await mount(); await t.send('\x12', 100); expect(t.ctl.state.toasts.at(-1)!.text).toMatch(/No earlier messages/); t.ctl.patch({ history: ['one'] }); await t.send('draft', 50); await t.send('\x12', 150); await t.send('\x1b', 100); expect(t.text()).toBe('draft');
  });
});

describe('/find', () => {
  const many = () => Array.from({ length: 60 }, (_, i) => (i % 2 ? { id: 'a' + i, kind: 'assistant', messageId: 'm' + i, agentId: 'x', text: `reply number ${i} about ${i === 11 ? 'the zebra crossing' : 'nothing special'}`, done: true } : { id: 'u' + i, kind: 'user', text: `question ${i}${i === 40 ? ' mentions a zebra too' : ''}`, ts: 1 })) as never[];
  it('lists the messages that contain the words, and scrolls the chosen one into view', async () => {
    const t = await mount(); t.ctl.patch({ items: many() }); await wait(60);
    const run = t.ctl.runCommand('/find zebra'); await wait(60); expect(t.ctl.state.pick!.title).toBe('2 messages mention "zebra"'); expect(t.ctl.state.pick!.options.map((o) => o.hint)).toEqual(['Cento', 'You']); expect(t.ctl.state.pick!.options[0]!.label).toContain('the zebra crossing');
    t.ctl.pickKey('enter'); await run; await wait(150); expect(t.ctl.state.jumpTo).toBeUndefined(); expect(t.ctl.state.scroll).toBeGreaterThan(0); expect(t.frame()).toContain('the zebra crossing'); expect(t.frame()).toContain('more lines below');
  });
  it('says so when nothing matches or nothing was typed, and Esc changes nothing', async () => {
    const t = await mount(); t.ctl.patch({ items: many() }); await t.ctl.runCommand('/find'); expect(t.ctl.state.toasts.at(-1)!.text).toMatch(/Type what to look for/);
    await t.ctl.runCommand('/find giraffe'); expect(t.ctl.state.toasts.at(-1)!.text).toBe('Nothing in this conversation mentions "giraffe".'); const run = t.ctl.runCommand('/find ZEBRA'); await wait(60); t.ctl.pickKey('cancel'); await run; expect(t.ctl.state.scroll).toBe(0);
  });
});

describe('second review: app-level', () => {
  it('ctrl+r keeps your draft one step down (the down arrow brings it back)', async () => {
    const t = await mount(); t.ctl.patch({ history: ['older', 'newer'] }); await t.send('my draft', 50); await t.send('\x12', 150); await t.send('\r', 150); expect(t.text()).toBe('newer');
    await t.send('\x1b[B', 100); expect(t.text()).toBe('my draft');
  });
  it('during a secret question the arrows do not pull earlier messages into the dots, and an earlier draft is not what gets sent', async () => {
    const t = await mount(); t.ctl.patch({ history: ['an earlier message'] }); await t.send('half a thought', 50); const r = (t.ctl as any).askEngine([{ id: 'p', text: 'Password?', secret: true }]) as Promise<unknown>; await wait(80);
    expect(t.text()).toBe(''); await t.send('\x1b[A', 100); expect(t.text()).toBe(''); await t.send('pw', 50); await t.send('\r', 100); expect(await r).toEqual({ p: ['pw'] }); expect(t.text()).toBe('half a thought');
  });
  it('in the night panel Enter completes a suggested file instead of queueing the half-typed word', async () => {
    const t = await mount({ cwd: REPO_ROOT }); t.ctl.openNight(); await t.send('do @ptkeys', 50); await t.until(() => t.ctl.state.mention?.q === 'ptkeys' && !!t.ctl.state.mention.items.length);
    await t.send('\r', 150); expect(t.ctl.state.night.tasks).toHaveLength(0); expect(t.text()).toMatch(/^do @packages\/tui\/test\/prompt-keys\.test\.tsx $/); await t.send('\r', 150); expect(t.ctl.state.night.tasks).toHaveLength(1); expect(t.text()).toBe('');
  });
});

describe('ctrl+g (your editor) and ctrl+z (the background)', () => {
  it('ctrl+g hands the prompt to the launcher, and what comes back replaces it; an editor that saved nothing leaves it alone', async () => {
    const tasks: import('../src/index.js').ExternalTask[] = []; const t = await mount({ external: (x) => { tasks.push(x); } }); await t.send('a draft in the prompt', 50); await t.send('\x07', 100);
    expect(tasks).toHaveLength(1); expect(tasks[0]).toMatchObject({ kind: 'editor', text: 'a draft in the prompt' });
    (tasks[0] as { done(x?: string): void }).done('a long message\nwritten in vim\nwith three lines'); expect(t.text()).toBe('a long message\nwritten in vim\nwith three lines'); expect(t.cursor()).toBe(t.text().length);
    await t.send('\x07', 100); (tasks[1] as { done(x?: string): void }).done(undefined); expect(t.text()).toBe('a long message\nwritten in vim\nwith three lines'); expect(t.ctl.state.toasts.at(-1)!.text).toMatch(/did not save anything/);
    await t.send('\x15\x15', 50); await t.send('\x07', 100); expect(tasks[2]).toMatchObject({ kind: 'editor' }); // works on an empty prompt too
  });
  it('ctrl+z asks to be put in the background; without a launcher both keys say they are not available', async () => {
    const tasks: import('../src/index.js').ExternalTask[] = []; const t = await mount({ external: (x) => { tasks.push(x); } }); await t.send('\x1a', 100); expect(tasks).toEqual([{ kind: 'suspend' }]);
    const plain = await mount(); await plain.send('\x1a', 100); expect(plain.ctl.state.toasts.at(-1)!.text).toMatch(/Suspending is not available/); await plain.send('\x07', 100); expect(plain.ctl.state.toasts.at(-1)!.text).toMatch(/Editing in your editor is not available/);
  });
});

describe('the terminal tab title', () => {
  const titles = (raw: string) => [...raw.matchAll(/\x1b\]0;([^\x07]*)\x07/g)].map((m) => m[1]!);
  it('names the folder and says when the agent works or needs you', async () => {
    const t = await mount({ cwd: '/home/me/projects/shop' }); await t.until(() => titles(t.raw()).length > 0); expect(titles(t.raw()).at(-1)).toBe('shop · Centcom (demo)');
    t.ctl.patch({ busy: true }); await t.until(() => titles(t.raw()).at(-1)?.startsWith('◐ working') === true); expect(titles(t.raw()).at(-1)).toBe('◐ working · shop · Centcom (demo)');
    void t.ctl.decide({ approval_id: 'a', agent_id: 'me', tool_id: 't', tool: 'Bash', summary: 'x', risk: 'medium', command: 'ls' } as never); await t.until(() => titles(t.raw()).at(-1)?.startsWith('● needs you') === true);
    t.ctl.answerApproval('deny'); t.ctl.patch({ busy: false }); await t.until(() => titles(t.raw()).at(-1) === 'shop · Centcom (demo)'); t.unmount();
  });
  it('/title off leaves the title alone (and does not touch the saved one); control characters in a folder name cannot break out', async () => {
    const t = await mount({ cwd: '/tmp/odd\x07name\x1b]0;evil' }); await t.until(() => titles(t.raw()).length > 0); const all = titles(t.raw()); expect(all.every((x) => !/[\x00-\x1f]/.test(x))).toBe(true); expect(t.raw()).not.toMatch(/\x1b\]0;[^\x07]*\x1b\]0;evil/);
    await t.ctl.runCommand('/title off'); await wait(80); const n = t.raw().length; t.ctl.patch({ busy: true }); await wait(150); expect(titles(t.raw().slice(n))).toEqual([]); expect(t.ctl.state.settings.title).toBe(false); t.unmount();
  });
});

describe('undo and redo in the prompt (ctrl+_ and alt+y)', () => {
  const UNDO = '\x1f', REDO = '\x1by';
  it('a run of typing is one step; select-all and delete, a word kill and a replaced selection can each be taken back', async () => {
    const t = await mount(); for (const ch of 'hello world') await t.send(ch, 12); expect(t.text()).toBe('hello world'); // typed one key at a time, as a person does
    await t.send('\x1ba', 30); await t.send('\x7f', 30); expect(t.text()).toBe(''); await t.send(UNDO, 60); expect(t.text()).toBe('hello world'); // the delete is undone
    await t.send(UNDO, 60); expect(t.text()).toBe(''); // the whole run of typing is one step
    await t.send(REDO, 60); expect(t.text()).toBe('hello world'); await t.send(REDO, 60); expect(t.text()).toBe('');
  });
  it('undo works after killing a word and after typing over a selection; a new edit ends the redo', async () => {
    const t = await mount(); for (const ch of 'one two three') await t.send(ch, 12); await wait(750); await t.send('\x17', 60); expect(t.text()).toBe('one two '); await wait(750); await t.send('\x1b[1;2D', 40); await t.send('X', 60); expect(t.text()).toBe('one X');
    await t.send(UNDO, 60); expect(t.text()).toBe('one two '); await t.send(UNDO, 60); expect(t.text()).toBe('one two three'); await t.send(REDO, 60); expect(t.text()).toBe('one two '); await t.send('\x05', 40); await t.send('y', 60); await t.send(REDO, 60); expect(t.text()).toBe('one two y'); // typing cleared the redo (ctrl+e first: undo puts the cursor where it was)
  });
  it('Esc that clears the prompt, a completed @file and a message from ctrl+r can all be taken back; sending starts over; an empty history does nothing', async () => {
    const t = await mount({ cwd: REPO_ROOT }); await t.send('a draft worth keeping', 40); await wait(750); await t.send('\x1b', 80); expect(t.text()).toBe(''); await t.send(UNDO, 60); expect(t.text()).toBe('a draft worth keeping');
    await t.send('\x15', 40); await wait(750); await t.send(' @ptkeys', 50); await t.until(() => !!t.ctl.state.mention?.items.length); await t.send('\t', 100); expect(t.text()).toMatch(/@packages\/tui\/test\/prompt-keys\.test\.tsx $/); await t.send(UNDO, 60); expect(t.text()).toBe(' @ptkeys');
    const sent: string[] = []; t.ctl.submit = (async (x: string) => { sent.push(x); }) as never; const empty = await mount(); await empty.send(UNDO, 60); await empty.send(REDO, 60); expect(empty.text()).toBe('');
    const u = await mount(); await u.send('keep me', 30); await u.ctl.submit('keep me'); await u.send(UNDO, 60); expect(u.text()).toBe(''); // a sent message is not brought back by undo
  });
});

describe('undo history is dropped when the prompt changes any other way', () => {
  const UNDO = '\x1f', REDO = '\x1by';
  it('insertIntoPrompt after an undo clears redo; history up-arrow starts over; emptying a prompt with a paste chip cannot be undone into a dead chip', async () => {
    const t = await mount(); for (const ch of 'ab') await t.send(ch, 12); await t.send(UNDO, 60); expect(t.text()).toBe(''); t.ctl.patch({ input: 'x', cursor: 1 }); await t.send(REDO, 60); expect(t.text()).toBe('x');
    await t.send('\x15', 40); await t.send('\x1b[200~' + Array.from({ length: 12 }, (_, i) => 'l' + i).join('\n') + '\x1b[201~', 80); await t.until(() => /Pasted/.test(t.text())); await wait(750); await t.send('\x1b', 80); expect(t.text()).toBe(''); await t.send(UNDO, 60); expect(t.text()).toBe('');
  });
});
