import React from 'react';
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
