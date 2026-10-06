/** Centcom's own record of every conversation (lane C026): an append-only, redacted JSONL log per session, an index, a lock, retention. */
import { existsSync, readdirSync, readFileSync, renameSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { newId } from '../ids.js';
import type { NormalisedEvent } from '../types.js';
import { LIMITS, SESSION_ID, SessionNotFound, type EngineName, type EngineSessionRef, type Limits, type LoadedSession, type LogRecord, type SessionSummary } from './format.js';
import { appendLines, ensureDir, readLog, segmentName, segments } from './log.js';
import { lockHolder, pidAlive, takeLock } from './lock.js';
import { cut, scrub } from './redact.js';

export interface PersistClock { now(): number; setTimeout(f: () => void, ms: number): unknown; clearTimeout(h: unknown): void }
export interface StoreDeps { dataDir: string; clock?: PersistClock; bus?: { emit(k: 'session.persist_failed', p: { session_id: string; code: string }): void }; redact?: (s: string) => string; log?: { debug(m: string, f?: Record<string, unknown>): void; warn(m: string, f?: Record<string, unknown>): void }; limits?: Partial<Limits>; retentionDays?: number; alive?: (pid: number) => boolean }
export interface SessionHandle {
  readonly id: string;
  append(ev: NormalisedEvent): void;
  /** A record that is not an engine event: `user.message`, `notice`… */
  note(type: string, data: unknown, agentId?: string): void;
  recordEngineSession(m: EngineSessionRef): void;
  markRewind(toSeq: number): Promise<void>;
  flush(): Promise<void>; close(): Promise<void>;
  /** A per-session side file the UI may keep for fast redraws (rebuildable from the log). */
  saveView(view: unknown): void;
}
export interface SessionStore {
  create(init: { cwd: string; branch?: string; id?: string }): Promise<SessionHandle>;
  /** Opens a session for writing (takes its lock). */
  resume(id: string): Promise<SessionHandle>;
  open(id: string): Promise<LoadedSession>;
  list(q?: { cwd?: string; limit?: number }): Promise<SessionSummary[]>;
  remove(id: string): Promise<void>;
  prune(now: Date): Promise<{ removed: number }>;
  /** Synchronous versions for the terminal app, which saves on exit. */
  sync: { create(init: { cwd: string; branch?: string; id?: string }): SessionHandle; resume(id: string): SessionHandle; open(id: string): LoadedSession; list(q?: { cwd?: string; limit?: number }): SessionSummary[]; remove(id: string): void; loadView(id: string): unknown };
  toSnapshotEvents(id: string, o?: { fromSeq?: number }): Promise<NormalisedEvent[]>;
  readonly dir: string;
}

const realClock: PersistClock = { now: () => Date.now(), setTimeout: (f, ms) => { const t = setTimeout(f, ms); t.unref?.(); return t; }, clearTimeout: (h) => clearTimeout(h as NodeJS.Timeout) };
const NOT_EVENTS = new Set(['session.meta', 'user.message', 'engine.session', 'rewind', 'recovered', 'notice']);
/** Lines a fast index rebuild must parse; everything else only counts. */
const SUMMARY_TYPES = ['"type":"session.meta"', '"type":"user.message"', '"type":"engine.session"', '"type":"session.started"'];

/** Builds the index row of one session from its records. */
export function summarise(id: string, records: LogRecord[], updatedMs?: number): SessionSummary {
  const meta = records.find((r) => r.type === 'session.meta')?.data as { cwd?: string; branch?: string } | undefined;
  const firstUser = records.find((r) => r.type === 'user.message')?.data as { text?: string } | undefined;
  const engineSessions = records.filter((r) => r.type === 'engine.session').map((r) => r.data as EngineSessionRef);
  const model = [...records].reverse().find((r) => r.type === 'session.started')?.data as { model?: string } | undefined;
  const at = (r?: LogRecord) => r?.at ?? new Date(updatedMs ?? 0).toISOString();
  return { id, cwd: meta?.cwd ?? '', ...(meta?.branch ? { branch: meta.branch } : {}), title: (firstUser?.text ?? '').replace(/\s+/g, ' ').trim().slice(0, 80) || 'Untitled', created_at: at(records[0]), updated_at: updatedMs !== undefined ? new Date(updatedMs).toISOString() : at(records.at(-1)), message_count: records.filter((r) => r.type === 'user.message' || r.type === 'text.done').length, engines: [...new Set(engineSessions.map((e) => e.engine))], ...(model?.model ? { last_model: model.model } : {}), engine_sessions: engineSessions };
}
/** The last `max` messages as plain text, at most `bytes` (the newest kept), for a fresh engine session to continue from. */
export function summaryText(records: LogRecord[], max = 40, bytes = 8 * 1024): string {
  const msgs = records.filter((r) => r.type === 'user.message' || r.type === 'text.done').slice(-max).map((r) => `${r.type === 'user.message' ? 'User' : 'Assistant'}: ${String((r.data as { text?: string }).text ?? '').trim()}`);
  let out = msgs.join('\n\n'); while (Buffer.byteLength(out) > bytes && msgs.length > 1) { msgs.shift(); out = msgs.join('\n\n'); }
  return cut(out, bytes);
}

export function createSessionStore(d: StoreDeps): SessionStore {
  const L: Limits = { ...LIMITS, ...d.limits }; const clock = d.clock ?? realClock; const alive = d.alive ?? pidAlive;
  const root = join(d.dataDir, 'sessions'); const indexPath = join(root, 'index.json');
  const dirOf = (id: string) => { if (!SESSION_ID.test(id)) throw new SessionNotFound(id); return join(root, id); };
  let index: Map<string, SessionSummary> | undefined;

  function writeIndex() { if (!index) return; ensureDir(root); const tmp = `${indexPath}.${process.pid}.tmp`; writeFileSync(tmp, JSON.stringify({ v: 1, sessions: [...index.values()] }), { mode: 0o600 }); renameSync(tmp, indexPath); }
  function rebuild(): Map<string, SessionSummary> {
    const m = new Map<string, SessionSummary>(); if (!existsSync(root)) return m;
    for (const id of readdirSync(root)) { if (!SESSION_ID.test(id)) continue; try { const dir = join(root, id); const segs = segments(dir); if (!segs.length) continue; const { records } = readLog(dir, (line) => SUMMARY_TYPES.some((t) => line.includes(t))); const last = segs.at(-1)!; const total = countTextDone(segs); const s = summarise(id, records, statSync(last).mtimeMs); s.message_count += total; s.created_at = records[0]?.at ?? s.created_at; m.set(id, s); } catch (e) { d.log?.debug('session.index_skip', { err: (e as Error).name }); } }
    return m;
  }
  function countTextDone(segs: string[]) { let n = 0; for (const p of segs) { const t = readFileSync(p, 'utf8'); let i = -1; while ((i = t.indexOf('"type":"text.done"', i + 1)) >= 0) n++; } return n; }
  function loadIndex(): Map<string, SessionSummary> {
    if (index) return index;
    try { const j = JSON.parse(readFileSync(indexPath, 'utf8')) as { sessions: SessionSummary[] }; index = new Map(j.sessions.map((s) => [s.id, s])); }
    catch { index = rebuild(); try { writeIndex(); } catch { /* read-only disk: the index is rebuilt next time */ } }
    return index;
  }

  function handle(id: string, init?: { cwd: string; branch?: string }): SessionHandle {
    const dir = dirOf(id); ensureDir(dir); const release = takeLock(dir, alive);
    const existing = readLog(dir); let n = existing.records.reduce((a, r) => Math.max(a, r.n), 0); let seg = Math.max(0, segments(dir).length - 1); let size = existing.bytes;
    let summary = summarise(id, existing.records); let buf: string[] = []; let bufBytes = 0; let timer: unknown; let failed = false; let closed = false;
    const lastSeg = segments(dir).at(-1); if (lastSeg && size > 0 && !readFileSync(lastSeg, 'utf8').endsWith('\n')) appendLines(lastSeg, ['\n']); // a torn line stays as it is; new records start on a fresh line
    const engines: EngineSessionRef[] = [...summary.engine_sessions];
    const push = (type: string, data: unknown, agentId?: string) => {
      if (closed) return; const rec: LogRecord = { n: ++n, at: new Date(clock.now()).toISOString(), ...(agentId ? { agent_id: agentId } : {}), type, data: scrub(data, L.fieldBytes, d.redact) };
      let line = JSON.stringify(rec) + '\n'; if (Buffer.byteLength(line) > L.lineBytes) line = JSON.stringify({ ...rec, data: { truncated: true } }) + '\n';
      buf.push(line); bufBytes += Buffer.byteLength(line);
      while (buf.length > L.bufferRecords || bufBytes > L.bufferBytes) { bufBytes -= Buffer.byteLength(buf.shift()!); } // only while the disk refuses writes: the oldest unsaved records go
      const r = rec as LogRecord; if (type === 'user.message' && summary.title === 'Untitled') summary.title = String((r.data as { text?: string }).text ?? '').replace(/\s+/g, ' ').trim().slice(0, 80) || 'Untitled';
      if (type === 'user.message' || type === 'text.done') summary.message_count++; if (type === 'session.started') summary.last_model = (r.data as { model?: string }).model ?? summary.last_model;
      summary.updated_at = r.at;
      if (buf.length >= L.flushRecords) flushNow(); else if (!timer) timer = clock.setTimeout(() => { timer = undefined; flushNow(); }, L.flushMs);
    };
    function flushNow() {
      if (timer) { clock.clearTimeout(timer); timer = undefined; } if (!buf.length) return;
      try {
        const lines = buf; let path = join(dir, segmentName(seg)); const chunk = lines.join(''); const cb = Buffer.byteLength(chunk);
        if (size > 0 && size + cb > L.segmentBytes) { seg++; path = join(dir, segmentName(seg)); size = 0; }
        size = appendLines(path, [chunk]); buf = []; bufBytes = 0; failed = false;
        const idx = loadIndex(); idx.set(id, { ...summary, engine_sessions: [...engines], engines: [...new Set(engines.map((e) => e.engine))] }); writeIndex();
      } catch (e) { if (!failed) { failed = true; d.bus?.emit('session.persist_failed', { session_id: id, code: (e as NodeJS.ErrnoException).code ?? 'EIO' }); d.log?.warn('session.persist_failed', { code: (e as NodeJS.ErrnoException).code }); } }
    }
    if (init) { summary.cwd = init.cwd; if (init.branch) summary.branch = init.branch; summary.created_at = new Date(clock.now()).toISOString(); push('session.meta', { cwd: init.cwd, ...(init.branch ? { branch: init.branch } : {}) }); } else if (existing.torn) push('recovered', { reason: 'torn_line' });
    const h: SessionHandle = {
      id,
      append(ev) { const { v: _v, seq: _s, ts: _t, agent_id, type, ...data } = ev as NormalisedEvent & Record<string, unknown>; void _v; void _s; void _t; push(type, data, agent_id as string | undefined); if (type === 'session.started') { const e = data as { engine?: EngineName; engine_session_id?: string }; if (e.engine && e.engine_session_id && engines.at(-1)?.engineSessionId !== e.engine_session_id) h.recordEngineSession({ engine: e.engine, engineSessionId: e.engine_session_id, sinceSeq: n }); } },
      note: (type, data, agentId) => push(type, data, agentId),
      recordEngineSession(m) { engines.push(m); push('engine.session', m); },
      async markRewind(toSeq) { push('rewind', { to: toSeq }); flushNow(); },
      async flush() { flushNow(); },
      async close() { if (closed) return; flushNow(); closed = true; release(); exitHooks.delete(h); },
      saveView(view) { try { const p = join(dir, 'view.json'); const tmp = `${p}.tmp`; writeFileSync(tmp, JSON.stringify(view), { mode: 0o600 }); renameSync(tmp, p); } catch (e) { d.log?.warn('session.view_failed', { code: (e as NodeJS.ErrnoException).code }); } },
    };
    exitHooks.add(h);
    return h;
  }
  function openSync(id: string): LoadedSession {
    const dir = dirOf(id); if (!segments(dir).length) throw new SessionNotFound(id); const { records, torn } = readLog(dir);
    const s = summarise(id, records); const idx = index?.get(id); if (idx) s.updated_at = idx.updated_at > s.updated_at ? idx.updated_at : s.updated_at;
    return { id, records, engineSessions: s.engine_sessions, summary: s, recovered: torn };
  }
  function listSync(q: { cwd?: string; limit?: number } = {}): SessionSummary[] {
    const idx = loadIndex(); let changed = false;
    for (const id of [...idx.keys()]) if (!segments(join(root, id)).length) { idx.delete(id); changed = true; d.log?.debug('session.index_stale'); }
    if (changed) try { writeIndex(); } catch { /* next time */ }
    return [...idx.values()].filter((s) => !q.cwd || s.cwd === q.cwd).sort((a, b) => (a.updated_at < b.updated_at ? 1 : a.updated_at > b.updated_at ? -1 : 0)).slice(0, q.limit ?? 20);
  }
  function removeSync(id: string) { const dir = dirOf(id); if (lockHolder(dir, alive)) throw new Error('session in use'); rmSync(dir, { recursive: true, force: true }); loadIndex().delete(id); writeIndex(); }
  const sync: SessionStore['sync'] = {
    create: (init) => handle(init.id ?? newId('ses', clock.now()), init), resume: (id) => { if (!segments(dirOf(id)).length) throw new SessionNotFound(id); return handle(id); },
    open: openSync, list: listSync, remove: removeSync,
    loadView: (id) => { try { return JSON.parse(readFileSync(join(dirOf(id), 'view.json'), 'utf8')); } catch { return undefined; } },
  };
  return {
    dir: root, sync,
    create: async (init) => sync.create(init), resume: async (id) => sync.resume(id), open: async (id) => openSync(id), list: async (q) => listSync(q), remove: async (id) => removeSync(id),
    async prune(now) {
      const days = d.retentionDays ?? 30; const cutoff = now.getTime() - days * 86_400_000; let removed = 0;
      for (const s of listSync({ limit: Number.MAX_SAFE_INTEGER })) { if (Date.parse(s.updated_at) >= cutoff) continue; const dir = join(root, s.id); if (lockHolder(dir, alive)) continue; rmSync(dir, { recursive: true, force: true }); loadIndex().delete(s.id); removed++; }
      if (removed) writeIndex(); return { removed };
    },
    async toSnapshotEvents(id, o = {}) {
      const { records } = openSync(id); const from = o.fromSeq ?? 0;
      return records.filter((r) => r.n >= from && !NOT_EVENTS.has(r.type)).map((r) => scrub({ v: 1, seq: r.n, ts: r.at, ...(r.agent_id ? { agent_id: r.agent_id } : {}), type: r.type, ...(r.data as object) }, L.fieldBytes, d.redact) as NormalisedEvent);
    },
  };
}

/** Open handles are flushed and their locks released when the process exits normally or is stopped. */
const exitHooks = new Set<SessionHandle>(); let hooked = false;
function hook() { if (hooked) return; hooked = true; const flushAll = () => { for (const h of exitHooks) void h.close(); }; process.once('exit', flushAll); }
hook();
