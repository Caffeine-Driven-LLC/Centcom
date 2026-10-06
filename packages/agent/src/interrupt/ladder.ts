/** The signal ladder: SIGINT, then SIGTERM after the grace time (3 s), then SIGKILL at 8 s. `hard` sends SIGKILL at once. */
import type { Killed, ProcessRegistry, Sig } from './procs.js';

export interface LadderClock { setTimeout(f: () => void, ms: number): unknown; clearTimeout(h: unknown): void }
export const realClock: LadderClock = { setTimeout: (f, ms) => { const t = setTimeout(f, ms); (t as { unref?: () => void }).unref?.(); return t; }, clearTimeout: (h) => clearTimeout(h as NodeJS.Timeout) };
export interface LadderOptions { agentId: string; procs: ProcessRegistry; clock?: LadderClock; /** Resolves when the process has exited. */ exited: Promise<unknown>; graceMs?: number; killMs?: number; hard?: boolean; /** Skip the first SIGINT (the engine already asked by protocol). */ skipSigint?: boolean }
export interface LadderResult { terminated: Killed[]; exited: boolean }

export async function signalLadder(o: LadderOptions): Promise<LadderResult> {
  const clock = o.clock ?? realClock; const grace = o.graceMs ?? 3000; const killAt = Math.max(grace, o.killMs ?? 8000); const terminated: Killed[] = []; let gone = false;
  void o.exited.then(() => { gone = true; }, () => { gone = true; });
  const send = (s: Sig) => { if (!gone) terminated.push(...o.procs.signal(o.agentId, s)); };
  /** Waits until the process exits or `ms` pass; true when it exited. */
  const wait = (ms: number) => new Promise<boolean>((res) => { if (gone) { res(true); return; } const h = clock.setTimeout(() => res(gone), ms); void o.exited.then(() => { clock.clearTimeout(h); res(true); }, () => { clock.clearTimeout(h); res(true); }); });
  if (o.hard) { send('SIGKILL'); return { terminated, exited: await wait(1000) }; }
  if (!o.skipSigint) send('SIGINT');
  if (await wait(grace)) return { terminated, exited: true };
  send('SIGTERM'); if (await wait(killAt - grace)) return { terminated, exited: true };
  send('SIGKILL'); return { terminated, exited: await wait(1000) };
}
