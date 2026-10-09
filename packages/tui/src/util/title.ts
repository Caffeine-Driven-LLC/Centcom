/** The terminal tab title: the folder and what the agent is doing, so the right tab is easy to find. Control characters and anything that could end the escape early are removed. */
import { basename } from 'node:path';

export interface TitleState { cwd: string; busy: boolean; approvals: number; mode: string; engineLabel: string; demo: boolean }
export const cleanTitle = (s: string): string => s.replace(/[\u0000-\u001f\u007f-\u009f\u2028\u2029]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 80);
export function windowTitle(s: TitleState): string {
  const folder = basename(s.cwd) || s.cwd || 'centcom';
  const state = s.approvals > 0 ? '● needs you' : s.busy ? '◐ working' : '';
  return cleanTitle(`${state ? state + ' · ' : ''}${folder} · Centcom${s.demo ? ' (demo)' : ''}`);
}
/** Save the current title on the terminal's own stack (xterm `CSI 22 t`), and put it back (`CSI 23 t`). */
export const TITLE_PUSH = '\x1b[22;0t'; export const TITLE_POP = '\x1b[23;0t';
export const setTitle = (t: string): string => `\x1b]0;${cleanTitle(t)}\x07`;
