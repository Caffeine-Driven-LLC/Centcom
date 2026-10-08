/** What the palette can run: every slash command, the quick settings, and the animations, each as a slash command line. */
import { CENTO_COLORS, bakedNames, getBaked } from '@centcom/mascot';
import { COMMANDS } from '../state/commands.js';

export interface Entry { id: string; /** What is searched and shown (commands get a leading slash on screen). */ label: string; detail: string; /** The command line to run. */ cmd: string }

const quick = (cmd: string, detail: string): Entry => ({ id: 'q:' + cmd, label: cmd.slice(1), detail, cmd });
export function commandEntries(): Entry[] {
  return COMMANDS.map((c) => ({ id: 'c:' + c.name, label: c.name, detail: [c.args, c.desc].filter(Boolean).join('  '), cmd: '/' + c.name }));
}
export function quickEntries(): Entry[] {
  return [
    quick('/theme dark', 'Graphite'), quick('/theme light', 'Paper, for light terminals'), quick('/theme hc', 'high contrast'),
    quick('/mode default', 'ask before commands and edits'), quick('/mode edits', 'edits go through, commands ask'), quick('/mode plan', 'read-only, nothing is changed'), quick('/mode bypass', 'dangerously skip permission prompts'),
    quick('/motion reduced', 'still, quieter'), quick('/motion full', 'Cento moves'), quick('/spinner plain', 'just "Working…"'), quick('/spinner fun', 'rotating verbs'),
    quick('/density compact', 'fit more on screen'), quick('/density comfortable', 'a blank row between messages'), quick('/mouse on', 'wheel and clicks'), quick('/mouse off', 'select text with the mouse'),
    quick('/mascot large', ''), quick('/mascot small', ''), quick('/mascot off', ''), quick('/mascot auto', ''), ...CENTO_COLORS.map((c) => quick(`/color ${c}`, "Cento's colour")),
    ...(['low', 'medium', 'high', 'xhigh', 'max'] as const).map((l) => quick(`/effort ${l}`, 'how hard the agent thinks')),
  ];
}
/** Animations are many (319), so they are searched but not listed until you type. */
export function animationEntries(): Entry[] { return bakedNames().map((n) => ({ id: 'a:' + n, label: 'cento ' + n, detail: getBaked(n)?.desc ?? '', cmd: '/cento ' + n })); }
/** What people reach for first: shown as "Recent" before anything is typed. */
export const FIRST_LABELS = ['model', 'effort', 'mode', 'resume', 'new', 'night', 'skills', 'compact', 'usage', 'help'];
