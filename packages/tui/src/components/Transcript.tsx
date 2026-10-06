import React, { useMemo } from 'react';
import { Box } from 'ink';
import { Rich } from './ui.js';
import { buildLines } from '../util/transcript.js';
import { sp } from '../util/text.js';
import type { Item } from '../state/model.js';

/** Total wrapped line count, shared with App for scroll anchoring. */
export function useTranscriptLines(items: Item[], width: number) {
  return useMemo(() => buildLines(items, width), [items, width]);
}

export function Transcript({ lines, width, height, scroll }: { lines: ReturnType<typeof buildLines>; width: number; height: number; scroll: number }) {
  const total = lines.length;
  const maxScroll = Math.max(0, total - height);
  const off = Math.min(scroll, maxScroll);
  const end = total - off; const start = Math.max(0, end - height);
  const view = lines.slice(start, end);
  const pad = height - view.length;
  const rows = [...Array.from({ length: Math.max(0, pad) }, () => []), ...view];
  if (off > 0) rows[rows.length - 1] = [sp(`  ↓ ${off} more line${off === 1 ? '' : 's'} below · PageDown or End`, { c: 'status.info', b: true })];
  return (
    <Box flexDirection="column" width={width} height={height} overflow="hidden">
      {rows.map((l, i) => <Rich key={i} line={l} />)}
    </Box>
  );
}
