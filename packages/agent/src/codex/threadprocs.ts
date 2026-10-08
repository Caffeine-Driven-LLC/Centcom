/** Commands Codex runs live in their own process group, so neither `turn/interrupt` nor signalling the app-server's group stops them (verified on codex-cli 0.161.0). Every command's environment carries CODEX_THREAD_ID, which finds them. */
import { execFileSync } from 'node:child_process';
import { readFileSync, readdirSync } from 'node:fs';

export interface ProcDeps { platform?: NodeJS.Platform; listPids?: () => number[]; environOf?: (pid: number) => string | undefined; psEnv?: () => string; kill?: (pid: number, sig: NodeJS.Signals) => void; self?: number[] }
const tagOf = (threadId: string): string => `CODEX_THREAD_ID=${threadId}`;
/** Pids whose environment names this thread (never ours, never the app-server's). */
export function findThreadPids(threadId: string, d: ProcDeps = {}): number[] {
  if (!threadId || /[^\w-]/.test(threadId)) return []; // ids are uuids; anything else is not matched
  const tag = tagOf(threadId); const skip = new Set([process.pid, ...(d.self ?? [])]); const out: number[] = [];
  try {
    if ((d.platform ?? process.platform) === 'linux' || d.environOf) {
      const environOf = d.environOf ?? ((pid: number) => { try { return readFileSync(`/proc/${pid}/environ`, 'latin1'); } catch { return undefined; } });
      const pids = d.listPids ? d.listPids() : readdirSync('/proc').filter((n) => /^\d+$/.test(n)).map(Number);
      for (const pid of pids) { if (skip.has(pid)) continue; const env = environOf(pid); if (env && env.split('\0').includes(tag)) out.push(pid); }
    } else if ((d.platform ?? process.platform) !== 'win32') {
      const text = d.psEnv ? d.psEnv() : execFileSync('ps', ['eww', '-Ao', 'pid=,command='], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, timeout: 5000 });
      for (const line of text.split('\n')) { const m = /^\s*(\d+)\s/.exec(line); if (!m) continue; const pid = Number(m[1]); if (skip.has(pid)) continue; if (new RegExp(`(^|\\s)${tag.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(\\s|$)`).test(line)) out.push(pid); }
    }
  } catch { /* best effort: nothing found */ }
  return out;
}
/** SIGTERM everything tagged with the thread, then SIGKILL what is still there after `graceMs`. Returns the pids that were signalled. */
export async function killThreadCommands(threadId: string, o: ProcDeps & { graceMs?: number; sleep?: (ms: number) => Promise<void> } = {}): Promise<number[]> {
  const kill = o.kill ?? ((pid: number, sig: NodeJS.Signals) => { try { process.kill(pid, sig); } catch { /* already gone */ } });
  const first = findThreadPids(threadId, o); for (const pid of first) kill(pid, 'SIGTERM');
  if (!first.length) return [];
  await (o.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms))))(o.graceMs ?? 1500);
  for (const pid of findThreadPids(threadId, o)) kill(pid, 'SIGKILL');
  return first;
}
