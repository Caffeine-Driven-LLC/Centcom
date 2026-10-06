/** The local session log format (v2): one JSONL file per session, a header line, then one record per line. */
export const HEADER = { fmt: 'centcom.localsession', v: 2 } as const;
export const SESSION_ID = /^ses_[0-9A-HJKMNP-TV-Z]{26}$/;
export interface LogRecord { n: number; at: string; agent_id?: string; type: string; data: unknown }
export type EngineName = 'claude-code' | 'codex';
export interface EngineSessionRef { engine: EngineName; engineSessionId: string; sinceSeq: number }
export interface SessionSummary { id: string; cwd: string; branch?: string; title: string; created_at: string; updated_at: string; message_count: number; engines: EngineName[]; last_model?: string; engine_sessions: EngineSessionRef[] }
export interface LoadedSession { id: string; records: LogRecord[]; engineSessions: EngineSessionRef[]; summary: SessionSummary; recovered: boolean }

export interface Limits { flushMs: number; flushRecords: number; segmentBytes: number; lineBytes: number; bufferRecords: number; bufferBytes: number; fieldBytes: number }
export const LIMITS: Limits = { flushMs: 250, flushRecords: 50, segmentBytes: 64 * 1024 * 1024, lineBytes: 1024 * 1024, bufferRecords: 1000, bufferBytes: 8 * 1024 * 1024, fieldBytes: 8 * 1024 };

export class UnsupportedSessionFormat extends Error { readonly code = 'unsupported_session_format'; constructor(found: string) { super(`This saved conversation was written by a different Centcom version (${found}) and cannot be opened.`); } }
export class SessionInUse extends Error { readonly code = 'session_in_use'; readonly hint = 'session in use'; constructor(readonly pid: number) { super(`session in use: another Centcom (pid ${pid}) has this conversation open.`); } }
export class SessionNotFound extends Error { readonly code = 'session_not_found'; constructor(id: string) { super(`No saved conversation ${id}.`); } }
