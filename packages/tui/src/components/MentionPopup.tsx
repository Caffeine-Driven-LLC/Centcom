import React from 'react';
import { Box } from 'ink';
import { Rich } from './ui.js';
import { Clickable } from '../click.js';
import { sp, truncateMiddle, type Line } from '../util/text.js';

/** The files suggested for the `@word` being typed: the name in full on the left, the folder dimmed after it. */
export function MentionPopup({ items, sel, width, onPick }: { items: string[]; sel: number; width: number; onPick?: (path: string) => void }) {
  return (
    <Box flexDirection="column" width={width} paddingX={1}>
      {items.map((p, i): React.ReactNode => {
        const on = i === sel % Math.max(1, items.length); const cut = p.lastIndexOf('/'); const name = p.slice(cut + 1); const dir = cut >= 0 ? p.slice(0, cut + 1) : '';
        const line: Line = [sp(on ? '▸ ' : '  ', { c: 'accent.hover', b: true }), sp('@', { c: 'text.muted', bg: on ? 'bg.selected' : undefined }), sp(name, { c: on ? 'text.primary' : 'text.secondary', b: on, bg: on ? 'bg.selected' : undefined }), ...(dir ? [sp('  ' + truncateMiddle(dir, Math.max(8, width - name.length - 12)), { c: 'text.muted' })] : [])];
        return <Clickable key={p} onClick={() => onPick?.(p)}><Rich line={line} /></Clickable>;
      })}
    </Box>
  );
}
