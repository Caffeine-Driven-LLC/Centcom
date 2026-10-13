import { appendFileSync, existsSync, mkdirSync, readFileSync, renameSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { newId } from '../ids.js';
import { cleanPath, cleanText, MAX_COMMANDS, MAX_FILES } from './text.js';
import { buildDigest } from './digest.js';
import { ENTRY_TYPES, type Author, type BoardChange, type Digest, type DigestOptions, type Entry, type EntryType, type PostInput } from './types.js';

const MIN = 60_000;
/** How long an entry lasts unless it says otherwise (0 = until retracted). A claim is about what an agent is doing now; a decision stays. */
export const DEFAULT_TTL: Record<EntryType, number> = { claim: 15 * MIN, finding: 120 * MIN, warning: 720 * MIN, question: 120 * MIN, answer: 120 * MIN, decision: 0 };
type Line = ({ op: 'post' } & Entry) | { op: 'retract'; id: string; ts: number } | { op: 'pin'; id: string; pinned: boolean; ts: number };
export interface BoardOptions { /** The board file (`<project>/.centcom/context/board.jsonl`). */ file: string; now?: () => number; /** Entries one agent may post per hour; people are not limited. */ perHour?: number; maxBytes?: number; budgetTokens?: number; onWarn?: (text: string) => void }
export interface Board {
  post(input: PostInput): Entry | undefined; retract(id: string, o?: { remote?: boolean }): boolean; pin(id: string, pinned: boolean, o?: { remote?: boolean }): boolean;
  /** What is on the board now: not retracted, not replaced, not expired; oldest first. */
  list(): Entry[]; get(id: string): Entry | undefined;
  /** Retract every live claim of an agent (it finished, or stopped). */ endClaims(agentId: string): number;
  /** Note files an agent is working with: what the relevance of an entry is judged against. */ touch(agentId: string, files: string[]): void; touched(agentId: string): string[];
  /** The notes this agent has not had yet and should, packed into a budget; marks them delivered. */ digest(agent: { id: string; name: string }, o?: DigestOptions): Digest | undefined;
  /** Record that these entries reached an agent by another way (the first prompt of a fleet agent). */ markDelivered(agentId: string, ids: string[]): void;
  /** Forget what an agent was told (a new session, or after compaction): everything relevant is offered again. */ resetAgent(agentId: string): void;
  /** Tells the listener about every change made through this board object (not edits another process makes to the file). */ subscribe(fn: (c: BoardChange) => void): () => void;
  readonly file: string;
}

export function createBoard(o: BoardOptions): Board {
  const now = o.now ?? Date.now; const perHour = o.perHour ?? 20; const maxBytes = o.maxBytes ?? 256 * 1024; let warned = false;
  const warn = (t: string) => { if (!warned) { warned = true; o.onWarn?.(t); } };
  let cache: { size: number; mtime: number; lines: Line[] } | undefined; let memory: Line[] = []; let writable = true;
  const fns = new Set<(c: BoardChange) => void>(); const tell = (c: BoardChange): void => { for (const f of [...fns]) { try { f(c); } catch { /* a listener must not break the board */ } } };
  const touchedFiles = new Map<string, string[]>(); const delivered = new Map<string, Set<string>>(); const posts = new Map<string, number[]>();

  const read = (): Line[] => {
    if (!writable) return memory;
    try {
      if (!existsSync(o.file)) { cache = undefined; return memory; }
      const st = statSync(o.file); if (cache && cache.size === st.size && cache.mtime === st.mtimeMs) return cache.lines;
      const lines: Line[] = []; for (const l of readFileSync(o.file, 'utf8').split('\n').slice(-5000)) { if (!l.trim()) continue; try { const j = JSON.parse(l) as Line; if (j && typeof j === 'object' && (j.op === 'post' || j.op === 'retract' || j.op === 'pin') && typeof j.id === 'string') lines.push(j); } catch { /* a damaged line is skipped */ } }
      cache = { size: st.size, mtime: st.mtimeMs, lines }; return lines;
    } catch { return memory; }
  };
  const write = (l: Line): void => {
    memory.push(l); if (memory.length > 2000) memory = memory.slice(-1000);
    if (!writable) return;
    try { mkdirSync(dirname(o.file), { recursive: true, mode: 0o700 }); const ig = join(dirname(o.file), '.gitignore'); if (!existsSync(ig)) writeFileSync(ig, '*\n', { mode: 0o600 }); /* the folder ignores itself, so the board never shows up in git status */ appendFileSync(o.file, JSON.stringify(l) + '\n', { mode: 0o600 }); cache = undefined; if (existsSync(o.file) && statSync(o.file).size > maxBytes) compact(); }
    catch { writable = false; warn('The context board cannot be saved in this folder, so it lasts for this run only.'); }
  };
  /** The live entries after the lines are applied in order. */
  const resolve = (lines: Line[]): Entry[] => {
    const m = new Map<string, Entry>(); const t = now();
    for (const l of lines) { if (l.op === 'post') { const { op: _op, ...e } = l; m.set(e.id, e as Entry); if (e.supersedes) m.delete(e.supersedes); } else if (l.op === 'retract') m.delete(l.id); else { const e = m.get(l.id); if (e) m.set(l.id, { ...e, pinned: l.pinned, ...(l.pinned ? { expires: undefined } : {}) }); } }
    return [...m.values()].filter((e) => e.pinned || !e.expires || e.expires > t).sort((a, b) => a.ts - b.ts || a.id.localeCompare(b.id));
  };
  const compact = (): void => { // keep only what is live, in a new file moved over the old one
    try { const live = resolve(read()); const tmp = `${o.file}.tmp`; writeFileSync(tmp, live.map((e) => JSON.stringify({ op: 'post', ...e })).join('\n') + (live.length ? '\n' : ''), { mode: 0o600 }); renameSync(tmp, o.file); cache = undefined; } catch { /* the next write tries again */ }
  };
  const list = (): Entry[] => resolve(read());
  const sameAuthor = (a: Author, b: Author) => a.kind === b.kind && a.id === b.id;

  const board: Board = {
    file: o.file,
    subscribe(fn) { fns.add(fn); return () => { fns.delete(fn); }; },
    post(input) {
      if (!ENTRY_TYPES.includes(input.type)) return undefined; const author: Author = { kind: input.author.kind, id: cleanText(input.author.id, 80), name: cleanText(input.author.name, 60) || 'agent', ...(input.author.engine ? { engine: cleanText(input.author.engine, 30) } : {}), ...(input.author.role ? { role: cleanText(input.author.role, 20) } : {}) };
      const text = cleanText(input.text); if (!text || !author.id) return undefined;
      const files = [...new Set((input.files ?? []).map(cleanPath).filter((x): x is string => !!x))].slice(0, MAX_FILES); const commands = (input.commands ?? []).map((c) => cleanText(c, 120)).filter(Boolean).slice(0, MAX_COMMANDS);
      if (input.type === 'claim' && !files.length) return undefined;
      const t = input.remote?.ts ?? now(); const live = list(); if (input.remote) { const known = live.find((e) => e.id === input.remote!.id); if (known) return known; }
      const same = live.find((e) => sameAuthor(e.author, author) && e.type === input.type && (input.type === 'claim' ? files.every((f) => e.refs.files.includes(f)) && e.refs.files.length === files.length : e.text.toLowerCase() === text.toLowerCase()));
      if (same) return same; // saying it again adds nothing
      if (author.kind === 'agent') { const recent = (posts.get(author.id) ?? []).filter((x) => t - x < 60 * MIN); if (recent.length >= perHour) return undefined; recent.push(t); posts.set(author.id, recent); }
      const ttl = input.ttlMs ?? DEFAULT_TTL[input.type]; const pinned = !!input.pinned;
      const e: Entry = { id: input.remote?.id ?? newId('ctx', t), ts: t, author, type: input.type, text, refs: { files, commands }, scope: input.scope ?? 'fleet', pinned, ...(ttl > 0 && !pinned ? { expires: t + ttl } : {}), ...(input.supersedes ? { supersedes: input.supersedes } : {}), ...(input.remote ? { shared: true } : {}) };
      write({ op: 'post', ...e }); tell({ op: 'post', entry: e, remote: !!input.remote }); return e;
    },
    retract(id, r) { if (!list().some((e) => e.id === id)) return false; write({ op: 'retract', id, ts: now() }); tell({ op: 'retract', id, remote: !!r?.remote }); return true; },
    pin(id, pinned, r) { if (!list().some((e) => e.id === id)) return false; write({ op: 'pin', id, pinned, ts: now() }); tell({ op: 'pin', id, pinned, remote: !!r?.remote }); return true; },
    list, get: (id) => list().find((e) => e.id === id),
    endClaims(agentId) { let n = 0; for (const e of list()) if (e.type === 'claim' && e.author.kind === 'agent' && e.author.id === agentId) { write({ op: 'retract', id: e.id, ts: now() }); n++; } return n; },
    touch(agentId, files) { const cur = touchedFiles.get(agentId) ?? []; for (const f of files.map(cleanPath)) if (f) { const i = cur.indexOf(f); if (i >= 0) cur.splice(i, 1); cur.push(f); } touchedFiles.set(agentId, cur.slice(-30)); },
    touched: (agentId) => [...(touchedFiles.get(agentId) ?? [])],
    digest(agent, d) {
      const got = delivered.get(agent.id) ?? new Set<string>(); const r = buildDigest({ entries: list(), agent, touched: touchedFiles.get(agent.id) ?? [], delivered: got, now: now(), budgetTokens: d?.budgetTokens ?? o.budgetTokens ?? 500 });
      if (!r) return undefined; for (const id of r.ids) got.add(id); delivered.set(agent.id, got); return r;
    },
    markDelivered(agentId, ids) { const got = delivered.get(agentId) ?? new Set<string>(); for (const id of ids) got.add(id); delivered.set(agentId, got); },
    resetAgent(agentId) { delivered.delete(agentId); },
  };
  return board;
}
