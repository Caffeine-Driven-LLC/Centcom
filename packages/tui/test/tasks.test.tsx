import React from 'react';
import { Writable } from 'node:stream';
import { render, renderToString } from 'ink';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createAgentBus, CodexMapper, todosFrom } from '@centcom/agent';
import { ProgressBar, TaskList, barLine, indeterminateFrame, progressOf, reduceTasks, renderBar, visibleTasks, type TaskItem } from '../src/index.js';

const strip = (s: string) => s.replace(/\x1b\[[0-9;]*m/g, '');
const tasks = (n: number, ip?: number): TaskItem[] => Array.from({ length: n }, (_, i) => ({ id: String(i + 1), text: `task ${i + 1}`, status: i === ip ? 'in_progress' : i < (ip ?? 0) ? 'completed' : 'pending' }));
describe('bar (acceptance 1, 7)', () => {
  it('rounds to whole cells and labels with the percent', () => { expect(renderBar(0.62, 12)).toBe('███████░░░░░'); expect(barLine(0.62, 12)).toBe('▕███████░░░░░▏ 62 %'); expect(barLine(0, 12)).toBe('▕░░░░░░░░░░░░▏ 0 %'); expect(barLine(1, 12)).toBe('▕████████████▏ 100 %'); });
  it('clamps values outside 0..1 and NaN', () => { expect(renderBar(-3, 10)).toBe('░'.repeat(10)); expect(renderBar(7, 10)).toBe('█'.repeat(10)); expect(renderBar(NaN, 4)).toBe('░░░░'); });
  it('ASCII form (acceptance 5)', () => { expect(barLine(0.62, 14, false)).toBe('[#########-----] 62 %'); expect(barLine(10 / 14, 14, false)).toBe('[##########----] 71 %'); });
});
describe('indeterminate (acceptance 2)', () => {
  it('the block moves one cell per tick, bounces at both ends, and the width never changes', () => { const frames = Array.from({ length: 10 }, (_, t) => indeterminateFrame(t, 12, 6)); for (const f of frames) expect([...f].length).toBe(12); const pos = frames.map((f) => f.indexOf('▓')); expect(pos).toEqual([0, 1, 2, 3, 4, 5, 6, 5, 4, 3]); });
});
describe('task list (acceptance 3, 4, 6)', () => {
  it('12 tasks, 10 rows, task 11 in progress: it is shown and the footer counts what is hidden', () => { const { shown, hidden } = visibleTasks(tasks(12, 10), 10); expect(shown.map((t) => t.id)).toContain('11'); expect(hidden).toBe(2); const out = strip(renderToString(<TaskList items={tasks(12, 10)} maxRows={10} width={60} />, { columns: 60 })).split('\n').filter(Boolean); expect(out.length).toBeLessThanOrEqual(12); expect(out[0]).toContain('Tasks 10/12'); expect(out.at(-1)).toBe('⋯ +2 more'); expect(out.some((l) => l.includes('◐ task 11'))).toBe(true); });
  it('long text is cut with … and never wraps', () => { const out = strip(renderToString(<TaskList items={[{ id: '1', text: 'x'.repeat(200), status: 'pending' }]} width={30} />, { columns: 30 })).split('\n').filter(Boolean); expect(out).toHaveLength(2); expect(out[1]!.endsWith('…')).toBe(true); expect(out[1]!.length).toBeLessThanOrEqual(30); });
  it('glyphs by status, ASCII without unicode, unknown status is pending', () => { const items = reduceTasks({ items: [] }, { tasks: [{ id: 'a', text: 'one', status: 'completed' }, { id: 'b', text: 'two', status: 'in_progress' }, { id: 'c', text: 'three', status: 'blocked' }] }).items; expect(items.map((i) => i.status)).toEqual(['completed', 'in_progress', 'pending']); const u = strip(renderToString(<TaskList items={items} width={40} />, { columns: 40 })); expect(u).toContain('✓ one'); expect(u).toContain('◐ two'); expect(u).toContain('○ three'); const a = strip(renderToString(<TaskList items={items} width={40} unicode={false} />, { columns: 40 })); expect(a).toContain('[x] one'); expect(a).toContain('[~] two'); expect(a).toContain('[ ] three'); });
});
describe('reducer', () => {
  it('replaces the whole list, keeps order, last wins for a repeated id, at most 200, text cleaned', () => { const r = reduceTasks({ items: tasks(3) }, { tasks: [{ id: 'x', text: 'a\x1b[31mred\x1b[0m\nline', status: 'pending' }, { id: 'y', text: 'b', status: 'pending' }, { id: 'x', text: 'a2', status: 'completed' }] }); expect(r.items).toEqual([{ id: 'x', text: 'a2', status: 'completed' }, { id: 'y', text: 'b', status: 'pending' }]); expect(reduceTasks({ items: [] }, { tasks: Array.from({ length: 300 }, (_, i) => ({ id: String(i), text: 't', status: 'pending' })) }).items).toHaveLength(200); expect(reduceTasks({ items: [] }, { tasks: [{ id: '1', text: 'ok\u0007bell', status: 'pending' }] }).items[0]!.text).toBe('ok bell'); expect(reduceTasks({ items: [] }, null as never).items).toEqual([]); });
});
describe('progress bar component', () => {
  afterEach(() => { vi.useRealTimers(); });
  it('renders a label, the bar and the percent; reduced motion is static with …', () => { const d = strip(renderToString(<ProgressBar value={0.5} label="Indexing" width={50} />, { columns: 50 })); expect(d).toMatch(/^Indexing ▕█+░+▏ 50 %/); const r = strip(renderToString(<ProgressBar label="Waiting" width={40} motion="reduced" />, { columns: 40 })); expect(r).toMatch(/^Waiting… ▕░+▏/); });
  it('unmounting clears the 80 ms timer (acceptance 8)', async () => { vi.useFakeTimers(); const out = new Writable({ write(_c, _e, cb) { cb(); } }) as unknown as NodeJS.WriteStream; (out as { columns: number }).columns = 60; const inst = render(<ProgressBar label="Working" width={60} />, { stdout: out, patchConsole: false, debug: true }); vi.advanceTimersByTime(400); expect(vi.getTimerCount()).toBeGreaterThan(0); inst.unmount(); await vi.runOnlyPendingTimersAsync(); expect(vi.getTimerCount()).toBe(0); });
  it('useProgress maths: total 0 is indeterminate, values are clamped', () => { expect(progressOf({ value: 3, total: 4, label: 'x' })).toEqual({ value: 0.75, label: 'x' }); expect(progressOf({ value: 3, total: 0, label: 'x' })).toEqual({ label: 'x' }); expect(progressOf({ value: 9, label: 'x' })).toEqual({ value: 1, label: 'x' }); void createAgentBus; });
});
describe('engines send the plan', () => {
  it('Claude TodoWrite becomes tasks.updated', () => { expect(todosFrom({ todos: [{ content: 'Read the code', status: 'completed' }, { content: 'Fix it', status: 'in_progress', activeForm: 'Fixing it' }, { content: 'Test', status: 'pending' }] })).toEqual({ type: 'tasks.updated', tasks: [{ id: '1', text: 'Read the code', status: 'completed' }, { id: '2', text: 'Fix it', status: 'in_progress' }, { id: '3', text: 'Test', status: 'pending' }] }); expect(todosFrom({})).toBeUndefined(); });
  it('Codex turn/plan/updated becomes tasks.updated', () => { const m = new CodexMapper(); expect(m.notification('turn/plan/updated', { plan: [{ step: 'look', status: 'completed' }, { step: 'change', status: 'inProgress' }] })).toEqual([{ type: 'tasks.updated', tasks: [{ id: '1', text: 'look', status: 'completed' }, { id: '2', text: 'change', status: 'in_progress' }] }]); });
});
