import type { SlashCommand } from '@centcom/tui-commands';

/** Commands that only make sense in a terminal (the mascot, the bell, the mouse, the terminal tab title…); the app has its own controls for these. */
export const TERMINAL_ONLY = new Set(['help', 'mascot', 'color', 'theme', 'motion', 'cento', 'demo', 'density', 'title', 'bell', 'spinner', 'mouse', 'agents']);
/** The commands to offer while the message is a single word starting with `/`: names that begin with what was typed, at most eight. Nothing once there is a space (the arguments are being typed). */
export function slashMatches(all: readonly SlashCommand[], text: string): SlashCommand[] {
  if (!/^\/[\w-]*$/.test(text)) return [];
  const q = text.slice(1).toLowerCase();
  return all.filter((c) => !TERMINAL_ONLY.has(c.name) && c.name.startsWith(q) && c.name !== q).slice(0, 8);
}
