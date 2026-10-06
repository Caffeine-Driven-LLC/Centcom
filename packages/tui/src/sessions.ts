/** Saved conversations, so closing the app never loses work. One folder per user, two small files per session:
 *  <id>.meta.json (cheap to list) and <id>.items.json (the transcript). Writes are atomic and private (0600). */
import { existsSync, mkdirSync, readFileSync, readdirSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import type { Item } from './state/model.js';

export interface SessionMeta {
  id: string; cwd: string; engine: string; title: string; model?: string;
  /** What the engine needs to continue the same conversation (claude --resume id, codex thread id). */
  resumeToken?: string; createdAt: number; updatedAt: number; messages: number;
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

export class SessionStore {
  constructor(readonly dir = join(homedir(), '.centcom', 'sessions')) {}
  private ensure() { mkdirSync(this.dir, { recursive: true, mode: 0o700 }); }
  private write(path: string, data: unknown) { const tmp = path + '.tmp'; writeFileSync(tmp, JSON.stringify(data), { mode: 0o600 }); renameSync(tmp, path); }

  save(meta: SessionMeta, items: Item[]) { this.ensure(); this.write(join(this.dir, `${meta.id}.items.json`), sanitizeItems(items)); this.write(join(this.dir, `${meta.id}.meta.json`), meta); }

  /** Newest first. Only sessions started in this folder unless `cwd` is omitted. */
  list(cwd?: string, limit = 20): SessionMeta[] {
    if (!existsSync(this.dir)) return [];
    const out: SessionMeta[] = [];
    for (const f of readdirSync(this.dir)) {
      if (!f.endsWith('.meta.json')) continue;
      try { const m = JSON.parse(readFileSync(join(this.dir, f), 'utf8')) as SessionMeta; if (m.id && (!cwd || m.cwd === cwd)) out.push(m); } catch { /* skip a damaged file */ }
    }
    return out.sort((a, b) => b.updatedAt - a.updatedAt).slice(0, limit);
  }

  load(id: string): { meta: SessionMeta; items: Item[] } | undefined {
    if (!/^[\w-]+$/.test(id)) return undefined; // ids are ours; never let one escape the folder
    try { return { meta: JSON.parse(readFileSync(join(this.dir, `${id}.meta.json`), 'utf8')), items: sanitizeItems(JSON.parse(readFileSync(join(this.dir, `${id}.items.json`), 'utf8'))) }; } catch { return undefined; }
  }

  delete(id: string) { if (/^[\w-]+$/.test(id)) for (const s of ['meta', 'items']) rmSync(join(this.dir, `${id}.${s}.json`), { force: true }); }
}

export function ago(ms: number, now = Date.now()): string {
  const s = Math.max(0, Math.round((now - ms) / 1000));
  if (s < 60) return 'just now'; const m = Math.round(s / 60); if (m < 60) return `${m} min ago`; const h = Math.round(m / 60); if (h < 24) return `${h} h ago`; const d = Math.round(h / 24); return `${d} day${d === 1 ? '' : 's'} ago`;
}
