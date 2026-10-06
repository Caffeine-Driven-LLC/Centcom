import type { ValidationIssue } from './types.js';

export const CLAUDE_EVENTS = ['PreToolUse', 'PostToolUse', 'UserPromptSubmit', 'Notification', 'Stop', 'SubagentStop', 'PreCompact', 'SessionStart'] as const;
export const LIMITS = { hooksPerEvent: 8, commandChars: 1024, timeoutMin: 1, timeoutMax: 600, matcherChars: 256 } as const;
export const isKnownEvent = (e: string) => (CLAUDE_EVENTS as readonly string[]).includes(e);
export interface HookShape { matcher?: unknown; command?: unknown; timeout_s?: unknown }

/** Checks one hook. `command_not_found` is not decided here (it needs the PATH); the manager adds it. */
export function checkHook(d: HookShape): ValidationIssue[] {
  const out: ValidationIssue[] = [];
  if (typeof d.command !== 'string' || !d.command.trim() || /\0/.test(d.command)) out.push({ code: 'too_long', message: 'A hook needs a command.' });
  else if (d.command.length > LIMITS.commandChars) out.push({ code: 'too_long', message: `A command is at most ${LIMITS.commandChars} characters.` });
  if (d.timeout_s !== undefined && (typeof d.timeout_s !== 'number' || !Number.isInteger(d.timeout_s) || d.timeout_s < LIMITS.timeoutMin || d.timeout_s > LIMITS.timeoutMax)) out.push({ code: 'bad_timeout', message: `The timeout is a whole number of seconds from ${LIMITS.timeoutMin} to ${LIMITS.timeoutMax}.` });
  if (d.matcher !== undefined) { let ok = typeof d.matcher === 'string' && d.matcher.length <= LIMITS.matcherChars; if (ok && d.matcher !== '' && d.matcher !== '*') { try { new RegExp(d.matcher as string); } catch { ok = false; } } if (!ok) out.push({ code: 'bad_matcher', message: 'The matcher is a short text such as Edit|Write (a regular expression), or * for everything.' }); }
  return out;
}
