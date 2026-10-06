/** Transcript items -> styled, wrapped Lines. Pure: the viewport just slices the result. */
import type { Item } from '../state/model.js';
import { renderMarkdown } from './markdown.js';
import { renderDiff, parseDiff, diffStats } from './diff.js';
import { formatElapsed, sp, truncate, truncateMiddle, wrapLine, type Line } from './text.js';

const IND = '  ';

function userLines(text: string, width: number): Line[] {
  const head: Line = [sp('● ', { c: 'signal' }), sp('you  ', { c: 'accent.hover', b: true })];
  const body = wrapLine([sp(text, { c: 'text.primary' })], width - 8);
  return body.map((l, i) => (i === 0 ? [...head, ...l] : [sp('        '), ...l]));
}

function assistantLines(text: string, width: number, done: boolean): Line[] {
  const md = renderMarkdown(text, { width: width - 2 });
  const out = md.map((l) => (l.length ? [sp(IND), ...l] : l));
  if (!done) { const last = out[out.length - 1]; if (last) last.push(sp('▍', { c: 'signal' })); else out.push([sp(IND), sp('▍', { c: 'signal' })]); }
  return out;
}

function toolLines(it: Extract<Item, { kind: 'tool' }>, width: number): Line[] {
  const out: Line[] = [];
  const arg = it.path ? truncateMiddle(it.path.replace(/^\/work\//, ''), width - it.name.length - 12) : truncate(it.command ?? it.summary, width - it.name.length - 12);
  const head: Line = [sp(it.status === 'running' && !it.approval ? '● ' : '● ', { c: it.status === 'error' || it.status === 'denied' ? 'status.danger' : 'signal' }), sp(it.name, { b: true, c: 'text.primary' }), sp('(', { c: 'text.muted' }), sp(arg, { c: it.path ? 'text.link' : 'text.secondary' }), sp(')', { c: 'text.muted' })];
  if (it.risk === 'high') head.push(sp('  ⚠ high risk', { c: 'status.danger', b: true }));
  out.push(head);
  if (it.approval === 'pending') out.push([sp(IND + '? ', { c: 'status.warning', b: true }), sp('waiting for your approval', { c: 'status.warning' })]);
  if (it.status === 'running' && !it.approval) { /* the live strip shows progress */ }
  const result = it.result?.split('\n').filter(Boolean) ?? [];
  if (it.status === 'denied') out.push([sp(IND + '└ ', { c: 'text.muted' }), sp(result[0] ?? 'declined', { c: 'status.warning' })]);
  else if (result.length) {
    const colour = it.status === 'error' ? 'status.danger' : 'text.muted';
    const stats = it.diff && it.status === 'ok' ? diffStats(parseDiff(it.diff)) : undefined; // a declined change never happened: no +/- counts
    result.slice(0, 4).forEach((r, i) => out.push([sp(i === 0 ? IND + '└ ' : IND + '  ', { c: 'text.muted' }), sp(truncate(r, width - 6), { c: colour }), ...(i === 0 && stats ? [sp(`  +${stats.add} -${stats.del}`, { c: 'text.muted' })] : [])]));
  }
  if (it.diff && (it.status === 'ok' || it.approval === 'approved')) for (const l of renderDiff(it.diff, width - 4, 12)) out.push([sp(IND + '  '), ...l]);
  return out;
}

export function itemLines(it: Item, width: number, now = Date.now()): Line[] {
  switch (it.kind) {
    case 'user': return userLines(it.text, width);
    case 'assistant': return assistantLines(it.text, width, it.done);
    case 'thinking': {
      if (it.done) return [[sp('∴ ', { c: 'text.muted' }), sp(`thought for ${formatElapsed(Math.max(1000, it.ms))}`, { c: 'text.muted', i: true })]];
      const tail = it.text.replace(/\s+/g, ' ').trim().slice(-Math.max(10, width - 14));
      return [[sp('∴ ', { c: 'text.muted' }), sp('thinking  ', { c: 'text.muted', i: true }), sp(tail, { c: 'text.muted', d: true, i: true })]];
    }
    case 'tool': return toolLines(it, width);
    case 'notice': {
      const colour = it.level === 'error' ? 'status.danger' : it.level === 'warn' ? 'status.warning' : it.level === 'ok' ? 'status.success' : 'status.info';
      const mark = it.level === 'error' ? '✗' : it.level === 'warn' ? '!' : it.level === 'ok' ? '✓' : 'i';
      const out: Line[] = wrapLine([sp(mark + ' ', { c: colour, b: true }), sp(it.text, { c: colour, b: it.level === 'error' })], width - 2, [sp('  ')]);
      if (it.detail) for (const l of wrapLine([sp(it.detail, { c: 'text.secondary' })], width - 4)) out.push([sp('    '), ...l]);
      void now; return out;
    }
  }
}

/** All lines of the conversation with the right spacing between item groups. */
export function buildLines(items: Item[], width: number, now = Date.now()): Line[] {
  const out: Line[] = [];
  let prev: Item['kind'] | undefined;
  for (const it of items) {
    const grouped = (prev === 'tool' && (it.kind === 'tool' || it.kind === 'thinking')) || (prev === 'thinking' && (it.kind === 'tool' || it.kind === 'assistant'));
    if (prev && !grouped) out.push([]);
    out.push(...itemLines(it, width, now)); prev = it.kind;
  }
  return out;
}
