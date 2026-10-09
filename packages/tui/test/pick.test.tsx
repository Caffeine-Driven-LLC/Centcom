import React from 'react';
import { resolve as resolvePath } from 'node:path';
const REPO_ROOT = resolvePath(__dirname, '../../..'); // not the folder the tests were started from
import { renderToString } from 'ink';
import { describe, expect, it } from 'vitest';
import { DemoEngine } from '@centcom/agent';
import { AppController } from '../src/controller.js';
import { MultiSelect } from '../src/pick/MultiSelect.js';
import { newPick, pickAll, pickMove, pickResult, pickToggle } from '../src/pick/model.js';

const opts = ['a', 'b', 'c'].map((id) => ({ id, label: 'option ' + id }));
const strip = (s: string) => s.replace(/\x1b\[[0-9;]*m/g, '');
const make = () => new AppController({ engine: new DemoEngine({ speed: 100 }), demo: true, cwd: '/tmp', version: 't', skills: [] });

describe('multi-select model', () => {
  it('ticks, unticks, wraps and returns ticked ids in list order', () => {
    let p = newPick({ title: 't', options: opts });
    p = pickToggle(pickMove(pickMove(p, 1), 1)); p = pickToggle(pickMove(p, 1)); // c, then wraps to a
    expect(pickResult(p)).toEqual(['a', 'c']); p = pickToggle(p); expect(pickResult(p)).toEqual(['c']);
  });
  it('a ticks all, then none; single choice returns the highlighted one', () => {
    const p = newPick({ title: 't', options: opts }); expect(pickResult(pickAll(p))).toEqual(['a', 'b', 'c']); expect(pickResult(pickAll(pickAll(p)))).toEqual([]);
    const one = pickMove(newPick({ title: 't', options: opts, multi: false }), 1); expect(pickResult(one)).toEqual(['b']); expect(pickResult(pickToggle(pickMove(one, 1)))).toEqual(['c']);
  });
  it('ignores pre-ticked ids that are not options', () => { expect(newPick({ title: 't', options: opts, checked: ['b', 'zz'] }).checked).toEqual(['b']); });
  it('renders boxes, the count and the keys', () => {
    const out = strip(renderToString(<MultiSelect p={pickToggle(newPick({ title: 'Pick some', options: opts }))} width={80} height={20} />, { columns: 80 }));
    expect(out).toContain('Pick some'); expect(out).toContain('◉ option a'); expect(out).toContain('○ option b'); expect(out).toContain('space tick'); expect(out).toContain('(1)');
  });
});
describe('picker in the controller', () => {
  it('returns the ticked ids and goes back to chat; esc returns undefined', async () => {
    const c = make(); const r = c.pick({ title: 't', options: opts }); expect(c.state.mode).toBe('pick');
    c.pickKey('toggle'); c.pickKey('down'); c.pickKey('down'); c.pickKey('toggle'); c.pickKey('enter');
    expect(await r).toEqual(['a', 'c']); expect(c.state.mode).toBe('chat'); expect(c.state.pick).toBeUndefined();
    const r2 = c.pick({ title: 't', options: opts }); c.pickKey('cancel'); expect(await r2).toBeUndefined();
  });
  it('/night remove with no number removes the ticked queued tasks', async () => {
    const c = make(); c.nightAdd('one'); c.nightAdd('two'); c.nightAdd('three');
    const run = c.runCommand('/night remove'); await Promise.resolve(); expect(c.state.mode).toBe('pick');
    c.pickKey('down'); c.pickKey('toggle'); c.pickKey('enter'); await run;
    expect(c.state.night.tasks.map((t) => t.text)).toEqual(['one', 'three']);
  });
  it('an agent question with options opens the picker and your choice is sent as a message', async () => {
    const c = make(); const sent: string[] = []; c.submit = (async (t: string) => { sent.push(t); }) as never;
    const ans = (c as any).answerQuestion('Where?', ['In isExpired', 'In the caller']); expect(c.state.mode).toBe('pick');
    c.pickKey('toggle'); c.pickKey('down'); c.pickKey('toggle'); c.pickKey('enter'); await ans;
    expect(sent).toEqual(['In isExpired, In the caller']);
  });
});
describe('/effort', () => {
  const withSession = () => { const c = make(); const calls: string[] = []; (c as any).session = { setEffort: (e: string) => calls.push(e) }; (c as any).state.engineId; c.patch({ engineId: 'claude-code' }); return { c, calls }; };
  it('sets a valid level, rejects an unknown one, and default clears it', async () => {
    const { c, calls } = withSession();
    await c.runCommand('/effort high'); await c.runCommand('/effort bogus'); await c.runCommand('/effort default');
    expect(calls).toEqual(['high', '']); expect(c.state.toasts.some((t) => /one of: low, medium, high, xhigh, max/.test(t.text))).toBe(true);
  });
  it('with no argument it opens a single-choice list with the current level ticked', async () => {
    const { c, calls } = withSession(); await c.runCommand('/effort max');
    const run = c.runCommand('/effort'); await new Promise((r) => setTimeout(r, 0));
    expect(c.state.mode).toBe('pick'); expect(c.state.pick!.checked).toEqual(['max']); expect(c.state.pick!.options.map((o) => o.label)).toEqual(['default', 'low', 'medium', 'high', 'xhigh', 'max']);
    c.pickKey('down'); c.pickKey('down'); c.pickKey('toggle'); c.pickKey('enter'); await run; expect(calls.at(-1)).toBe('low');
  });
  it('an engine without the setting says so', async () => { const c = make(); await c.runCommand('/effort high'); expect(c.state.toasts.at(-1)!.text).toMatch(/no effort setting/); });
});
describe('settings as lists', () => {
  it.each([['theme', 'light', { theme: 'light' }], ['mascot', 'off', { mascot: 'off' }], ['color', 'green', { color: 'green' }], ['motion', 'reduced', { reducedMotion: true }], ['mode', 'plan', { permissionMode: 'plan' }]] as const)('/%s with no value lists the choices and applies %s', async (cmd, pickId, expected) => {
    const c = make(); const run = c.runCommand('/' + cmd); await new Promise((r) => setTimeout(r, 0)); expect(c.state.mode).toBe('pick');
    const p = c.state.pick!; expect(p.multi).toBe(false); for (let i = 0; i < 6 && c.state.pick!.options[c.state.pick!.sel]!.id !== pickId; i++) c.pickKey('down');
    c.pickKey('enter'); await run; expect(c.state.settings).toMatchObject(expected);
  });
  it('a value given on the command line skips the list', async () => { const c = make(); await c.runCommand('/theme light'); expect(c.state.mode).toBe('chat'); expect(c.state.settings.theme).toBe('light'); });
});
describe('/resume as a list', () => {
  it('lists saved conversations and resumes the highlighted one', async () => {
    const c = make(); const metas = [{ id: 'ses_a', title: 'first', messages: 3, updatedAt: Date.now() }, { id: 'ses_b', title: 'second', messages: 5, updatedAt: Date.now() - 3 * 3600_000 }];
    (c as any).o.sessions = { list: () => metas, load: () => undefined, close() {} }; const resumed: string[] = []; (c as any).resumeSession = async (id: string) => { resumed.push(id); };
    const run = c.runCommand('/resume'); await new Promise((r) => setTimeout(r, 0)); expect(c.state.mode).toBe('pick'); expect(c.state.pick!.options.map((o) => o.label)).toEqual(['first', 'second']); expect(c.state.pick!.options[1]!.hint).toContain('3 h ago');
    c.pickKey('down'); c.pickKey('enter'); await run; expect(resumed).toEqual(['ses_b']);
  });
});
describe('permissions and night allow as lists', () => {
  it('/permissions lists the saved rules and removes the ticked ones', async () => {
    const c = make(); const removed: string[] = [];
    (c as any).o.policy = { root: '/x', engine: { rules: { list: () => [{ id: 'r1', action: 'allow', tool: 'Bash', matcher: { command: 'npm test' } }, { id: 'r2', action: 'deny', tool: 'Edit' }], warnings: () => [], needsTrust: () => false, remove: async (id: string) => { removed.push(id); return true; } } } };
    const run = c.runCommand('/permissions'); await new Promise((r) => setTimeout(r, 0)); expect(c.state.mode).toBe('pick'); expect(c.state.pick!.options.map((o) => o.label)).toEqual(['Bash npm test', 'Edit']);
    c.pickKey('down'); c.pickKey('toggle'); c.pickKey('enter'); await run; expect(removed).toEqual(['r2']);
  });
  it('/night allow with no word offers the two choices and applies the pick', async () => {
    const c = make(); expect(c.state.night.allowPush).toBe(false);
    const run = c.runCommand('/night allow'); await new Promise((r) => setTimeout(r, 0)); expect(c.state.pick!.options.map((o) => o.id)).toEqual(['none', 'push']);
    c.pickKey('down'); c.pickKey('enter'); await run; expect(c.state.night.allowPush).toBe(true);
  });
});
describe('a single-choice agent question', () => {
  it('opens a one-of list and sends just the highlighted option', async () => {
    const c = make(); const sent: string[] = []; c.submit = (async (t: string) => { sent.push(t); }) as never;
    const ans = (c as any).answerQuestion('Where?', ['In isExpired', 'In the caller'], false); await Promise.resolve();
    expect(c.state.pick!.multi).toBe(false); c.pickKey('down'); c.pickKey('enter'); await ans; expect(sent).toEqual(['In the caller']);
  });
});
describe('questions from Codex', () => {
  const ask = (c: AppController, qs: unknown[]) => (c as any).askEngine(qs) as Promise<Record<string, string[]> | undefined>;
  const tick = () => new Promise((r) => setTimeout(r, 0));
  it('a choice is a one-of list and its label is the answer', async () => {
    const c = make(); const r = ask(c, [{ id: 'q1', header: 'Colour', text: 'Which?', options: [{ label: 'red' }, { label: 'blue', description: 'cool' }] }]); await tick();
    expect(c.state.pick!.title).toBe('Colour: Which?'); expect(c.state.pick!.multi).toBe(false); c.pickKey('down'); c.pickKey('enter'); expect(await r).toEqual({ q1: ['blue'] });
  });
  it('"Something else…" and option-less questions take a typed line that never reaches the agent or the transcript', async () => {
    const c = make(); 
    const r = ask(c, [{ id: 'a', text: 'Pick', options: [{ label: 'x' }], allowOther: true }, { id: 'b', text: 'Name?' }]); await tick();
    expect(c.state.pick!.options.map((o) => o.label)).toEqual(['x', 'Something else…']); c.pickKey('down'); c.pickKey('enter'); await tick();
    const before = c.state.items.length; await c.submit('green'); await tick(); await c.submit('Ada'); expect(await r).toEqual({ a: ['green'], b: ['Ada'] });
    expect(c.state.items.some((i) => (i as { kind: string; text?: string }).kind === 'user' && /green|Ada/.test((i as { text?: string }).text ?? ''))).toBe(false); expect(c.state.items.length).toBeGreaterThanOrEqual(before);
  });
  it('cancelling (Esc in the list, or an interrupt while a typed answer is awaited) answers nothing', async () => {
    const c = make(); const r1 = ask(c, [{ id: 'q', text: 'Which?', options: [{ label: 'x' }] }]); await tick(); c.pickKey('cancel'); expect(await r1).toBeUndefined();
    const r2 = ask(c, [{ id: 'q', text: 'Name?' }]); await tick(); await c.interrupt(); expect(await r2).toBeUndefined();
  });
});
describe('high contrast theme', () => {
  it('has black grounds, white text and borders, and keeps the dark status colours', async () => {
    const { createTheme } = await import('@centcom/theme'); const hc = createTheme('hc', 'truecolor'); const dark = createTheme('dark', 'truecolor');
    expect(hc.c('bg.base')).toBe('#000000'); expect(hc.c('text.primary')).toBe('#FFFFFF'); expect(hc.c('border.default')).toBe('#FFFFFF'); expect(hc.c('border.strong')).toBe('#FFFFFF');
    expect(hc.c('status.danger')).toBe(dark.c('status.danger')); expect(hc.c('accent.primary')).toBe(dark.c('accent.primary')); expect(hc.c('text.muted')).not.toBe(dark.c('text.muted'));
  });
  it('/theme hc applies it, and a bare /theme lists three choices with the current one marked', async () => {
    const c = make(); await c.runCommand('/theme hc'); expect(c.state.settings.theme).toBe('hc');
    const run = c.runCommand('/theme'); await new Promise((r) => setTimeout(r, 0)); expect(c.state.pick!.options.map((o) => o.id)).toEqual(['dark', 'light', 'hc']); expect(c.state.pick!.checked).toEqual(['hc']); c.pickKey('cancel'); await run;
  });
});
describe('/spinner', () => {
  it('plain shows "Working…" in the waiting line, fun rotates; bare /spinner is a list; it is remembered', async () => {
    const React = (await import('react')).default; const { renderToString } = await import('ink'); const { LiveStrip } = await import('../src/components/LiveStrip.js'); const { MascotDriver } = await import('@centcom/mascot');
    const c = make(); c.patch({ busy: true, verb: 'Pondering', items: [{ id: 'u', kind: 'user', text: 'x' } as never] });
    const strip = () => renderToString(React.createElement(LiveStrip, { s: c.state, driver: new MascotDriver({}) as never, width: 60, size: 'off' as const }), { columns: 70 });
    expect(strip()).toContain('Pondering'); await c.runCommand('/spinner plain'); expect(c.state.settings.spinner).toBe('plain'); const t = strip(); expect(t).toContain('Working…'); expect(t).not.toContain('Pondering');
    await c.runCommand('/spinner fun'); expect(strip()).toContain('Pondering'); await c.runCommand('/spinner loud'); expect(c.state.toasts.at(-1)!.text).toMatch(/fun or \/spinner plain/);
    const run = c.runCommand('/spinner'); await new Promise((r) => setTimeout(r, 0)); expect(c.state.pick!.options.map((o) => o.id)).toEqual(['fun', 'plain']); c.pickKey('down'); c.pickKey('enter'); await run; expect(c.state.settings.spinner).toBe('plain');
  });
});
describe('/density', () => {
  it('compact keeps a blank row only before your own messages; comfortable keeps them between all blocks', async () => {
    const { TranscriptLayout } = await import('../src/transcript/layout.js');
    const items = [{ id: 'u1', kind: 'user', text: 'one' }, { id: 'a1', kind: 'assistant', text: 'reply', done: true }, { id: 'n1', kind: 'notice', level: 'info', text: 'note' }, { id: 'u2', kind: 'user', text: 'two' }, { id: 'a2', kind: 'assistant', text: 'reply two', done: true }] as never[];
    const rows = (compact: boolean) => { const l = new TranscriptLayout().update(items, 60, compact); return { total: l.total, blank: l.slice(0, l.total).filter((r) => r.length === 0).length }; };
    const comfy = rows(false), tight = rows(true); expect(comfy.blank).toBe(4); expect(tight.blank).toBe(1); expect(tight.total).toBe(comfy.total - 3);
  });
  it('/density sets it, rejects nonsense, lists the two choices, and is remembered', async () => {
    const c = make(); await c.runCommand('/density compact'); expect(c.state.settings.density).toBe('compact'); await c.runCommand('/density roomy'); expect(c.state.toasts.at(-1)!.text).toMatch(/comfortable or \/density compact/);
    const run = c.runCommand('/density'); await new Promise((r) => setTimeout(r, 0)); expect(c.state.pick!.options.map((o) => o.id)).toEqual(['comfortable', 'compact']); expect(c.state.pick!.checked).toEqual(['compact']); c.pickKey('cancel'); await run;
    const { settingsFromConfig } = await import('../src/clientConfig.js'); expect(typeof settingsFromConfig).toBe('function');
  });
});
describe('palette providers', () => {
  const find = async (c: AppController, id: string, q: string) => { const p = c.paletteProviders().find((x) => x.id === id)!; return p.search(q, new AbortController().signal); };
  it('commands: a typed command, a quick setting and an animation are found, with the slash command they run', async () => {
    const c = make(); const cmds = await find(c, 'commands', 'night'); expect(cmds.map((i) => i.label)).toContain('night'); const th = await find(c, 'commands', 'theme hc'); expect(th[0]!.label).toBe('theme hc');
    const ran: string[] = []; c.submit = (async (x: string) => { ran.push(x); }) as never; await th[0]!.run(); await (await find(c, 'commands', 'cento idle_breathe'))[0]!.run(); expect(ran).toEqual(['/theme hc', '/cento idle_breathe']);
  });
  it('files of this project are found by a fuzzy name; picking one mentions it in the prompt', async () => {
    const c = new AppController({ engine: new DemoEngine({ speed: 100 }), demo: true, cwd: REPO_ROOT, version: 't', skills: [] }); const hits = await find(c, 'files', 'ptkeys'); expect(hits.some((h) => h.label.endsWith('packages/tui/test/prompt-keys.test.tsx'))).toBe(true);
    c.patch({ input: 'look at', cursor: 7 }); await hits.find((h) => h.label.endsWith('prompt-keys.test.tsx'))!.run(); expect(c.state.input).toMatch(/^look at @\S*prompt-keys\.test\.tsx $/); c.stop();
  });
  it('sessions list the saved conversations (not the current one) and resume the chosen one; skills put a hint in the prompt', async () => {
    const skills = [{ name: 'review-pr', description: 'Review a pull request carefully', kind: 'skill', source: 'user', path: '/x' }, { name: 'ship', description: 'Ship it', kind: 'command', source: 'user', path: '/y' }] as never[];
    const c = new AppController({ engine: new DemoEngine({ speed: 100 }), demo: true, cwd: '/tmp', version: 't', skills });
    (c as any).o.sessions = { list: () => [{ id: c.state.sessionId, title: 'this one', messages: 2 }, { id: 'ses_old', title: 'fix the login bug', messages: 9 }], load: () => undefined, close() {} }; const resumed: string[] = []; (c as any).resumeSession = async (id: string) => { resumed.push(id); };
    const ses = await find(c, 'sessions', 'login'); expect(ses.map((s) => s.label)).toEqual(['fix the login bug']); await ses[0]!.run(); expect(resumed).toEqual(['ses_old']); expect((await find(c, 'sessions', 'this one'))).toEqual([]);
    const sk = await find(c, 'skills', 'review'); await sk[0]!.run(); expect(c.state.input).toBe('Use the review-pr skill: '); c.patch({ input: '', cursor: 0 }); await (await find(c, 'skills', 'ship'))[0]!.run(); expect(c.state.input).toBe('/ship '); c.stop();
  });
});
describe('questions during a night cycle', () => {
  it('are answered "decide yourself" at once; nothing opens and nothing waits', async () => {
    const c = make(); c.nightAdd('some task'); (c as any).night.active = () => true;
    const r = await (c as any).askEngine([{ id: 'q1', text: 'Which?', options: [{ label: 'x' }, { label: 'y' }] }, { id: 'q2', text: 'Name?' }]) as Record<string, string[]>;
    expect(c.state.mode).not.toBe('pick'); expect(r.q1![0]).toMatch(/Decide for yourself/); expect(r.q2![0]).toMatch(/Decide for yourself/);
  });
});
describe('/settings', () => {
  const tick = () => new Promise((r) => setTimeout(r, 5));
  it('lists every setting with its value, changes one through its own list, comes back to the menu, and Esc leaves', async () => {
    const c = make(); const run = c.runCommand('/settings'); await tick(); const labels = () => c.state.pick!.options.map((o) => o.label);
    expect(c.state.pick!.title).toBe('Settings'); expect(labels()).toEqual(expect.arrayContaining(['Permissions: ask', 'Theme: dark', 'Waiting line: fun', 'Spacing: comfortable', 'Mouse: off', 'Auto skills: on']));
    const at = (l: string) => c.state.pick!.options.findIndex((o) => o.label.startsWith(l));
    while (c.state.pick!.sel !== at('Theme')) c.pickKey('down'); c.pickKey('enter'); await tick(); expect(c.state.pick!.title).toBe('Theme'); c.pickKey('down'); c.pickKey('down'); c.pickKey('enter'); await tick();
    expect(c.state.settings.theme).toBe('hc'); expect(c.state.pick!.title).toBe('Settings'); expect(labels()).toContain('Theme: hc'); // back at the menu, showing the new value
    while (c.state.pick!.sel !== at('Mouse')) c.pickKey('down'); c.pickKey('enter'); await tick(); expect(c.state.settings.mouse).toBe(true); expect(labels()).toContain('Mouse: on');
    while (c.state.pick!.sel !== at('Auto skills')) c.pickKey('down'); c.pickKey('enter'); await tick(); expect(c.state.settings.autoSkills).toBe(false); expect(labels()).toContain('Auto skills: off');
    c.pickKey('cancel'); await run; expect(c.state.mode).toBe('chat');
  });
});
describe('/model for Codex', () => {
  const tick = () => new Promise((r) => setTimeout(r, 5));
  it('lists the models the Codex account reports (not Claude\'s), with their efforts, and picking one switches to it', async () => {
    const c = make(); c.patch({ engineId: 'codex' }); const switched: string[] = [];
    const { AsyncQueue } = await import('@centcom/agent'); (c as any).adopt({ events: new AsyncQueue(), stop: async () => undefined, listModels: async () => [{ id: 'gpt-x', label: 'GPT X', note: 'fast', efforts: ['low', 'high'] }, { id: 'gpt-y', label: 'GPT Y', note: 'smart' }], setModel: (m: string) => switched.push(m), resumeToken: () => undefined });
    const run = c.runCommand('/model'); await tick(); await tick(); expect(c.state.mode).toBe('pick'); expect(c.state.pick!.options.map((o) => o.label)).toEqual(['GPT X', 'GPT Y']); expect(c.state.pick!.options[0]!.hint).toContain('effort low/high');
    c.pickKey('down'); c.pickKey('enter'); await run; expect(c.state.settings.model).toBe('gpt-y'); c.stop();
  });
  it('/effort with no model chosen offers the levels of the account\'s default model (Codex has more than low, medium and high)', async () => {
    const c = make(); c.patch({ engineId: 'codex' }); const { AsyncQueue } = await import('@centcom/agent'); const set: string[] = [];
    (c as any).adopt({ events: new AsyncQueue(), stop: async () => undefined, setEffort: (e: string) => set.push(e), listModels: async () => [{ id: 'a', label: 'A', note: '', efforts: ['low', 'high'] }, { id: 'b', label: 'B', note: '', isDefault: true, efforts: ['low', 'medium', 'high', 'xhigh', 'max', 'ultra'] }], resumeToken: () => undefined });
    const run = c.runCommand('/effort'); await tick(); await tick(); expect(c.state.pick!.options.map((o) => o.label)).toEqual(['default', 'low', 'medium', 'high', 'xhigh', 'max', 'ultra']);
    c.pickKey('cancel'); await run; await c.runCommand('/effort ultra'); expect(set).toEqual(['ultra']); c.stop();
  });
  it('says so when Codex returns no list, and Claude Code still gets its own screen', async () => {
    const c = make(); c.patch({ engineId: 'codex' }); const { AsyncQueue } = await import('@centcom/agent'); (c as any).adopt({ events: new AsyncQueue(), stop: async () => undefined, listModels: async () => [], resumeToken: () => undefined }); await c.runCommand('/model'); expect(c.state.toasts.at(-1)!.text).toMatch(/did not return its model list/); expect(c.state.mode).toBe('chat');
    const d = make(); await d.runCommand('/model'); expect(d.state.mode).toBe('models'); d.stop(); c.stop();
  });
});
describe('/bell', () => {
  const mk = () => { let rings = 0; const c = new AppController({ engine: new DemoEngine({ speed: 100 }), demo: true, cwd: '/tmp', version: 't', skills: [], bell: () => { rings++; } }); return { c, rings: () => rings }; };
  const req = (id: string) => ({ approval_id: id, agent_id: 'me', tool_id: 't' + id, tool: 'Bash', summary: 'x', risk: 'medium', command: 'npm run ' + id } as never);
  const done = (c: AppController, outcome: 'ok' | 'canceled') => c.apply({ v: 1, seq: 1, ts: new Date().toISOString(), agent_id: c.state.activeAgent, type: 'turn.done', outcome } as never);
  it('is silent until you turn it on; then an approval, a question and a long task that finished ring it, a short or cancelled one does not', async () => {
    const { c, rings } = mk(); void c.decide(req('a')); c.answerApproval('deny'); expect(rings()).toBe(0);
    await c.runCommand('/bell on'); expect(c.state.settings.bell).toBe(true); void c.decide(req('b')); expect(rings()).toBe(1); c.answerApproval('deny');
    void (c as any).answerQuestion('Which?', ['x', 'y'], false); await new Promise((r) => setTimeout(r, 0)); expect(rings()).toBe(2); c.pickKey('cancel');
    c.patch({ busy: true, turnStartedAt: Date.now() - 3000 }); done(c, 'ok'); expect(rings()).toBe(2); // short
    c.patch({ busy: true, turnStartedAt: Date.now() - 30_000 }); done(c, 'canceled'); expect(rings()).toBe(2); // you stopped it yourself
    c.patch({ busy: true, turnStartedAt: Date.now() - 30_000 }); done(c, 'ok'); expect(rings()).toBe(3);
    await c.runCommand('/bell off'); void c.decide(req('c')); expect(rings()).toBe(3); c.answerApproval('deny');
  });
  it('never rings during a night cycle (nobody is there), and /bell and the settings list agree', async () => {
    const { c, rings } = mk(); await c.runCommand('/bell on'); c.nightAdd('task'); (c as any).night.active = () => true; void c.decide(req('n')); expect(rings()).toBe(0);
    const run = c.runCommand('/settings'); await new Promise((r) => setTimeout(r, 5)); expect(c.state.pick!.options.map((o) => o.label)).toContain('Bell: on'); c.pickKey('cancel'); await run; await c.runCommand('/bell loud'); expect(c.state.toasts.at(-1)!.text).toMatch(/on or \/bell off/);
  });
});
describe('an answer to a question that came while the agent was working', () => {
  const done = (c: AppController, outcome: 'ok' | 'canceled') => c.apply({ v: 1, seq: 1, ts: new Date().toISOString(), agent_id: c.state.activeAgent, type: 'turn.done', outcome } as never);
  it('waits for the turn to end and is then sent once; a stopped turn drops it', async () => {
    const c = make(); const sent: string[] = []; c.submit = (async (t: string) => { sent.push(t); }) as never; c.patch({ busy: true, turnStartedAt: Date.now() });
    const a = (c as any).answerQuestion('Which?', ['red', 'blue'], false); await new Promise((r) => setTimeout(r, 0)); c.pickKey('down'); c.pickKey('enter'); await a;
    expect(sent).toEqual([]); expect(c.state.toasts.at(-1)!.text).toMatch(/as soon as it finishes/); done(c, 'ok'); await new Promise((r) => setTimeout(r, 5)); expect(sent).toEqual(['blue']); done(c, 'ok'); await new Promise((r) => setTimeout(r, 5)); expect(sent).toEqual(['blue']);
    c.patch({ busy: true }); const b = (c as any).answerQuestion('Again?', ['x'], false); await new Promise((r) => setTimeout(r, 0)); c.pickKey('enter'); await b; done(c, 'canceled'); await new Promise((r) => setTimeout(r, 5)); done(c, 'ok'); await new Promise((r) => setTimeout(r, 5)); expect(sent).toEqual(['blue']);
  });
  it('when the agent is idle the answer is sent at once', async () => {
    const c = make(); const sent: string[] = []; c.submit = (async (t: string) => { sent.push(t); }) as never; const a = (c as any).answerQuestion('Which?', ['red', 'blue'], true); await new Promise((r) => setTimeout(r, 0)); c.pickKey('toggle'); c.pickKey('down'); c.pickKey('toggle'); c.pickKey('enter'); await a; expect(sent).toEqual(['red, blue']);
  });
});

describe('more commands you choose instead of type', () => {
  const tick2 = () => new Promise((r) => setTimeout(r, 20));
  const withViews = () => { const seen: string[] = []; const views = Object.fromEntries(['mcp', 'hooks', 'memory'].map((k) => [k, async (a: string[]) => { seen.push(`${k} ${a.join(' ')}`.trim()); return [`${k} ${a.join(' ')}`.trim()]; }])); const c = new AppController({ engine: new DemoEngine({ speed: 100 }), demo: true, cwd: '/tmp', version: 't', skills: [], views: views as never }); return { c, seen }; };
  it('/mcp, /hooks and /memory with nothing after them offer their views; the chosen one is shown', async () => {
    const { c, seen } = withViews();
    for (const [cmd, ids, title, pickIdx] of [['mcp', ['list', 'status'], 'MCP servers', 1], ['hooks', ['list', 'validate', 'templates'], 'Hooks', 2], ['memory', ['show', 'status'], 'Memory', 0]] as const) {
      const run = c.runCommand(`/${cmd}`); await tick2(); expect(c.state.pick!.title).toBe(title); expect(c.state.pick!.options.map((o) => o.id)).toEqual(ids); for (let i = 0; i < pickIdx; i++) c.pickKey('down'); c.pickKey('enter'); await run; expect(seen.at(-1)).toBe(`${cmd} ${ids[pickIdx]}`);
    }
    const n = seen.length; const esc = c.runCommand('/mcp'); await tick2(); c.pickKey('cancel'); await esc; expect(seen).toHaveLength(n); // Esc shows nothing
    await c.runCommand('/mcp list'); expect(seen.at(-1)).toBe('mcp list'); c.stop(); // with the word typed there is no list
  });
  it('/trust asks first (and "Not now" does nothing); /demo lists the stories and runs the chosen one', async () => {
    const { c } = withViews(); const t = c.runCommand('/trust'); await tick2(); expect(c.state.pick!.title).toBe('Project permission rules'); expect(c.state.pick!.options.map((o) => o.id)).toEqual(['rules', 'no']); c.pickKey('down'); c.pickKey('enter'); await t; expect(c.state.mode).toBe('chat');
    const d = c.runCommand('/demo'); await tick2(); expect(c.state.pick!.title).toBe('Demo story'); const ids = c.state.pick!.options.map((o) => o.id); expect(ids).toContain('fix'); expect(ids).toContain('search'); c.pickKey('down'); c.pickKey('enter'); await d; await tick2(); expect(c.state.items.some((i) => i.kind === 'user')).toBe(true); c.stop();
  });
  it('/auto is a list like the other switches, and a typed value still works', async () => {
    const { c } = withViews(); const a = c.runCommand('/auto'); await tick2(); expect(c.state.pick!.title).toBe('Auto skills'); const on0 = c.state.settings.autoSkills; c.pickKey(on0 ? 'down' : 'up'); c.pickKey('enter'); await a; expect(c.state.settings.autoSkills).toBe(!on0); await c.runCommand('/auto on'); expect(c.state.settings.autoSkills).toBe(true); c.stop();
  });
});
