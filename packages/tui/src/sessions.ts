import { existsSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import { SESSION_ID, createSessionStore, newId, type LogRecord, type NormalisedEvent, type SessionHandle, type SessionStore as PersistStore, type SessionSummary } from '@centcom/agent';
import { stateDir } from '@centcom/config';
import { homedir } from 'node:os';
import { join } from 'node:path';
import type { Item } from './state/model.js';
import { sanitizeForTerminal } from './transcript/sanitize.js';

export interface SessionMeta {
  id: string; cwd: string; engine: string; title: string; model?: string;
  /** What the engine needs to continue the same conversation (claude --resume id, codex thread id). */
  resumeToken?: string; createdAt: number; updatedAt: number; messages: number;
  /** The agent's last plan and whether its panel was open (ctrl+t), so a resumed conversation looks the same. */
  tasks?: { id: string; text: string; status: 'pending' | 'in_progress' | 'completed' }[]; tasksOpen?: boolean;
}

const MAX_RESULT = 4000, MAX_DIFF = 20000, MAX_ITEMS = 2000;

/** Keep files small and make sure nothing half-finished is replayed as if it were still running. */
export function sanitizeItems(items: Item[]): Item[] {
  return items.filter((it) => !(it.kind === 'notice' && it.text.startsWith('Continuing "'))).slice(-MAX_ITEMS).map((it): Item => {
    if (it.kind === 'tool') return { ...it, status: it.status === 'running' ? 'canceled' : it.status, approval: it.approval === 'pending' ? undefined : it.approval, ...(it.result ? { result: it.result.slice(0, MAX_RESULT) } : {}), ...(it.diff ? { diff: it.diff.slice(0, MAX_DIFF) } : {}) };
    if (it.kind === 'assistant') return { ...it, done: true };
    if (it.kind === 'thinking') return { ...it, done: true };
    return it;
  });
}

export const titleFrom = (items: Item[]): string => {
  const first = items.find((i) => i.kind === 'user');
  return first && first.kind === 'user' ? first.text.replace(/\s+/g, ' ').trim().slice(0, 80) || 'Untitled' : 'Untitled';
};

/** Saved conversations, kept by the session log of lane C026 (`<data>/sessions/<id>/log.jsonl`, append-only, redacted, locked).
 *  The app also keeps a `view.json` beside each log so a resumed conversation looks exactly as it did; without it the
 *  transcript is rebuilt from the log. Conversations saved by older versions (`<id>.meta.json` + `<id>.items.json`) are moved over once. */
export class SessionStore {
  private store: PersistStore; private handles = new Map<string, SessionHandle>(); private blocked = new Set<string>();
  readonly dir: string;
  constructor(dataDir = stateDir({ env: process.env, homedir: homedir() })) { this.store = createSessionStore({ dataDir }); this.dir = this.store.dir; this.migrate(); }

  private handle(id: string, cwd: string): SessionHandle | undefined {
    if (!SESSION_ID.test(id) || this.blocked.has(id)) return undefined; let h = this.handles.get(id); if (h) return h;
    try { h = existsSync(join(this.dir, id, 'log.jsonl')) ? this.store.sync.resume(id) : this.store.sync.create({ cwd, id }); }
    catch (e) { if ((e as { code?: string }).code === 'session_in_use') this.blocked.add(id); throw e; } // said once; after that this window just does not save it
    this.handles.set(id, h); return h;
  }
  /** Every normalised event of the conversation, as it happens. */
  append(id: string, cwd: string, ev: NormalisedEvent) { try { this.handle(id, cwd)?.append(ev); } catch { /* another Centcom has it open: this one goes on without saving */ } }
  /** What the person typed. */
  noteUser(id: string, cwd: string, text: string) { try { this.handle(id, cwd)?.note('user.message', { text }); const k = this.known.get(id); if (k) k.hasUser = true; } catch { /* as above */ } }
  /** What the log already holds, read once per conversation: parsing the whole log on every save made long conversations stutter. */
  private known = new Map<string, { engine?: string; token?: string; hasUser: boolean }>();

  save(meta: SessionMeta, items: Item[]) {
    const h = this.handle(meta.id, meta.cwd); if (!h) return; void h.flush(); // flushes at once, so the log exists before it is read
    let k = this.known.get(meta.id);
    if (!k) { const open = this.store.sync.open(meta.id); const last = open.engineSessions.at(-1); k = { engine: last?.engine, token: last?.engineSessionId, hasUser: open.records.some((r) => r.type === 'user.message') }; this.known.set(meta.id, k); }
    if (meta.resumeToken && (meta.engine === 'claude-code' || meta.engine === 'codex') && (k.token !== meta.resumeToken || k.engine !== meta.engine)) { h.recordEngineSession({ engine: meta.engine, engineSessionId: meta.resumeToken, sinceSeq: 0 }); k.engine = meta.engine; k.token = meta.resumeToken; }
    if (!k.hasUser) { for (const it of items) if (it.kind === 'user') h.note('user.message', { text: it.text }); k.hasUser = items.some((it) => it.kind === 'user'); } // older callers saved only the items
    h.saveView({ v: 1, items: sanitizeItems(items), engine: meta.engine, title: meta.title, model: meta.model, tasks: meta.tasks, tasksOpen: meta.tasksOpen, createdAt: meta.createdAt, updatedAt: meta.updatedAt, messages: meta.messages });
    void h.flush();
  }

  /** Newest first. Only sessions started in this folder unless `cwd` is omitted. */
  list(cwd?: string, limit = 20): SessionMeta[] {
    let rows: SessionSummary[]; try { rows = this.store.sync.list({ cwd, limit: Number.MAX_SAFE_INTEGER }); } catch { return []; }
    return rows.map((r) => this.metaOf(r, this.view(r.id))).sort((a, b) => b.updatedAt - a.updatedAt).slice(0, limit); // the app's own time of last use wins
  }

  load(id: string): { meta: SessionMeta; items: Item[] } | undefined {
    if (!SESSION_ID.test(id)) return undefined; // ids are ours; never let one escape the folder
    try { const s = this.store.sync.open(id); const v = this.view(id); return { meta: this.metaOf(s.summary, v), items: sanitizeItems(v?.items ?? itemsFromLog(s.records)) }; } catch { return undefined; }
  }

  delete(id: string) { if (!SESSION_ID.test(id)) return; this.known.delete(id); void this.handles.get(id)?.close(); this.handles.delete(id); try { this.store.sync.remove(id); } catch { /* in use or gone */ } }
  /** Saves what is buffered and lets other Centcom windows open the conversation. */
  close(id?: string) { for (const [k, h] of this.handles) if (!id || k === id) { void h.close(); this.handles.delete(k); } }

  private view(id: string): View | undefined { const v = this.store.sync.loadView(id) as View | undefined; return v && Array.isArray(v.items) ? v : undefined; }
  private metaOf(r: SessionSummary, v?: View): SessionMeta {
    const last = r.engine_sessions.at(-1);
    return { id: r.id, cwd: r.cwd, engine: last?.engine ?? v?.engine ?? '', title: sanitizeForTerminal(v?.title ?? r.title).replace(/\s+/g, ' ').trim(), /* a stored title is shown as it is everywhere: no control codes */ ...(v?.model !== undefined ? { model: v.model } : {}), ...(last ? { resumeToken: last.engineSessionId } : {}), createdAt: v?.createdAt ?? Date.parse(r.created_at), updatedAt: Math.max(Date.parse(r.updated_at) || 0, v?.updatedAt ?? 0), messages: v?.messages ?? r.message_count, ...(v?.tasks ? { tasks: v.tasks } : {}), ...(v?.tasksOpen !== undefined ? { tasksOpen: v.tasksOpen } : {}) };
  }
  /** Moves conversations saved by older versions into the log format, once. */
  private migrate() {
    if (!existsSync(this.dir)) return;
    for (const f of readdirSync(this.dir)) {
      if (!f.endsWith('.meta.json')) continue; const old = f.slice(0, -'.meta.json'.length);
      try {
        const meta = JSON.parse(readFileSync(join(this.dir, f), 'utf8')) as SessionMeta; const items = JSON.parse(readFileSync(join(this.dir, `${old}.items.json`), 'utf8')) as Item[];
        const id = SESSION_ID.test(meta.id) ? meta.id : newId('ses', meta.createdAt || Date.now()); this.save({ ...meta, id }, items); this.close(id);
        rmSync(join(this.dir, f), { force: true }); rmSync(join(this.dir, `${old}.items.json`), { force: true });
      } catch { /* a damaged old file stays where it is */ }
    }
  }
}
interface View { v: 1; items: Item[]; engine?: string; title?: string; model?: string; tasks?: SessionMeta['tasks']; tasksOpen?: boolean; createdAt?: number; updatedAt?: number; messages?: number }

/** A transcript rebuilt from the log alone (when no view was saved): what was said, and errors. */
export function itemsFromLog(records: LogRecord[]): Item[] {
  const out: Item[] = [];
  for (const r of records) {
    const d = r.data as Record<string, unknown>; const ts = Date.parse(r.at) || 0;
    if (r.type === 'user.message') out.push({ kind: 'user', id: `u${r.n}`, text: String(d.text ?? ''), ts });
    else if (r.type === 'text.done') out.push({ kind: 'assistant', id: `a${r.n}`, messageId: String(d.message_id ?? r.n), agentId: r.agent_id ?? '', text: String(d.text ?? ''), done: true });
    else if (r.type === 'error') out.push({ kind: 'notice', id: `n${r.n}`, level: 'error', text: String(d.tool_message ?? 'Error') });
    else if (r.type === 'rewind') { const to = Number((d as { to?: number }).to ?? 0); for (let i = out.length - 1; i >= 0; i--) if (Number(out[i]!.id.slice(1)) > to) out.splice(i, 1); }
  }
  return out;
}

export function ago(ms: number, now = Date.now()): string {
  const s = Math.max(0, Math.round((now - ms) / 1000));
  if (s < 60) return 'just now'; const m = Math.round(s / 60); if (m < 60) return `${m} min ago`; const h = Math.round(m / 60); if (h < 24) return `${h} h ago`; const d = Math.round(h / 24); return `${d} day${d === 1 ? '' : 's'} ago`;
}
