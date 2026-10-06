import React from 'react';
import { Box } from 'ink';
import { Rich } from '../components/ui.js';
import { sp } from '../util/text.js';
import { truncate, visibleTasks, type TaskItem } from './model.js';

const GLYPH = { unicode: { pending: '○', in_progress: '◐', completed: '✓' }, ascii: { pending: '[ ]', in_progress: '[~]', completed: '[x]' } } as const;
/** An agent's plan. Status is shown by glyph and weight, never by colour alone. The item in progress is always visible. */
export function TaskList({ items, maxRows = 10, width, title = 'Tasks', unicode = true }: { items: TaskItem[]; maxRows?: number; width: number; title?: string; unicode?: boolean }) {
  const done = items.filter((t) => t.status === 'completed').length; const { shown, hidden } = visibleTasks(items, maxRows); const g = unicode ? GLYPH.unicode : GLYPH.ascii; const gw = unicode ? 2 : 4;
  return (
    <Box flexDirection="column">
      <Rich line={[sp(title, { c: 'text.secondary', b: true }), sp(` ${done}/${items.length}`, { c: 'text.muted' })]} />
      {shown.map((t) => { const st = g[t.status] ?? g.pending; const text = truncate(t.text, width - gw - 1); return <Rich key={t.id} line={[sp(`${st} `, { c: t.status === 'completed' ? 'text.muted' : t.status === 'in_progress' ? 'signal' : 'text.secondary' }), sp(text, { c: t.status === 'completed' ? 'text.muted' : t.status === 'in_progress' ? 'text.primary' : 'text.secondary', b: t.status === 'in_progress', d: t.status === 'completed' })]} />; })}
      {hidden > 0 ? <Rich line={[sp(`${unicode ? '⋯' : '...'} +${hidden} more`, { c: 'text.muted' })]} /> : null}
    </Box>
  );
}
