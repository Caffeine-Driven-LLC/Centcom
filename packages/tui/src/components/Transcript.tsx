import React, { useMemo, useRef } from 'react';
import { Box } from 'ink';
import { Rich } from './ui.js';
import { buildLines } from '../util/transcript.js';
import { sp } from '../util/text.js';
import type { Item } from '../state/model.js';
import { TranscriptLayout } from '../transcript/layout.js';

/** Full line list (kept for print and tests); the app itself uses `useTranscriptLayout`. */
export function useTranscriptLines(items: Item[], width: number) { return useMemo(() => buildLines(items, width), [items, width]); }
/** One layout per component, updated when items or width change: unchanged blocks are not measured again. */
export function useTranscriptLayout(items: Item[], width: number): TranscriptLayout {
  const ref = useRef<TranscriptLayout | undefined>(undefined); ref.current ??= new TranscriptLayout(); const l = ref.current;
  return useMemo(() => l.update(items, width), [items, width, l]);
}
/** Only the rows on screen are built. `scroll` counts rows up from the bottom; `unseen` is how many messages arrived while scrolled up. */
export function Transcript({ layout, width, height, scroll, unseen = 0 }: { layout: TranscriptLayout; width: number; height: number; scroll: number; unseen?: number }) {
  const total = layout.total; const off = Math.min(scroll, Math.max(0, total - height));
  const end = total - off; const start = Math.max(0, end - height); const view = layout.slice(start, end);
  const rows = [...Array.from({ length: Math.max(0, height - view.length) }, () => []), ...view];
  if (off > 0) rows[rows.length - 1] = [sp(`  ↓ ${unseen > 0 ? `${unseen} new` : `${off} more line${off === 1 ? '' : 's'} below`} · ctrl+end or End`, { c: 'status.info', b: true })];
  return <Box flexDirection="column" width={width} height={height} overflow="hidden">{rows.map((l, i) => <Rich key={i} line={l} />)}</Box>;
}
