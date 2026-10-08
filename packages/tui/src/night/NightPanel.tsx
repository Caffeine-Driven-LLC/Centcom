import React from 'react';
import { Box } from 'ink';
import { Rich, useCol } from '../components/ui.js';
import { sp, truncate, type Line } from '../util/text.js';
import { counts, durationText, type NightState, type NightStatus } from './model.js';

const ICON: Record<NightStatus, [string, 'text.muted' | 'signal' | 'status.success' | 'status.danger' | 'status.warning']> = { queued: ['○', 'text.muted'], running: ['●', 'signal'], done: ['✓', 'status.success'], failed: ['✗', 'status.danger'], timeout: ['!', 'status.warning'] };
const ASCII: Record<NightStatus, string> = { queued: 'o', running: '*', done: '+', failed: 'x', timeout: '!' };

/** The panel's rows as data (testable without a terminal). */
export function nightRows(n: NightState, o: { width: number; height: number; now: number; unicode?: boolean; mode?: string }): Line[] {
  const c = counts(n); const rows: Line[] = []; const inner = Math.max(20, o.width - 6); const uni = o.unicode !== false;
  const head: Line = [sp(uni ? '◐ ' : '', { c: 'accent.hover', b: true }), sp('Night cycle', { c: 'accent.hover', b: true }), sp(n.running ? '   running' : n.stopped ? `   stopped: ${n.stopped}` : n.endedAt ? '   finished' : '   ready', { c: n.running ? 'signal' : n.stopped ? 'status.warning' : 'text.muted' })];
  rows.push(head);
  rows.push([sp(truncate(c.total ? `${c.done} done · ${c.failed} failed · ${c.queued + c.running} to go${n.startedAt !== undefined ? ` · ${durationText((n.endedAt ?? o.now) - n.startedAt)} so far` : ''}` : 'Write what you want done tonight. One task per line, or paste a list.', inner), { c: 'text.secondary' })]);
  rows.push([]);
  const room = Math.max(3, o.height - 11); const list = n.tasks; const runIdx = Math.max(0, list.findIndex((t) => t.status === 'running'));
  const start = list.length <= room ? 0 : Math.max(0, Math.min(list.length - room, runIdx - Math.floor(room / 2))); const shown = list.slice(start, start + room);
  if (start > 0) rows.push([sp(`  ↑ ${start} earlier`, { c: 'text.muted' })]);
  shown.forEach((t, i) => {
    const [ic, col] = ICON[t.status]; const idx = start + i + 1; const dur = t.startedAt ? durationText((t.endedAt ?? o.now) - t.startedAt) : '';
    const tail = t.status === 'running' ? `  ${dur}` : t.status === 'queued' ? '' : `  ${dur}${t.denied ? ` · ${t.denied} refused` : ''}`;
    rows.push([sp(String(idx).padStart(3) + ' ', { c: 'text.muted' }), sp((uni ? ic : ASCII[t.status]) + ' ', { c: col, b: t.status === 'running' }), sp(truncate(t.text.split('\n')[0]!, inner - tail.length - 6), { c: t.status === 'queued' ? 'text.primary' : t.status === 'running' ? 'text.primary' : 'text.secondary', b: t.status === 'running' }), sp(tail, { c: 'text.muted' })]);
  });
  if (start + shown.length < list.length) rows.push([sp(`  ↓ ${list.length - start - shown.length} more`, { c: 'text.muted' })]);
  if (!list.length) rows.push([sp('  The queue is empty.', { c: 'text.muted' })]);
  rows.push([]);
  rows.push([sp(truncate('While it runs, nobody is asked anything. Questions are answered "decide yourself"; high-risk actions, publishes and deploys are refused. Each task gets ' + n.taskTimeoutMin + ' min.', inner), { c: 'text.muted' })]);
  rows.push([sp(truncate(n.allowPush ? 'Pushing work branches and opening pull requests is allowed (never main, never force, never merge). /night allow none to turn off.' : 'Nothing is pushed. /night allow push lets it push work branches and open pull requests.', inner), { c: n.allowPush ? 'status.warning' : 'text.muted' })]);
  rows.push([sp(truncate(n.running ? 'esc hide this panel (the night keeps going) · /night stop to stop · ctrl+n back here' : 'enter add task · enter on an empty line start the night · esc close · /night timeout <min>', inner), { c: 'text.muted' })]);
  if (n.reportPath) rows.push([sp(truncate('Report: ' + n.reportPath, inner), { c: 'status.success' })]);
  return rows;
}
export function NightPanel({ n, width, height, unicode = true }: { n: NightState; width: number; height: number; unicode?: boolean }) {
  const col = useCol(); const rows = nightRows(n, { width, height, now: Date.now(), unicode }); const w = Math.min(100, width - 2);
  return <Box width={width} justifyContent="center"><Box flexDirection="column" width={w} borderStyle="round" borderColor={col('accent.primary')} paddingX={2}>{rows.map((r, i) => <Rich key={i} line={r} />)}</Box></Box>;
}
