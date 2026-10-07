import React, { useMemo, useState } from 'react';
import { Box, useInput } from 'ink';
import { Rich } from '../components/ui.js';
import type { DiffFile } from './model.js';
import { renderDiffRows } from './rows.js';

/** Files as a unified diff: numbered lines, word highlights, folded gaps. With `focusable`, up/down pick a folded gap and enter opens it in place. */
export function DiffView({ files, width, maxRows, focusable = false, expanded: given, onToggle }: { files: DiffFile[]; width: number; maxRows?: number; focusable?: boolean; expanded?: ReadonlySet<string>; onToggle?: (gapId: string) => void }) {
  const [own, setOwn] = useState<Set<string>>(new Set()); const [focus, setFocus] = useState(0); const expanded = given ?? own;
  const rows = useMemo(() => renderDiffRows(files, { width, expanded }), [files, width, expanded]); const gaps = rows.filter((r) => r.meta.kind === 'gap');
  useInput((_i, key) => { if (!focusable || !gaps.length) return; if (key.downArrow) setFocus((f) => (f + 1) % gaps.length); else if (key.upArrow) setFocus((f) => (f + gaps.length - 1) % gaps.length); else if (key.return) { const id = gaps[Math.min(focus, gaps.length - 1)]!.meta.gapId!; if (onToggle) onToggle(id); else setOwn((s) => new Set(s).add(id)); } }, { isActive: focusable });
  const shown = maxRows ? rows.slice(0, maxRows) : rows; const hidden = rows.length - shown.length;
  return <Box flexDirection="column" width={width}>{shown.map((r, i) => <Rich key={i} line={r.line} />)}{hidden > 0 && <Rich line={[{ t: `⋯ ${hidden} more rows`, c: 'text.muted' }]} />}</Box>;
}
