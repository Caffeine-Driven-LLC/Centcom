import React from 'react';
import { Box, Text } from 'ink';
import { Rich, useCol } from './ui.js';
import { layoutInput } from '../util/editor.js';
import { COMMANDS, type SlashCommand } from '../state/commands.js';
import { sp, truncate, type Line } from '../util/text.js';

export const MAX_INPUT_ROWS = 6;

export function slashMatches(text: string): SlashCommand[] {
  if (!text.startsWith('/') || text.includes(' ') || text.includes('\n')) return [];
  const q = text.slice(1).toLowerCase();
  return COMMANDS.filter((c) => c.name.startsWith(q)).concat(COMMANDS.filter((c) => !c.name.startsWith(q) && c.name.includes(q)));
}

export function promptRows(text: string, cursor: number, width: number): number { return Math.min(MAX_INPUT_ROWS, layoutInput({ text, cursor }, width - 6).rows.length); }

export function Prompt({ text, cursor, busy, width, active, placeholder }: { text: string; cursor: number; busy: boolean; width: number; active: boolean; placeholder: string }) {
  const col = useCol();
  const inner = width - 6;
  const lay = layoutInput({ text, cursor }, inner);
  // keep the cursor row visible when the buffer is taller than the box
  const start = Math.max(0, Math.min(lay.row - MAX_INPUT_ROWS + 1, lay.rows.length - MAX_INPUT_ROWS));
  const rows = lay.rows.slice(start, start + MAX_INPUT_ROWS);
  return (
    <Box flexDirection="column" borderStyle="round" borderColor={col(busy ? 'signal' : active ? 'border.strong' : 'border.default')} width={width} paddingX={1}>
      {rows.map((r, i) => {
        const isCursorRow = start + i === lay.row;
        const chars = [...r];
        const before = chars.slice(0, lay.col).join(''); const at = chars[lay.col] ?? ' '; const after = chars.slice(lay.col + 1).join('');
        const showPlaceholder = !text && i === 0;
        return (
          <Text key={i} wrap="truncate">
            <Text color={col(busy ? 'signal' : 'accent.hover')} bold>{start + i === 0 ? '❯ ' : '  '}</Text>
            {showPlaceholder ? (
              <>{active ? <Text inverse> </Text> : null}<Text color={col('text.muted')}>{truncate(placeholder, inner - 1)}</Text></>
            ) : isCursorRow && active ? (
              <><Text color={col('text.primary')}>{before}</Text><Text inverse>{at}</Text><Text color={col('text.primary')}>{after}</Text></>
            ) : <Text color={col('text.primary')}>{r}</Text>}
          </Text>
        );
      })}
    </Box>
  );
}

export function SlashPopup({ matches, sel, width }: { matches: SlashCommand[]; sel: number; width: number }) {
  const shown = matches.slice(0, 6);
  return (
    <Box flexDirection="column" width={width} paddingX={1}>
      {shown.map((c, i): React.ReactNode => {
        const on = i === sel % Math.max(1, shown.length);
        const line: Line = [sp(on ? '▸ ' : '  ', { c: 'accent.hover', b: true }), sp('/' + c.name, { c: on ? 'text.primary' : 'text.secondary', b: on, bg: on ? 'bg.selected' : undefined }), ...(c.args ? [sp(' ' + c.args, { c: 'text.muted', bg: on ? 'bg.selected' : undefined })] : []), sp('  ' + truncate(c.desc, Math.max(8, width - c.name.length - (c.args?.length ?? 0) - 10)), { c: 'text.muted' })];
        return <Rich key={c.name} line={line} />;
      })}
    </Box>
  );
}
