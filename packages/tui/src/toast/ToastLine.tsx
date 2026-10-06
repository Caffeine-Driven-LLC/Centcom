import React, { useEffect, useState } from 'react';
import { Box } from 'ink';
import { Rich } from '../components/ui.js';
import { sp, truncate, type Colour } from '../util/text.js';
import { toastText, type Toast, type ToastController, type ToastLevel } from './controller.js';

const GLYPH: Record<ToastLevel, { u: string; a: string; c: Colour }> = { success: { u: '✓', a: '+', c: 'status.success' }, warn: { u: '!', a: '!', c: 'status.warning' }, error: { u: '✗', a: 'x', c: 'status.danger' }, info: { u: 'i', a: 'i', c: 'status.info' } };

/** One row: glyph, text (cut with …, never wrapped), and the keys of its actions. The glyph carries the level when there is no colour. */
export function ToastView({ toast, width, unicode = true }: { toast: Toast | null; width: number; unicode?: boolean }) {
  if (!toast) return null;
  const g = GLYPH[toast.level]; const hint = (toast.actions ?? []).map((a) => `[${a.key}] ${a.label}`).join(' '); const room = Math.max(4, width - 4 - (hint ? hint.length + 2 : 0));
  return <Box width={width}><Rich line={[sp(` ${unicode ? g.u : g.a} `, { c: 'bg.base', bg: g.c, b: true }), sp(' ' + truncate(toastText(toast), room) + ' ', { c: 'text.primary', bg: 'bg.overlay' }), ...(hint ? [sp(' ' + hint, { c: 'text.muted' })] : [])]} /></Box>;
}
/** The line above the prompt, following a controller. */
export function ToastLine({ controller, width, unicode }: { controller: ToastController; width: number; unicode?: boolean }) {
  const [t, setT] = useState<Toast | null>(controller.current());
  useEffect(() => controller.subscribe((x) => setT(x ? { ...x } : null)), [controller]);
  return <ToastView toast={t} width={width} unicode={unicode} />;
}
