import approval from './templates/notify-on-approval.json' with { type: 'json' };
import formatter from './templates/run-formatter-after-edit.json' with { type: 'json' };
import forcePush from './templates/block-force-push.json' with { type: 'json' };
import stopLog from './templates/log-session-stop.json' with { type: 'json' };
import { HooksError } from './errors.js';
import type { HookDef, HookTemplate } from './types.js';

export const TEMPLATES: readonly HookTemplate[] = [approval, formatter, forcePush, stopLog] as HookTemplate[];
/** The hook a template gives, with the user's choices put in. A choice has to be one of the fixed list: nothing else is ever put into the command. */
export function fillTemplate(t: HookTemplate, choices: Record<string, string>): HookDef {
  let command = t.command;
  for (const p of t.params ?? []) { const v = choices[p.name] ?? p.choices[0]; if (!p.choices.includes(v!)) throw new HooksError('invalid_hook', `${p.label} has to be one of: ${p.choices.join(', ')}.`); command = command.split(`{{${p.name}}}`).join(v!); }
  return { ...(t.matcher !== undefined ? { matcher: t.matcher } : {}), command, ...(t.timeout_s !== undefined ? { timeout_s: t.timeout_s } : {}) };
}
