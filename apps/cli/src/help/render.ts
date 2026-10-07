/** Help text as plain, wrapped lines (80 columns at most), with bold only when asked for. */
import { COMMANDS, find, type CommandMeta } from './commands.js';
import { ENV_VARS, EXIT_CODES, RELAY_NEVER, RELAY_VISIBLE, TRAFFIC_NOTE } from './topics.js';

const wrap = (text: string, width: number, indent = ''): string[] => { const out: string[] = []; let line = indent; for (const w of text.split(/\s+/).filter(Boolean)) { if (line.length + w.length + (line.trim() ? 1 : 0) > width && line.trim()) { out.push(line); line = indent + w; } else line += (line.trim() ? ' ' : '') + w; } if (line.trim()) out.push(line); return out; };
export function renderHelp(cmd: CommandMeta, o: { width: number; colour: boolean }): string {
  const width = Math.min(80, Math.max(40, o.width)); const b = (s: string) => (o.colour ? `\u001b[1m${s}\u001b[22m` : s); const out: string[] = [b(`${cmd.name} - ${cmd.summary}`), '', b('Usage'), `  ${cmd.usage}`, '', ...wrap(cmd.description, width)];
  if (cmd.flags.length) { out.push('', b('Options')); const col = Math.min(34, Math.max(...cmd.flags.map((f) => (f.flag + (f.arg ? ' ' + f.arg : '')).length)) + 2); for (const f of cmd.flags) { const left = `  ${f.flag}${f.arg ? ' ' + f.arg : ''}`; const lines = wrap(f.description, width - col - 2); if (left.length + 2 > col + 2) out.push(left, ...lines.map((l) => ' '.repeat(col + 2) + l)); else out.push(left.padEnd(col + 2) + (lines[0] ?? ''), ...lines.slice(1).map((l) => ' '.repeat(col + 2) + l)); } }
  if (cmd.examples?.length) out.push('', b('Examples'), ...cmd.examples.map((e) => `  ${e}`)); return out.join('\n');
}
export function renderTopic(name: string, o: { width: number; colour: boolean }): string | undefined {
  const w = Math.min(80, o.width); const b = (s: string) => (o.colour ? `\u001b[1m${s}\u001b[22m` : s);
  if (name === 'env') return [b('Environment variables'), '', ...ENV_VARS.flatMap((v) => { const d = wrap(v.description, w - 26); return d.map((l, i) => (i ? ' '.repeat(26) + l : `  ${v.name.padEnd(24)}${l}`)); })].join('\n');
  if (name === 'privacy') return [b('What the relay can see'), '', ...RELAY_VISIBLE.map((x) => `  - ${x}`), '', b('What it never sees'), '', ...RELAY_NEVER.map((x) => `  - ${x}`), '', ...wrap(TRAFFIC_NOTE, w)].join('\n');
  if (name === 'exit-codes') return [b('Exit codes of centcom -p'), '', ...EXIT_CODES.map(([c, t]) => `  ${String(c).padEnd(4)} ${t}`)].join('\n');
  return undefined;
}
export const TOPICS = ['env', 'privacy', 'exit-codes'];
/** `centcom help [topic]`: the index, a command, or a topic. Returns text and an exit code. */
export function helpFor(topic: string | undefined, o: { width: number; colour: boolean }): { text: string; code: number } {
  if (!topic) return { code: 0, text: [`Centcom: ${find('centcom')!.summary}`, '', 'Commands', ...COMMANDS.filter((c) => c.name !== 'centcom').map((c) => `  ${c.name.padEnd(10)} ${c.summary}`), '', 'Topics', ...TOPICS.map((t) => `  ${t}`), '', 'Try: centcom help <command or topic>'].join('\n') };
  const c = find(topic); if (c) return { code: 0, text: renderHelp(c, o) }; const t = renderTopic(topic, o); if (t) return { code: 0, text: t };
  return { code: 2, text: `No help for "${topic.slice(0, 30)}". Try: centcom help` };
}

/** The text of `centcom --help`: made from the command list, wrapped to 80 columns, plain text. */
export function topHelp(version: string, width = 80): string {
  const w = Math.min(80, width); const top = find('centcom')!; const out: string[] = [`centcom ${version}: command many hands`, '', 'Usage', `  centcom [options]    start the terminal app in this directory`];
  for (const c of COMMANDS.filter((x) => x.name !== 'centcom')) { const head = `  ${c.usage}`; if (head.length + 3 + c.summary.length <= w) out.push(`${head.padEnd(Math.min(44, w - c.summary.length - 2))}  ${c.summary}`); else out.push(head, ...wrap(c.summary, w - 6, '      ')); }
  out.push('', 'Scripting', '  centcom -p "task" (--print)   run once, print the answer, exit (no screen).', '    Piped input is added to the prompt:', '      cat error.log | centcom -p "what went wrong?"', ...wrap('Anything that needs an approval is declined and reported (exit code 3); allow it with --mode acceptEdits or --dangerously-skip-permissions. Exit codes: 0 done, 1 error, 2 bad usage, 3 an action was declined, 4 agent not installed or not signed in, 5 plan or rate limit, 6 not reachable, 124 timeout, 130 interrupted.', w, '    '));
  out.push('', 'Options'); const col = 22;
  for (const f of top.flags.filter((x) => x.flag !== '-p, --print')) { const left = `  ${f.flag}${f.arg ? ' ' + f.arg : ''}`; const lines = wrap(f.description, w - col - 2); if (left.length > col) out.push(left, ...lines.map((l) => ' '.repeat(col + 2) + l)); else out.push(left.padEnd(col + 2) + (lines[0] ?? ''), ...lines.slice(1).map((l) => ' '.repeat(col + 2) + l)); }
  out.push('', ...wrap('Environment variables and exit codes: centcom help env, centcom help exit-codes. More: centcom help <command>.', w), '', 'Centcom drives your own Claude Code; it never sees your login.'); return out.join('\n');
}
