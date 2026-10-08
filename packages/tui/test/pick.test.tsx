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
