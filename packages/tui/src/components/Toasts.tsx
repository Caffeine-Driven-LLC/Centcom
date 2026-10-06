import React from 'react';
import { Box } from 'ink';
import { Rich } from './ui.js';
import { sp, truncate } from '../util/text.js';
import type { Toast } from '../state/model.js';

export function Toasts({ toasts, width }: { toasts: Toast[]; width: number }) {
  if (!toasts.length) return null;
  return (
    <Box flexDirection="column" alignItems="flex-end" width={width}>
      {toasts.map((t) => {
        const c = t.level === 'error' ? 'status.danger' : t.level === 'warn' ? 'status.warning' : t.level === 'ok' ? 'status.success' : 'status.info';
        const mark = t.level === 'error' ? '✗' : t.level === 'warn' ? '!' : t.level === 'ok' ? '✓' : 'i';
        return <Rich key={t.id} line={[sp(' ' + mark + ' ', { c: 'bg.base', bg: c, b: true }), sp(' ' + truncate(t.text, width - 8) + ' ', { c: 'text.primary', bg: 'bg.overlay' })]} />;
      })}
    </Box>
  );
}
