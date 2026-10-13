import React from 'react';
import { Box } from 'ink';
import { ToastView } from '../toast/ToastLine.js';
import type { Toast } from '../state/model.js';

/** The notice above the prompt: the one that is showing, with how many wait behind it. */
export function Toasts({ toasts, showing, width, unicode = true }: { toasts: Toast[]; showing?: string; width: number; unicode?: boolean }) {
  const first = toasts.find((t) => t.id === showing) ?? toasts[0]; if (!first) return null;
  const more = toasts.length - 1;
  return <Box width={width} justifyContent="flex-end"><ToastView toast={more > 0 ? { ...first, text: `${first.text}  (+${more} more)` } : first} width={Math.min(width, 100)} unicode={unicode} /></Box>;
}
