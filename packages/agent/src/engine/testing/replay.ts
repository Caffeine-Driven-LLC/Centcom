import { AsyncQueue } from '../../queue.js';
import type { ApprovalDecision, EngineSession, NormalisedEvent, PermissionGate } from '../../types.js';
import type { ExpectStep, Transcript } from './transcript.js';
import type { ScriptedEngine, ScriptedSession } from './fake-engine.js';

export interface ReplayOptions { /** Replace the default driver (which sends, interrupts and approves exactly as the transcript says). */ driver?: (s: ScriptedSession, gate: PermissionGate) => Promise<void>; agentId?: string }

/** Plays a transcript through the engine and returns every event it produced. */
export async function replayTranscript(e: ScriptedEngine, _t: Transcript, o: ReplayOptions = {}): Promise<NormalisedEvent[]> {
  const decisions = new AsyncQueue<ApprovalDecision>(); const gate: PermissionGate = { decide: async () => (await decisions[Symbol.asyncIterator]().next()).value };
  const session = (await e.start({ agentId: o.agentId ?? 'agt_01JTEST0000000000000000001', cwd: '/tmp', approvalGate: gate })) as unknown as ScriptedSession;
  const out: NormalisedEvent[] = []; const reader = (async () => { for await (const ev of session.events) out.push(ev); })();
  const driver = o.driver ?? (async (s) => { for await (const x of s.expectations) { await act(s, x, decisions); } });
  const driving = driver(session, gate).catch((err) => { throw err; });
  await session.finished; await session.stop(); await Promise.allSettled([reader, driving]); if (session.failure) throw session.failure; return out;
}
async function act(s: EngineSession, x: ExpectStep, decisions: AsyncQueue<ApprovalDecision>) {
  if (x.expect === 'send') await s.send(x.prompt ?? ''); else if (x.expect === 'interrupt') await s.interrupt(); else decisions.push({ decision: x.decision, scope: 'once' });
}
