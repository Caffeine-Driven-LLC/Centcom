/** The durable usage spool: `<state dir>/usage/spool.jsonl`, mode 0600. One JSON object per line:
 *  an event (`{id, type, qty, at, session_id?, agent_id?}`), a batch assignment (`{batch, ids, sha}`) or an acknowledgement (`{ack}`).
 *  Appends are synchronous so a crash right after `append()` loses nothing; a half-written last line is dropped on the next open.
 *  Bounded: at most 10,000 events and 5 MiB (oldest unbatched events dropped first, counted in `dropped`). If the disk cannot be
 *  written it falls back to memory only, capped at 1,000 events.
 *  Must not: hold anything but the six usage fields, merge or re-split a batch that was given a key, or grow without a bound. */
import { closeSync, mkdirSync, openSync, readFileSync, renameSync, chmodSync, writeFileSync, writeSync, statSync } from 'node:fs';
import { createHash, randomBytes } from 'node:crypto';
import { join } from 'node:path';
import { isId } from '@centcom/protocol';
import type { Logger } from '../log/index.js';

/** One usage event as CT-API-USAGE carries it. `qty` is a non-negative integer. Nothing else may be added. */
export interface UsageEvent { id: string; type: 'agent_minutes' | 'tokens_in' | 'tokens_out'; qty: number; at: string; session_id?: string; agent_id?: string }
export const USAGE_TYPES: ReadonlySet<string> = new Set(['agent_minutes', 'tokens_in', 'tokens_out']);
export const USAGE_ID_RE = /^use_[0-9A-HJKMNP-TV-Z]{26}$/;
export const SPOOL_MAX_EVENTS = 10_000;
export const SPOOL_MAX_BYTES = 5 * 1024 * 1024;
/** The cap when the disk cannot be written. */
export const MEMORY_MAX_EVENTS = 1_000;
/** A spool file larger than this is not read back (it cannot be ours: compaction keeps it near SPOOL_MAX_BYTES). */
const MAX_READ_BYTES = 4 * SPOOL_MAX_BYTES;
/** Batch and ack lines accumulate; past this many lines the file is rewritten. */
const MAX_FILE_LINES = SPOOL_MAX_EVENTS * 2;

/** A batch ready to send: its key, its events in their original order, and the exact body. */
export interface ReadyBatch { key: string; events: UsageEvent[]; body: { events: UsageEvent[] }; bytes: number; sha: string; /** the body differs from the one the key was first given for (events were lost in a crash or to the cap) */ changed: boolean }
interface Entry { e: UsageEvent; bytes: number }
interface Batch { key: string; ids: string[]; sha: string }

/** Keep only the six documented fields, each checked; anything else makes the event invalid. */
export function cleanEvent(x: unknown): UsageEvent | undefined {
  if (!x || typeof x !== 'object') return undefined; const o = x as Record<string, unknown>;
  if (typeof o.id !== 'string' || !USAGE_ID_RE.test(o.id) || typeof o.type !== 'string' || !USAGE_TYPES.has(o.type)) return undefined;
  if (typeof o.qty !== 'number' || !Number.isInteger(o.qty) || o.qty < 0 || o.qty > Number.MAX_SAFE_INTEGER) return undefined;
  if (typeof o.at !== 'string' || !Number.isFinite(Date.parse(o.at))) return undefined;
  const e: UsageEvent = { id: o.id, type: o.type as UsageEvent['type'], qty: o.qty, at: o.at };
  if (o.session_id !== undefined) { if (!isId('ses', o.session_id)) return undefined; e.session_id = o.session_id; }
  if (o.agent_id !== undefined) { if (!isId('agt', o.agent_id)) return undefined; e.agent_id = o.agent_id; }
  return e;
}

const sha = (text: string): string => createHash('sha256').update(text).digest('hex');
const bodyText = (events: UsageEvent[]): string => JSON.stringify({ events });

export class UsageSpool {
  readonly path: string;
  /** events dropped to stay inside the caps */
  dropped = 0;
  private readonly entries = new Map<string, Entry>(); /* insertion order is age order */
  private batches: Batch[] = [];
  private readonly batched = new Map<string, string>(); /* event id -> batch key */
  private bytes = 0; private fileLines = 0; private fileBytes = 0;
  private fd: number | undefined; private opened = false; private memoryOnly = false; private compactPending = false;
  private readonly maxEvents: number; private readonly maxBytes: number;

  constructor(private readonly dir: string, private readonly o: { logger?: Logger; maxEvents?: number; maxBytes?: number } = {}) {
    this.path = join(dir, 'spool.jsonl'); this.maxEvents = o.maxEvents ?? SPOOL_MAX_EVENTS; this.maxBytes = o.maxBytes ?? SPOOL_MAX_BYTES;
  }

  /** Events waiting (batched or not). */
  size(): number { return this.entries.size; }
  /** Events not yet given to a batch. */
  unbatched(): number { return this.entries.size - this.batched.size; }
  /** True after a disk failure: events live in memory only (cap 1,000). */
  isMemoryOnly(): boolean { return this.memoryOnly; }

  /** Read what a previous run left (complete lines only), drop what is over the caps, and rewrite the file. Idempotent; never throws. */
  open(): void {
    if (this.opened) return; this.opened = true;
    try { mkdirSync(this.dir, { recursive: true, mode: 0o700 }); } catch { this.toMemory('mkdir'); return; }
    let text = '';
    try { if (statSync(this.path).size <= MAX_READ_BYTES) text = readFileSync(this.path, 'utf8'); } catch { text = ''; }
    const lines = text.split('\n'); if (!text.endsWith('\n')) lines.pop(); /* a crash mid-write leaves a partial last line: drop it */
    for (const line of lines) {
      if (!line) continue; let x: unknown; try { x = JSON.parse(line); } catch { continue; }
      const r = x as { batch?: unknown; ids?: unknown; sha?: unknown; ack?: unknown };
      if (typeof r.ack === 'string') { this.removeBatch(r.ack, true); continue; }
      if (typeof r.batch === 'string' && Array.isArray(r.ids) && typeof r.sha === 'string') { this.addBatch({ key: r.batch, ids: r.ids.filter((i): i is string => typeof i === 'string'), sha: r.sha }); continue; }
      const e = cleanEvent(x); if (e && !this.entries.has(e.id)) this.put(e);
    }
    for (const b of [...this.batches]) { b.ids = b.ids.filter((id) => this.entries.has(id)); if (!b.ids.length) this.removeBatch(b.key, false); }
    this.enforceCaps();
    this.compact();
  }

  /** Add one event (synchronous). A duplicate id is ignored. */
  append(e: UsageEvent): void {
    this.open(); if (this.entries.has(e.id)) return;
    const line = JSON.stringify(e); this.put(e, line.length + 1);
    if (!this.memoryOnly) this.write(line + '\n');
    if (this.enforceCaps() || this.fileBytes > this.maxBytes || this.fileLines > MAX_FILE_LINES) this.scheduleCompact();
  }

  /** The batch to send next: the oldest one already keyed (resent unchanged), else a new one of the oldest events
   *  (at most `maxEvents` and `maxBytes` of body), keyed with `newKey()` and written down before it is sent. */
  next(maxEvents: number, maxBytes: number, newKey: () => string): ReadyBatch | undefined {
    this.open();
    const pending = this.batches[0];
    if (pending) {
      const events = pending.ids.map((id) => this.entries.get(id)?.e).filter((e): e is UsageEvent => !!e);
      if (!events.length) { this.removeBatch(pending.key, true); return this.next(maxEvents, maxBytes, newKey); }
      const text = bodyText(events); const s = sha(text);
      return { key: pending.key, events, body: { events }, bytes: Buffer.byteLength(text), sha: s, changed: s !== pending.sha };
    }
    const events: UsageEvent[] = []; let bytes = bodyText([]).length;
    for (const [id, en] of this.entries) {
      if (this.batched.has(id)) continue; if (events.length >= maxEvents) break;
      const add = Buffer.byteLength(JSON.stringify(en.e)) + (events.length ? 1 : 0); if (bytes + add > maxBytes) break;
      events.push(en.e); bytes += add;
    }
    if (!events.length) return undefined;
    const text = bodyText(events); const b: Batch = { key: newKey(), ids: events.map((e) => e.id), sha: sha(text) };
    this.addBatch(b); if (!this.memoryOnly) this.write(JSON.stringify({ batch: b.key, ids: b.ids, sha: b.sha }) + '\n');
    return { key: b.key, events, body: { events }, bytes: Buffer.byteLength(text), sha: b.sha, changed: false };
  }

  /** The batch is done (sent, or dropped as poison): its events leave the spool. */
  ack(key: string): void {
    if (!this.batches.some((b) => b.key === key)) return;
    this.removeBatch(key, true); if (!this.memoryOnly) this.write(JSON.stringify({ ack: key }) + '\n');
    if (this.fileLines > MAX_FILE_LINES || (this.entries.size === 0 && this.fileLines > 0)) this.scheduleCompact();
  }

  /** Give a batch a new key for the same events (only after a 409 when its body changed). The body stays as it is now. */
  rekey(oldKey: string, newKey: string): void {
    const b = this.batches.find((x) => x.key === oldKey); if (!b) return;
    const ids = b.ids.filter((id) => this.entries.has(id)); const s = sha(bodyText(ids.map((id) => this.entries.get(id)!.e)));
    b.key = newKey; b.ids = ids; b.sha = s; for (const id of ids) this.batched.set(id, newKey);
    if (!this.memoryOnly) this.write(JSON.stringify({ batch: newKey, ids, sha: s }) + '\n');
  }

  /** Rewrite the file from memory (atomic: temp file, then rename), mode 0600. */
  compact(): void {
    this.compactPending = false; if (this.memoryOnly) return;
    const lines: string[] = [];
    for (const en of this.entries.values()) lines.push(JSON.stringify(en.e));
    for (const b of this.batches) lines.push(JSON.stringify({ batch: b.key, ids: b.ids, sha: b.sha }));
    const text = lines.length ? lines.join('\n') + '\n' : '';
    const tmp = `${this.path}.${randomBytes(4).toString('hex')}.tmp`;
    try {
      writeFileSync(tmp, text, { mode: 0o600 }); renameSync(tmp, this.path); chmodSync(this.path, 0o600);
      if (this.fd !== undefined) { try { closeSync(this.fd); } catch { /* already closed */ } }
      this.fd = openSync(this.path, 'a', 0o600); this.fileLines = lines.length; this.fileBytes = Buffer.byteLength(text);
    } catch { this.toMemory('compact'); }
  }

  /** Close the file (the spool stays on disk for the next run). */
  close(): void {
    if (this.compactPending) this.compact();
    if (this.fd !== undefined) { try { closeSync(this.fd); } catch { /* already closed */ } this.fd = undefined; }
    this.opened = false; this.entries.clear(); this.batches = []; this.batched.clear(); this.bytes = 0;
  }

  private put(e: UsageEvent, bytes = JSON.stringify(e).length + 1): void { this.entries.set(e.id, { e, bytes }); this.bytes += bytes; }
  private addBatch(b: Batch): void {
    for (const id of b.ids) { const prev = this.batched.get(id); if (prev && prev !== b.key) { const pb = this.batches.find((x) => x.key === prev); if (pb) pb.ids = pb.ids.filter((x) => x !== id); } this.batched.set(id, b.key); }
    this.batches = this.batches.filter((x) => x.key !== b.key && x.ids.length > 0); this.batches.push(b);
  }
  private removeBatch(key: string, dropEvents: boolean): void {
    const b = this.batches.find((x) => x.key === key); if (!b) return; this.batches = this.batches.filter((x) => x !== b);
    for (const id of b.ids) { if (this.batched.get(id) !== key) continue; this.batched.delete(id); if (dropEvents) { const en = this.entries.get(id); if (en) { this.bytes -= en.bytes; this.entries.delete(id); } } }
  }
  /** Drop the oldest unbatched events (batched ones only if nothing else is left) until inside the caps. True when something was dropped. */
  private enforceCaps(): boolean {
    const maxN = this.memoryOnly ? Math.min(this.maxEvents, MEMORY_MAX_EVENTS) : this.maxEvents; let any = false;
    while (this.entries.size > maxN || this.bytes > this.maxBytes) {
      let victim: string | undefined; for (const id of this.entries.keys()) if (!this.batched.has(id)) { victim = id; break; }
      victim ??= this.entries.keys().next().value; if (victim === undefined) break;
      const en = this.entries.get(victim)!; this.entries.delete(victim); this.bytes -= en.bytes; this.dropped++; any = true;
      const k = this.batched.get(victim); if (k) { this.batched.delete(victim); const b = this.batches.find((x) => x.key === k); if (b) b.ids = b.ids.filter((x) => x !== victim); }
    }
    if (any && this.dropped % 1000 === 1) this.o.logger?.warn('usage.spool_full', { dropped: this.dropped });
    return any;
  }
  private write(text: string): void {
    if (this.fd === undefined) { try { this.fd = openSync(this.path, 'a', 0o600); } catch { this.toMemory('open'); return; } }
    try { writeSync(this.fd, text); this.fileLines++; this.fileBytes += Buffer.byteLength(text); } catch { this.toMemory('write'); }
  }
  /** Compaction runs after the current call returns, so `append()` stays fast. */
  private scheduleCompact(): void { if (this.compactPending || this.memoryOnly) return; this.compactPending = true; setImmediate(() => { if (this.compactPending && this.opened) this.compact(); }); }
  private toMemory(where: string): void {
    if (this.memoryOnly) return; this.memoryOnly = true; this.o.logger?.warn('usage.spool_unwritable', { where });
    if (this.fd !== undefined) { try { closeSync(this.fd); } catch { /* already closed */ } this.fd = undefined; }
    this.enforceCaps();
  }
}
