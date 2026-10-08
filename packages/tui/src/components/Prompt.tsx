import React from 'react';
import { Box, Text } from 'ink';
import { Rich, useCol } from './ui.js';
import { Clickable } from '../click.js';
import { layoutInput, selRange } from '../util/editor.js';
import { COMMANDS, type SlashCommand } from '../state/commands.js';
import { sp, truncate, type Line } from '../util/text.js';

export const MAX_INPUT_ROWS = 6;

/** What people reach for first comes first when the list is just opened. */
const FIRST = ['model', 'effort', 'mode', 'resume', 'new', 'night', 'fleet', 'skills', 'compact', 'usage', 'help'];
const rank = (name: string) => { const i = FIRST.indexOf(name); return i < 0 ? FIRST.length : i; };
/** Long argument syntax stays out of the popup; `/help` and the palette still show it. */
export const argHint = (args?: string) => (!args ? '' : args.length <= 18 ? ' ' + args : ' …');
export function slashMatches(text: string): SlashCommand[] {
  if (!text.startsWith('/') || text.includes(' ') || text.includes('\n')) return [];
  const q = text.slice(1).toLowerCase();
  if (!q) return [...COMMANDS].sort((a, b) => rank(a.name) - rank(b.name));
  return COMMANDS.filter((c) => c.name.startsWith(q)).concat(COMMANDS.filter((c) => !c.name.startsWith(q) && c.name.includes(q)));
}

export function promptRows(text: string, cursor: number, width: number, max = MAX_INPUT_ROWS): number { return Math.min(max, layoutInput({ text, cursor }, width - 6).rows.length); }

/** One row with the selected part highlighted. */
function selectedRow(row: string, rowStart: number, [lo, hi]: [number, number], fg: string | undefined, bg: string | undefined) {
  const a = Math.max(0, lo - rowStart); const b = Math.min(row.length, hi - rowStart);
  if (b <= a) return <Text color={fg}>{row}</Text>;
  return <><Text color={fg}>{row.slice(0, a)}</Text><Text color={fg} backgroundColor={bg} inverse={!bg}>{row.slice(a, b)}</Text><Text color={fg}>{row.slice(b)}</Text></>;
}
export function Prompt({ text, cursor, anchor, maxRows = MAX_INPUT_ROWS, busy, width, active, placeholder }: { text: string; cursor: number; anchor?: number; maxRows?: number; busy: boolean; width: number; active: boolean; placeholder: string }) {
  const col = useCol();
  const inner = width - 6;
  const lay = layoutInput({ text, cursor }, inner);
  // keep the cursor row visible when the buffer is taller than the box
  const start = Math.max(0, Math.min(lay.row - maxRows + 1, lay.rows.length - maxRows));
  const rows = lay.rows.slice(start, start + maxRows); const sel = selRange(text, cursor, anchor);
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
            ) : sel && active ? (selectedRow(r, lay.starts[start + i]!, sel, col('text.primary'), col('bg.selected')))
            : isCursorRow && active ? (
              <><Text color={col('text.primary')}>{before}</Text><Text inverse>{at}</Text><Text color={col('text.primary')}>{after}</Text></>
            ) : <Text color={col('text.primary')}>{r}</Text>}
          </Text>
        );
      })}
    </Box>
  );
}

export function SlashPopup({ matches, sel, width, onPick }: { matches: SlashCommand[]; sel: number; width: number; onPick?: (c: SlashCommand) => void }) {
  const shown = matches.slice(0, 6);
  return (
    <Box flexDirection="column" width={width} paddingX={1}>
      {shown.map((c, i): React.ReactNode => {
        const on = i === sel % Math.max(1, shown.length);
        const line: Line = [sp(on ? '▸ ' : '  ', { c: 'accent.hover', b: true }), sp('/' + c.name, { c: on ? 'text.primary' : 'text.secondary', b: on, bg: on ? 'bg.selected' : undefined }), ...(c.args ? [sp(argHint(c.args), { c: 'text.muted', bg: on ? 'bg.selected' : undefined })] : []), sp('  ' + truncate(c.desc, Math.max(8, width - c.name.length - (c.args?.length ?? 0) - 10)), { c: 'text.muted' })];
        return <Clickable key={c.name} onClick={() => onPick?.(c)}><Rich line={line} /></Clickable>;
      })}
    </Box>
  );
}
