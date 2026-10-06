import { createHash } from 'node:crypto';
import { posix, win32 } from 'node:path';
import { assertWritableEventPayload, type PConflictDetected } from '@centcom/protocol';
import type { AgentId } from '../events/index.js';

import { canonicalKey, lexicalKey } from './path.js';
import type { Conflict, FileLockPayload, LockClient, LockDeps, LockInfo, LockResult } from './types.js';

const MAX_TTL = 600_000; const MIN_WIRE_TTL = 5_000; const REMOTE_DEFAULT_TTL = 300_000; const QUEUE_MAX = 200;
interface Held { agentId: AgentId; key: string; ttlMs: number; expiresAt: number; timer?: unknown; mac?: string }
interface Remote { agentId: string; expiresAt: number; timer?: unknown }
const parsed = (t: string) => { try { return typeof JSON.parse(t) === 'object'; } catch { return false; } };
const sha = (s: string) => createHash('sha256').update(s).digest('hex');
const lockName = (key: string) => `${sha(key).slice(0, 32)}.json`;

/** Advisory locks: nothing here stops an edit by itself. The permission engine asks `check` and decides. Paths stay local; teammates only ever see a keyed hash. */
export function createLockClient(d: LockDeps): LockClient {
  const api = d.platform === 'win32' ? win32 : posix; const dir = api.join(d.root, '.centcom', 'locks'); const pid = d.pid ?? process.pid; const waitMs = d.waitMs ?? 5000; const opts = { platform: d.platform, caseInsensitive: d.caseInsensitive };
  const local = new Map<string, Held[]>(); const remote = new Map<string, Map<string, Remote>>(); const aliases = new Map<string, string>(); const fileKeys = new Set<string>(); const localAgents = new Set<string>(); const seenConflicts = new Set<string>(); let queue: { clear: FileLockPayload; secret: { path: string } }[] = [];
  let dirReady: Promise<boolean> | undefined; let warnedDir = false; let warnedMac = false; let disposed = false;
  const iso = (ms: number) => new Date(ms).toISOString(); const now = () => d.clock.now();
  const macOf = (key: string): string | undefined => { try { return d.pathMac?.(key); } catch { return undefined; } };
  const ensureDir = () => (dirReady ??= d.fs.mkdirp(dir).then(() => true, () => { if (!warnedDir) { warnedDir = true; d.log?.warn('lock folder not writable: locks are kept in memory only'); } return false; }));

  function send(p: { clear: FileLockPayload; secret: { path: string } }) {
    const t = d.transport; if (!t) return; if (t.ready && !t.ready()) { enqueue(p); return; }
    try { t.publish(p); } catch { enqueue(p); }
  }
  function enqueue(p: { clear: FileLockPayload; secret: { path: string } }) { queue.push(p); if (queue.length > QUEUE_MAX) queue.shift(); }
  function publish(action: FileLockPayload['action'], key: string, agentId: string, ttlMs?: number) {
    if (!d.transport) return; const mac = macOf(key); if (!mac) { if (!warnedMac) { warnedMac = true; d.log?.warn('no path key available: lock events are not shared'); } return; }
    const clear: FileLockPayload = { action, path_hmac: mac, agent_id: agentId, ...(ttlMs !== undefined ? { ttl_ms: Math.min(MAX_TTL, Math.max(MIN_WIRE_TTL, ttlMs)) } : {}) };
    try { assertWritableEventPayload('file.lock', clear); } catch { d.log?.debug('lock event not valid, not sent'); return; } send({ clear, secret: { path: key } });
  }
  const live = (h: Held) => h.expiresAt > now();
  const holders = (key: string) => (local.get(key) ?? []).filter(live);
  function remoteHolder(key: string): Remote | undefined { const mac = macOf(key); if (!mac) return undefined; for (const r of remote.get(mac)?.values() ?? []) if (r.expiresAt > now()) return r; return undefined; }

  function raiseConflict(local_: Held, remoteAgent: string, mac: string) {
    const id = `${mac}|${local_.agentId}|${remoteAgent}`; if (seenConflicts.has(id)) return; seenConflicts.add(id);
    d.bus.emit('lock:conflict', { agent_id: local_.agentId, other_agent_id: remoteAgent as AgentId, path: local_.key }); d.onConflictDetected?.(payload({ agentIds: [local_.agentId, remoteAgent as AgentId], path_hmac: mac }));
  }
  function payload(c: Conflict): PConflictDetected { const p: PConflictDetected = { agent_ids: [...c.agentIds], path_hmacs: [c.path_hmac] }; assertWritableEventPayload('conflict.detected', p); return p; }

  async function fileClaim(key: string, agentId: AgentId, expiresAt: number): Promise<{ owned: boolean; other?: { agent: string; expiresAt: number } }> {
    if (!(await ensureDir())) return { owned: false }; const path = api.join(dir, lockName(key)); const text = JSON.stringify({ v: 1, pid, agent_id: agentId, expires_at: iso(expiresAt) });
    for (let i = 0; i < 2; i++) {
      try { if (await d.fs.createExclusive(path, text)) return { owned: true }; } catch { return { owned: false }; }
      let cur = await d.fs.read(path).catch(() => undefined); if (cur === undefined) continue;
      // a file that is still empty or cut off was only just created by another process: give it a moment before calling it damaged
      for (let w = 0; w < 3 && !parsed(cur); w++) { await new Promise((r) => setTimeout(r, 10)); cur = (await d.fs.read(path).catch(() => undefined)) ?? cur; }
      let info: { pid?: number; agent_id?: string; expires_at?: string } | undefined; try { info = JSON.parse(cur) as typeof info; } catch { info = undefined; }
      const exp = info?.expires_at ? Date.parse(info.expires_at) : NaN; const stale = !info || typeof info.pid !== 'number' || !Number.isFinite(exp) || exp <= now() || !d.fs.pidAlive(info.pid) || (info.pid === pid && !local.has(key));
      if (!stale) return { owned: false, other: { agent: String(info!.agent_id), expiresAt: exp } };
      const again = await d.fs.read(path).catch(() => undefined); if (again === cur) await d.fs.remove(path).catch(() => undefined); // only the file we judged stale
    }
    return { owned: false };
  }
  async function dropFile(key: string) { if (!fileKeys.delete(key)) return; await d.fs.remove(api.join(dir, lockName(key))).catch(() => undefined); }
  async function renewFile(key: string, h: Held) { if (!fileKeys.has(key)) return; const path = api.join(dir, lockName(key)); try { const cur = JSON.parse((await d.fs.read(path)) ?? 'null') as { pid?: number } | null; if (cur?.pid !== pid) return; await d.fs.replace(path, JSON.stringify({ v: 1, pid, agent_id: h.agentId, expires_at: iso(h.expiresAt) })); } catch { /* the next tick tries again */ } }

  function arm(h: Held) {
    if (h.timer !== undefined) d.clock.clearTimeout(h.timer as never);
    h.timer = d.clock.setTimeout(() => { void tick(h); }, Math.max(1, Math.floor(h.ttlMs / 2)));
  }
  async function tick(h: Held) {
    if (disposed || !(local.get(h.key) ?? []).includes(h)) return;
    if (now() >= h.expiresAt) { await remove(h, 'expire'); return; }
    const running = d.agentRunning ? d.agentRunning(h.agentId) : true; if (running) h.expiresAt = now() + h.ttlMs;
    arm(h); // the next check is set before any file work, so a slow disk cannot lose a tick
    if (running) await renewFile(h.key, h);
  }
  async function remove(h: Held, action: 'release' | 'expire') {
    const list = local.get(h.key); const i = list ? list.indexOf(h) : -1; if (!list || i < 0) return; list.splice(i, 1); if (h.timer !== undefined) d.clock.clearTimeout(h.timer as never); h.timer = undefined;
    d.bus.emit('lock:changed', { agent_id: h.agentId, path: h.key, action }); publish(action, h.key, h.agentId);
    if (!list.length) { local.delete(h.key); await dropFile(h.key); }
  }

  async function run(path: string, agentId: AgentId, ttl: number): Promise<LockResult> {
    // the first look follows symlinks; after that the answer is remembered (the key only names a lock, so a link changed later does no harm)
    const lex = lexicalKey(path, opts); const key = aliases.get(lex) ?? await canonicalKey(path, d.root, d.fs, opts); if (!aliases.has(lex)) { if (aliases.size >= 5000) aliases.clear(); aliases.set(lex, key); } localAgents.add(agentId);
    const mine = holders(key).find((h) => h.agentId === agentId); const other = holders(key).find((h) => h.agentId !== agentId); const rem = remoteHolder(key);
    if (mine) { mine.ttlMs = ttl; mine.expiresAt = now() + ttl; arm(mine); await renewFile(key, mine); return other ? { ok: true, heldBy: other.agentId } : rem ? { ok: true, heldBy: rem.agentId as AgentId } : { ok: true }; }
    if (d.config.mode === 'block') { if (other) return { ok: false, reason: 'held', heldBy: other.agentId, expiresAt: iso(other.expiresAt) }; if (rem) return { ok: false, reason: 'held', heldBy: rem.agentId as AgentId, expiresAt: iso(rem.expiresAt) }; }
    const expiresAt = now() + ttl; let fileOther: { agent: string; expiresAt: number } | undefined;
    if (!(local.get(key) ?? []).length) { const c = await fileClaim(key, agentId, expiresAt); if (c.owned) fileKeys.add(key); fileOther = c.other; }
    if (d.config.mode === 'block' && fileOther) return { ok: false, reason: 'held', heldBy: fileOther.agent as AgentId, expiresAt: iso(fileOther.expiresAt) };
    const h: Held = { agentId, key, ttlMs: ttl, expiresAt, ...(macOf(key) ? { mac: macOf(key) } : {}) }; const list = local.get(key) ?? []; list.push(h); local.set(key, list); arm(h);
    d.bus.emit('lock:changed', { agent_id: agentId, path: key, action: 'acquire', ttl_ms: ttl }); publish('acquire', key, agentId, ttl);
    if (rem && h.mac) raiseConflict(h, rem.agentId, h.mac);
    const heldBy = other?.agentId ?? (rem?.agentId as AgentId | undefined) ?? (fileOther?.agent as AgentId | undefined); return heldBy ? { ok: true, heldBy } : { ok: true };
  }
  async function acquire(path: string, o: { agentId: AgentId; ttlMs?: number }): Promise<LockResult> {
    const ttl = Math.min(MAX_TTL, Math.max(1, Math.floor(o.ttlMs ?? d.config.defaultTtlMs))); let timer: unknown;
    const late = new Promise<'late'>((res) => { timer = d.clock.setTimeout(() => res('late'), waitMs); });
    try { const r = await Promise.race([run(path, o.agentId, ttl), late]); if (r === 'late') { d.log?.warn('lock wait timed out'); return d.config.mode === 'block' ? { ok: false, reason: 'timeout' } : { ok: true }; } return r; }
    finally { d.clock.clearTimeout(timer as never); }
  }
  async function release(path: string, agentId: AgentId) {
    let key: string; try { const lex = lexicalKey(path, opts); key = aliases.get(lex) ?? await canonicalKey(path, d.root, d.fs, opts); } catch { return; } const h = (local.get(key) ?? []).find((x) => x.agentId === agentId); if (h) await remove(h, 'release');
  }
  async function releaseAll(agentId: AgentId) { const mine: Held[] = []; for (const list of local.values()) for (const h of list) if (h.agentId === agentId) mine.push(h); await Promise.all(mine.map((h) => remove(h, 'release'))); }
  const off = d.bus.on('agent:exited', (p) => { void releaseAll(p.agent_id); });

  function onRemoteLock(evt: FileLockPayload) {
    try {
      if (!evt || typeof evt.path_hmac !== 'string' || typeof evt.agent_id !== 'string') { d.log?.debug('lock event ignored: bad shape'); return; }
      if (!['acquire', 'release', 'deny', 'expire'].includes(evt.action)) { d.log?.debug('lock event ignored: unknown action'); return; }
      if (localAgents.has(evt.agent_id) || (d.isMember && !d.isMember(evt.agent_id))) return; // our own echo, or someone who is not in the session
      const mac = evt.path_hmac; let table = remote.get(mac);
      if (evt.action === 'acquire') {
        if (!table) remote.set(mac, (table = new Map())); const old = table.get(evt.agent_id); if (old?.timer !== undefined) d.clock.clearTimeout(old.timer as never);
        const ttl = typeof evt.ttl_ms === 'number' && evt.ttl_ms > 0 ? evt.ttl_ms : REMOTE_DEFAULT_TTL; // the receiver's clock from receipt: sender timestamps are never used
        const r: Remote = { agentId: evt.agent_id, expiresAt: now() + ttl }; r.timer = d.clock.setTimeout(() => { const t = remote.get(mac); if (t?.get(evt.agent_id) === r) { t.delete(evt.agent_id); if (!t.size) remote.delete(mac); } }, ttl); table.set(evt.agent_id, r);
        for (const list of local.values()) for (const h of list) if (h.mac === mac && live(h)) raiseConflict(h, evt.agent_id, mac);
      } else if (evt.action === 'release' || evt.action === 'expire') { const r = table?.get(evt.agent_id); if (r) { if (r.timer !== undefined) d.clock.clearTimeout(r.timer as never); table!.delete(evt.agent_id); if (!table!.size) remote.delete(mac); } }
    } catch { d.log?.debug('lock event ignored'); }
  }
  function check(path: string): LockInfo | null {
    let lex: string; try { lex = lexicalKey(path, opts); } catch { return null; } const key = aliases.get(lex) ?? lex; const h = holders(key)[0]; if (h) return { heldBy: h.agentId, expiresAt: iso(h.expiresAt), remote: false };
    const r = remoteHolder(key); return r ? { heldBy: r.agentId as AgentId, expiresAt: iso(r.expiresAt), remote: true } : null;
  }
  function conflicts(): Conflict[] {
    const out: Conflict[] = []; for (const list of local.values()) for (const h of list) { if (!h.mac || !live(h)) continue; for (const r of remote.get(h.mac)?.values() ?? []) if (r.expiresAt > now()) out.push({ agentIds: [h.agentId, r.agentId as AgentId], path_hmac: h.mac }); } return out;
  }
  function flush() { const t = d.transport; if (!t) return; const q = queue; queue = []; for (const p of q) { if (t.ready && !t.ready()) { enqueue(p); continue; } try { t.publish(p); } catch { enqueue(p); } } }
  function dispose() { disposed = true; off(); for (const list of local.values()) for (const h of list) if (h.timer !== undefined) d.clock.clearTimeout(h.timer as never); for (const t of remote.values()) for (const r of t.values()) if (r.timer !== undefined) d.clock.clearTimeout(r.timer as never); }
  return { acquire, release, releaseAll, check, onRemoteLock, conflicts, flush, conflictPayload: payload, dispose };
}
