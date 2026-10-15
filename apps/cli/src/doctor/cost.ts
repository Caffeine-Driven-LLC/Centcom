/**
 * `centcom doctor --cost [transcript.jsonl ...] [--json]`: where a session's tokens went and what Centcom added on top of plain `claude`.
 * With transcripts (a Claude Code session file and, optionally, its sub-agent files or the folder that holds them) it reads them; with none it
 * drives Centcom's real Claude engine against a stand-in for three turns and reports the launch flags and whether the cached prompt prefix stays the same.
 * Makes no model call and no network call. Prints no file names, paths or message text.
 */
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { captureTurns, flagValues, formatTranscriptSummary, prefixChanges, summarizeTranscript, PREFIX_FLAGS } from '@centcom/agent';

export interface CostIo { out(l: string): void; err(l: string): void }
const MAX_BYTES = 256 * 1024 * 1024;

/** Reads a transcript file as lines (bounded: a file over 256 MiB is refused). */
function lines(p: string): string[] | undefined { try { if (statSync(p).size > MAX_BYTES) return undefined; return readFileSync(p, 'utf8').split('\n'); } catch { return undefined; } }

/** A path given on the command line: a transcript, or a session folder / project folder holding `subagents/*.jsonl` next to it. Returns the main file and its sub-agent files. */
export function resolveTranscripts(paths: string[]): { main: string[]; subs: string[][] } | string {
  const mains: string[] = []; const subs: string[][] = [];
  for (const p of paths) {
    if (!existsSync(p)) return 'A file or folder you named does not exist.';
    if (statSync(p).isDirectory()) { const dir = existsSync(join(p, 'subagents')) ? join(p, 'subagents') : p; for (const f of readdirSync(dir).filter((x) => x.endsWith('.jsonl')).sort()) { const l = lines(join(dir, f)); if (l) subs.push(l); } continue; }
    const l = lines(p); if (!l) return 'A transcript is too large to read (the limit is 256 MiB).';
    if (/subagents[\\/]/.test(p)) subs.push(l); else if (mains.length === 0) mains.push(...l); else subs.push(l);
  }
  return { main: mains, subs };
}

/** The Centcom launch flags that reach the model, as three representative turns show them. */
export async function launchReport(): Promise<{ lines: string[]; json: object }> {
  const gate = { decide: async () => ({ decision: 'deny' as const, scope: 'once' as const }) };
  const cap = await captureTurns(['first', 'second', 'third'], { approvalGate: gate, addDirs: ['/skills/a', '/skills/b'], permissionMode: 'default' });
  const changes = prefixChanges(cap.argv); const argv = cap.argv[1] ?? [];
  const rows = PREFIX_FLAGS.map((f) => ({ flag: f, values: flagValues(argv, f).length })).filter((r) => r.values > 0);
  const out = [
    `claude is launched once per turn (${cap.argv.length} turns measured against a stand-in, no model call)`,
    `flags that reach the cached prompt prefix on a resumed turn: ${rows.map((r) => r.flag).join(', ') || 'none'}`,
    changes.length ? `PREFIX CHANGES between turns: ${changes.map((c) => `${c.flag} (turn ${c.turn})`).join(', ')}` : 'cached prefix: byte-identical across turns (no prefix flag changes between turns)',
  ];
  return { lines: out, json: { turns: cap.argv.length, prefix_flags: rows, prefix_changes: changes.map((c) => ({ flag: c.flag, turn: c.turn })) } };
}

/** Exit codes: 0 report printed, 2 bad arguments or unreadable input. */
export async function runCost(argv: string[], io: CostIo): Promise<number> {
  const paths = argv.filter((a) => !a.startsWith('--')); const json = argv.includes('--json');
  for (const a of argv) if (a.startsWith('--') && a !== '--json' && a !== '--cost') { io.err(`Unknown option ${a.slice(0, 30)}. Usage: centcom doctor --cost [transcript.jsonl ...] [--json]`); return 2; }
  if (paths.length) {
    const r = resolveTranscripts(paths); if (typeof r === 'string') { io.err(r); return 2; }
    const s = summarizeTranscript(r.main, r.subs);
    if (json) io.out(JSON.stringify(s)); else { io.out('Session cost report'); for (const l of formatTranscriptSummary(s)) io.out(l); }
    return 0;
  }
  const l = await launchReport();
  if (json) io.out(JSON.stringify(l.json)); else { io.out('Centcom launch report'); for (const x of l.lines) io.out(x); io.out('Name a Claude Code transcript to see where a real session\'s tokens went: centcom doctor --cost <session.jsonl>'); }
  return 0;
}
