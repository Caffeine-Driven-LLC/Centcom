import type { TeamLine, TeamView } from './team.js';

/** A teammate's transcript as plain lines, read only: what they asked, what their agent said and which tools ran. */
export function renderTranscript(lines: TeamLine[], who: string, last = 40): string {
  if (!lines.length) return '';
  return lines.slice(-last).map((l) => {
    if (l.kind === 'user') return `${who}: ${l.text}`;
    if (l.kind === 'assistant') return `agent: ${l.text}`;
    if (l.kind === 'tool') return `  · ${l.name || 'tool'}${l.text ? ` ${l.text}` : ''}${l.status && l.status !== 'ok' ? ` [${l.status}]` : ''}`;
    return `${l.level === 'error' ? '!' : l.level === 'warn' ? '~' : '-'} ${l.text}`;
  }).join('\n');
}

const STATE: Record<string, string> = { thinking: 'working', 'awaiting-approval': 'waiting for its owner', idle: 'idle', exited: 'left', crash: 'crashed', away: 'away' };
/** The team as plain lines (the terminal's /team and the notice that comes with a conflict). */
export function renderTeam(v: TeamView): string {
  const lines: string[] = [];
  for (const m of v.members) {
    lines.push(`${m.you ? 'You' : m.name}${m.you ? '' : ` (${m.role === 'host' ? 'host' : m.role === 'editor' ? 'editor' : 'viewer'})`}${m.online ? '' : ' · away'}`);
    if (!m.agents.length) lines.push('  no agent here');
    for (const a of m.agents) {
      const how = a.provider === 'anthropic' ? 'Claude Code' : a.provider === 'openai' ? 'Codex' : a.label ?? 'agent'; const state = STATE[a.state] ?? a.state.replace(/-/g, ' ');
      lines.push(`  ${how}: ${state}${a.branch ? ` on ${a.branch}` : ''}${a.ahead !== undefined || a.behind !== undefined ? ` (${a.ahead ?? 0} ahead, ${a.behind ?? 0} behind${a.dirty ? ', changes' : ''})` : ''}`);
      if (a.locks.length) lines.push(`    has open: ${a.locks.map((l) => l.path ?? 'a file').join(', ')}`);
      if (a.lastSaid) lines.push(`    ${a.lastSaid}`); else if (a.sharing === false && !a.exit) lines.push('    activity not shared');
    }
  }
  for (const c of v.conflicts) lines.push(`! conflict on ${c.paths.join(', ') || 'a file'}: two agents are changing it`);
  for (const h of v.handoffs.filter((x) => x.state === 'offered')) lines.push(`> work offered to ${v.members.find((m) => m.id === h.to)?.name ?? 'someone'}${h.note ? `: ${h.note}` : ''}`);
  for (const h of v.hints) lines.push(`~ ${h}`);
  return lines.join('\n');
}
