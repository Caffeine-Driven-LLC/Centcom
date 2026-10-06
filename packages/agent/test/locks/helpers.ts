import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { createHash } from 'node:crypto';
import { VirtualClock } from '@centcom/testkit';
import { afterAll } from 'vitest';
import { createAgentBus, createLockClient, nodeLockFs, type AgentId, type FileLockPayload, type LockDeps, type LockFs, type LockTransport } from '../../src/index.js';

export const A = 'agt_01JTEST0000000000000000001' as AgentId; export const B = 'agt_01JTEST0000000000000000002' as AgentId; export const C = 'agt_01JTEST0000000000000000003' as AgentId;
const dirs: string[] = []; afterAll(() => { for (const d of dirs) rmSync(d, { recursive: true, force: true }); });
export function tmp() { const dir = mkdtempSync(join(tmpdir(), 'centcom-lock-')); dirs.push(dir); return { dir, put: (rel: string, text = 'x') => { mkdirSync(dirname(join(dir, rel)), { recursive: true }); writeFileSync(join(dir, rel), text); }, link: (target: string, rel: string) => { mkdirSync(dirname(join(dir, rel)), { recursive: true }); symlinkSync(target, join(dir, rel)); } }; }
/** A fake keyed hash: stable, different per key id, and shaped like the contract's base64url. */
export const macWith = (kid = 'k1') => (p: string) => createHash('sha256').update(`${kid}\0${p}`).digest('base64url');
export function rig(o: { root?: string; mode?: 'warn' | 'block'; transport?: LockTransport; pathMac?: (p: string) => string; fs?: LockFs; running?: (a: AgentId) => boolean; ci?: boolean; platform?: 'posix' | 'win32'; isMember?: (a: string) => boolean; pid?: number; ttl?: number; waitMs?: number } = {}) {
  const t = o.root ? { dir: o.root } : tmp(); const clock = new VirtualClock(); const bus = createAgentBus({ onError: (e) => { throw e; } }); const events: { k: string; p: unknown }[] = []; for (const k of ['lock:changed', 'lock:conflict'] as const) bus.on(k, (p) => events.push({ k, p }));
  const logs: { level: string; msg: string }[] = []; const conflicts: unknown[] = []; const log = { debug: (m: string) => logs.push({ level: 'debug', msg: m }), warn: (m: string) => logs.push({ level: 'warn', msg: m }) };
  const deps: LockDeps = { root: t.dir, fs: o.fs ?? nodeLockFs, clock, bus, config: { mode: o.mode ?? 'warn', defaultTtlMs: o.ttl ?? 120_000 }, pathMac: o.pathMac, transport: o.transport, agentRunning: o.running, caseInsensitive: o.ci, platform: o.platform, isMember: o.isMember, pid: o.pid, log, onConflictDetected: (p) => conflicts.push(p), waitMs: o.waitMs };
  const client = createLockClient(deps); return { ...t, clock, bus, events, logs, conflicts, client };
}
export function memTransport(o: { up?: boolean } = {}) { const sent: { clear: FileLockPayload; secret: { path: string } }[] = []; let up = o.up ?? true; const tr: LockTransport = { publish: (p) => { if (!up) throw new Error('down'); sent.push(p); }, ready: () => up }; return { tr, sent, setUp: (v: boolean) => { up = v; } }; }
import { readdirSync } from 'node:fs';
export const lockFiles = (dir: string): string[] => { try { return readdirSync(join(dir, '.centcom/locks')).filter((f) => f.endsWith('.json')); } catch { return []; } };
