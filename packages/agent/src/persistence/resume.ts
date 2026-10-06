/** Continuing a saved conversation: the engine's own session if it can, otherwise a fresh one that starts from a summary. */
import type { AgentEngine, EngineSession, EngineStartOptions } from '../types.js';
import type { SessionStore } from './store.js';
import { summaryText } from './store.js';

export interface ResumeOutcome { mode: 'engine-resumed' | 'fresh-with-summary' | 'read-only'; engineSessionId?: string; reason?: string; session?: EngineSession; summary?: string }
export interface ResumeDeps { store: SessionStore; engines: { get(id: string): AgentEngine | undefined }; log?: { info(m: string, f?: Record<string, unknown>): void } }

/** `engine` picks the engine to continue with (default: the one the conversation last used). The engine's own error text is kept in `reason`. */
export async function resumeSession(d: ResumeDeps, id: string, o: { agentId?: string; engine?: string; start?: Partial<EngineStartOptions> & { cwd: string } } = { start: { cwd: process.cwd() } }): Promise<ResumeOutcome> {
  const s = await d.store.open(id); const last = s.engineSessions.at(-1); const engineId = o.engine ?? last?.engine; const engine = engineId ? d.engines.get(engineId) : undefined;
  if (!engine) return { mode: 'read-only', reason: engineId ? `${engineId} is not available here.` : 'No engine to continue with.' };
  const base: EngineStartOptions = { agentId: o.agentId ?? 'agt_resume', cwd: s.summary.cwd || process.cwd(), ...o.start };
  const fresh = async (reason: string): Promise<ResumeOutcome> => { const summary = `This conversation is being continued. Summary of it so far:\n\n${summaryText(s.records)}`; const session = await engine.start({ ...base, systemPromptAppend: [base.systemPromptAppend, summary].filter(Boolean).join('\n\n') }); d.log?.info('session.resume_fresh'); return { mode: 'fresh-with-summary', reason, session, summary }; };
  if (!last) return fresh('This conversation has no engine session to continue.');
  if (last.engine !== engine.id) return fresh(`This conversation was with ${last.engine}.`);
  if (!engine.capabilities().has('resume')) return fresh(`${engine.label} cannot resume conversations.`);
  try { const session = await engine.start({ ...base, resume: { engine_session_id: last.engineSessionId } }); d.log?.info('session.resumed'); return { mode: 'engine-resumed', engineSessionId: last.engineSessionId, session }; }
  catch (e) { return fresh(String((e as Error)?.message ?? e)); } // the engine refused the id (expired or removed): its own words are kept
}
