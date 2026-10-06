/** `/rewind [n]` and `centcom rewind`: list the checkpoints of an agent and go back to one. Everything it touches is injected. */
import { CheckpointError, type Checkpoint, type CheckpointManager, type RewindMode, type RewindPlan } from '@centcom/agent';

export interface RewindIO { mgr: CheckpointManager; now(): number; out(line: string): void; err(line: string): void; isTTY: boolean; confirm(q: string): Promise<boolean> }
export const REWIND_HELP = `centcom rewind list
centcom rewind <n> [--mode files|conversation|both] [--also <path>]... [--yes]`;
/** Shown before any files are changed. */
export const REWIND_NOTICE = 'Only files in this folder are put back. What commands did elsewhere (installs, network calls, databases, files outside this folder) is not undone.';
export const age = (iso: string, now: number): string => { const s = Math.max(0, Math.round((now - Date.parse(iso)) / 1000)); return s < 60 ? `${s}s` : s < 3600 ? `${Math.floor(s / 60)}m` : s < 86400 ? `${Math.floor(s / 3600)}h` : `${Math.floor(s / 86400)}d`; };
export const formatCheckpoint = (c: Checkpoint, now: number): string => `${String(c.n).padStart(3)}  ${age(c.at, now).padStart(4)} ago  ${c.label || '(no text)'}  ${c.commit ? `+${c.files.added} ~${c.files.changed} -${c.files.removed}` : '(no file snapshot)'}`;
export function formatPlan(p: RewindPlan): string[] {
  const l: string[] = []; if (p.restore.length) l.push(`Restore ${p.restore.length} file${p.restore.length === 1 ? '' : 's'}: ${p.restore.slice(0, 8).join(', ')}${p.restore.length > 8 ? ', ...' : ''}`); if (p.delete.length) l.push(`Delete ${p.delete.length} file${p.delete.length === 1 ? '' : 's'} created since: ${p.delete.slice(0, 8).join(', ')}${p.delete.length > 8 ? ', ...' : ''}`);
  if (p.skippedModifiedOutside.length) l.push(`Changed by someone else since, left alone unless you list them with --also: ${p.skippedModifiedOutside.join(', ')}`);
  if (p.conversation !== 'none') l.push(p.conversation === 'engine-resume' ? 'The conversation goes back with the engine.' : 'The conversation starts again from a short summary.'); if (!l.length) l.push('Nothing to change.'); return l;
}
const one = (a: string[], n: string) => { const i = a.indexOf(n); return i >= 0 ? a[i + 1] : undefined; }; const all = (a: string[], n: string) => a.flatMap((x, i) => (x === n && a[i + 1] !== undefined ? [a[i + 1]!] : []));
export async function runRewind(argv: string[], io: RewindIO): Promise<number> {
  const [sub, ...rest] = argv;
  try {
    await io.mgr.ready();
    if (sub === 'list' || sub === undefined) { const l = io.mgr.list(); if (!l.length) io.out('No checkpoints yet. One is made at the start of every turn.'); for (const c of [...l].reverse()) io.out(formatCheckpoint(c, io.now())); return 0; }
    const n = Number(sub); if (!Number.isInteger(n) || n < 1) { io.err(REWIND_HELP); return 2; } const mode = (one(rest, '--mode') ?? 'files') as RewindMode; if (!['files', 'conversation', 'both'].includes(mode)) { io.err('--mode is files, conversation or both.'); return 2; }
    const id = `ckp_${n}`; const plan = await io.mgr.preview(id, mode); for (const line of formatPlan(plan)) io.out(line); if (mode !== 'conversation') io.out(REWIND_NOTICE);
    if (!rest.includes('--yes')) { if (!io.isTTY) { io.err('This needs an interactive terminal to confirm, or pass --yes.'); return 1; } if (!(await io.confirm('Go back to this point?'))) { io.out('Nothing changed.'); return 1; } }
    const res = await io.mgr.rewind(id, mode, { confirmedPaths: all(rest, '--also') });
    if (res.failed) { io.err(`Stopped part way. Put back: ${res.failed.restored.length}. Not put back: ${res.failed.unrestored.join(', ')}.${res.undoRef ? ' Your state before this was saved and can be restored.' : ''}`); return 1; }
    io.out(`Restored ${res.restored.length}, deleted ${res.deleted.length}${res.skipped.length ? `, left ${res.skipped.length} alone` : ''}.${res.undoRef ? ' Undo: rewind to the "before rewind" checkpoint.' : ''}`); if (res.conversation?.resumeError) io.out(`The tool said: ${res.conversation.resumeError}`); return 0;
  } catch (e) { if (e instanceof CheckpointError) { io.err(e.message); return e.code === 'not_found' ? 2 : 1; } io.err('Something went wrong.'); return 1; }
}
