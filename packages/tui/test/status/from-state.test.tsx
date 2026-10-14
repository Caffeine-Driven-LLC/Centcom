import React from 'react';
import { PassThrough } from 'node:stream';
import { render } from 'ink';
import { afterEach, describe, expect, it } from 'vitest';
import { DemoEngine } from '@centcom/agent';
import { App, AppController } from '../../src/index.js';
import { layoutStatus, renderStatus, statusFieldsFor, STATUS_DROP_ORDER, EXTRA_DROP_ORDER, type StatusFields } from '../../src/status/index.js';
import { textWidth } from '../../src/util/text.js';

const strip = (s: string) => s.replace(/\x1b\[[0-9;?]*[A-Za-z]/g, '');
const mk = () => new AppController({ engine: new DemoEngine({ speed: 100 }), demo: true, cwd: '/tmp', branch: 'main', version: 't', skills: [] });
const line = (f: StatusFields, w: number, kind: 'header' | 'footer') => renderStatus(layoutStatus(f, w, undefined, kind), w);

describe('statusFieldsFor: the app state through the status module (C039)', () => {
  it('the header names the folder, the branch, the engine, the agents and (once there is one) the cost', () => {
    const c = mk(); const f = statusFieldsFor(c.state, { home: '/home/x' }); expect(f).toMatchObject({ cwd: '/tmp', branch: 'main', agents: 1, showCost: true });
    const h = line(f, 120, 'header'); expect(h).toContain('cento · /tmp · main'); expect(h).toContain('1 agent'); expect(h).not.toContain('$');
    c.patch({ agents: c.state.agents.map((a) => ({ ...a, cost: 0.42 })) }); expect(line(statusFieldsFor(c.state), 120, 'header')).toContain('$0.42'); c.stop();
  });
  it('status.showCost (ui.show_cost) off hides the cost and keeps everything else', () => {
    const c = mk(); c.patch({ agents: c.state.agents.map((a) => ({ ...a, cost: 1.5 })), settings: { ...c.state.settings, showCost: false } });
    const h = line(statusFieldsFor(c.state), 120, 'header'); expect(h).not.toContain('$'); expect(h).toContain('cento · /tmp'); c.stop();
  });
  it('the footer carries the mode, the state, who needs you, the context gauge, the limits and the tokens', () => {
    const c = mk(); const me = c.state.agents[0]!;
    c.patch({ busy: true, agents: [{ ...me, state: 'editing-file', ctxPct: 42, ctxTokens: 84_000, ctxWindow: 200_000, inTok: 1200, outTok: 3400 }], limits: [{ name: 'five_hour', utilization: 0.93, resets_at: Date.now() / 1000 + 3600 }], settings: { ...c.state.settings, permissionMode: 'acceptEdits' } });
    const f = line(statusFieldsFor(c.state), 200, 'footer'); expect(f).toContain('⏵⏵ accept edits on'); expect(f).toContain('editing file'); expect(f).toContain('context ██░░░ 42% 84k/200k'); expect(f).toMatch(/session █████ 93% ↻ /); expect(f).toContain('↑1.2k ↓3.4k'); expect(f).toContain('? help'); c.stop();
  });
  it('no permission prompt answered, a bad link and bypass mode are all said in words', () => {
    const c = mk(); c.patch({ net: 'reconnecting', settings: { ...c.state.settings, permissionMode: 'bypassPermissions' } });
    expect(line(statusFieldsFor(c.state), 120, 'header')).toContain('↻ reconnecting'); expect(line(statusFieldsFor(c.state), 120, 'footer')).toContain('⚠ NO APPROVALS');
    c.patch({ net: 'backend-down' }); expect(line(statusFieldsFor(c.state), 120, 'header')).toContain('✗ service down'); c.patch({ net: 'degraded' }); expect(line(statusFieldsFor(c.state), 120, 'header')).toContain('! service slow'); c.stop();
  });
  it('a narrow footer drops the extras before the mode, and no line is wider than the terminal', () => {
    const c = mk(); c.patch({ busy: true, agents: [{ ...c.state.agents[0]!, state: 'thinking', ctxPct: 80, inTok: 5, outTok: 5 }], limits: [{ name: 'seven_day', utilization: 0.5, resets_at: 0 }] });
    const f = statusFieldsFor(c.state); expect(EXTRA_DROP_ORDER).toContain('tokens'); expect(STATUS_DROP_ORDER).toEqual(['hints', 'cost', 'online', 'agents', 'branch', 'mode']);
    for (const w of [20, 30, 40, 60, 80, 120]) { expect(textWidth(line(f, w, 'footer'))).toBeLessThanOrEqual(w); expect(textWidth(line(f, w, 'header'))).toBeLessThanOrEqual(w); }
    expect(layoutStatus(f, 45, undefined, 'footer').map((s) => s.field)).toContain('mode'); c.stop();
  });
});

let cleanup: (() => void) | undefined; afterEach(() => { cleanup?.(); cleanup = undefined; });
async function mount(cols: number, rows: number, tier: 'none' | 'truecolor' = 'none') {
  const ctl = mk(); const out: any = new PassThrough(); out.columns = cols; out.rows = rows; out.isTTY = true; let frame = ''; out.on('data', (d: Buffer) => { frame = d.toString(); });
  const inp: any = new PassThrough(); inp.isTTY = true; inp.setRawMode = () => inp; inp.ref = () => inp; inp.unref = () => inp;
  const inst = render(<App ctl={ctl} tier={tier} />, { stdout: out, stdin: inp, exitOnCtrlC: false, patchConsole: false, debug: true });
  cleanup = () => { inst.unmount(); ctl.stop(); }; await new Promise((r) => setTimeout(r, 60));
  return { ctl, screen: () => strip(frame), settle: () => new Promise((r) => setTimeout(r, 80)) };
}
describe('the app is drawn by the shell (C034)', () => {
  it('has the header on the first row, the footer on the last, and one row left under the window height', async () => {
    const t = await mount(100, 30); const rows = t.screen().split('\n'); expect(rows[0]).toContain('cento · /tmp'); expect(rows.some((r) => r.includes('? help'))).toBe(true); expect(rows.length).toBeLessThanOrEqual(30);
    expect(rows.findIndex((r) => r.includes('? help'))).toBeGreaterThan(rows.findIndex((r) => r.includes('cento · /tmp')));
  });
  it('shows the rail with a mini Cento per agent from 100 columns when there is more than one, and not below', async () => {
    const t = await mount(100, 32); const me = t.ctl.state.agents[0]!;
    t.ctl.patch({ agents: [me, { ...me, id: 'bob', name: 'bob', mine: false, state: 'editing-file', busy: true, branch: 'feat' }] }); await t.settle();
    const s = t.screen(); expect(s).toContain('bob'); expect(s).toContain('● editing'); expect(s).toContain('│'); cleanup!();
    const narrow = await mount(99, 32); const m2 = narrow.ctl.state.agents[0]!; narrow.ctl.patch({ agents: [m2, { ...m2, id: 'bob', name: 'bob', mine: false }] }); await narrow.settle(); expect(narrow.screen()).not.toContain('bob');
  });
  it('draws Cento with the component: at no colour the text face, in colour half blocks', async () => {
    const plain = await mount(100, 40); plain.ctl.patch({ items: [{ kind: 'user', id: 'u', text: 'hi', ts: 0 }] as never[] }); await plain.settle(); expect(plain.screen()).toMatch(/\(o_o\)/); cleanup!();
    const color = await mount(100, 40, 'truecolor'); color.ctl.patch({ items: [{ kind: 'user', id: 'u', text: 'hi', ts: 0 }] as never[] }); await color.settle(); expect(color.screen()).toMatch(/[▀▄█]/);
  });
});
