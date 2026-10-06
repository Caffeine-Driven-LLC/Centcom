#!/usr/bin/env node
/** centcom-runnerd [--socket <path>] [--idle-exit-s 60]: hosts the agent runner for local clients. Secret is written to <socket dir>/runner.secret (0600). */
import { randomBytes } from 'node:crypto';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { newIdGenerator } from '@centcom/protocol';
import { ClaudeCodeEngine, CodexEngine, createAgentBus, createRunner, startIpcServer, AlreadyRunning, UnsafeDirectory, ensurePrivateDir, writeSecretFile, type EngineRegistry } from '../src/index.js';

const a = process.argv.slice(2); const val = (n: string) => { const i = a.indexOf(n); return i >= 0 ? a[i + 1] : undefined; };
const uid = process.getuid?.() ?? 0; const socketPath = val('--socket') ?? join(process.env.XDG_RUNTIME_DIR ?? join(tmpdir(), `centcom-${uid}`), 'centcom', 'runner.sock');
const idleS = Number(val('--idle-exit-s') ?? 60); const secret = randomBytes(32).toString('hex');
const clock = { now: () => Date.now(), setTimeout: (fn: () => void, ms: number) => setTimeout(fn, ms), clearTimeout: (h: never) => clearTimeout(h as NodeJS.Timeout) };
const noop = () => undefined; const log = { debug: noop, info: noop, warn: noop, error: noop };
const engines = { 'claude-code': new ClaudeCodeEngine(), codex: new CodexEngine() } as const;
const registry: EngineRegistry = { get: (id) => (engines as Record<string, never>)[id] };
const rng = (n: number) => new Uint8Array(randomBytes(n));
const runner = createRunner({ engines: registry, bus: createAgentBus({ onError: noop }), ids: newIdGenerator({ now: () => Date.now(), random: rng }), clock, log });
let server: Awaited<ReturnType<typeof startIpcServer>> | undefined;
const shutdown = async () => { await runner.stopAll().catch(noop); await server?.close(); process.exit(0); };
const fatal = (m: string) => { process.stderr.write(m + '\n'); process.exit(1); };
try {
  // The default folder is $TMPDIR/centcom-<uid>/centcom: verify the per-user parent as well as the leaf (claimSocket checks the leaf again).
  if (!val('--socket') && !process.env.XDG_RUNTIME_DIR) await ensurePrivateDir(dirname(dirname(socketPath)));
  server = await startIpcServer({ runner, socketPath, secret, clock, log, idleExitMs: idleS * 1000, onIdle: () => void shutdown(), onShutdown: () => void shutdown() }); }
catch (e) { if (e instanceof AlreadyRunning) fatal('already running'); if (e instanceof UnsafeDirectory) fatal(e.message); throw e; }
const secretFile = join(dirname(socketPath), 'runner.secret'); try { await writeSecretFile(secretFile, secret); } catch (e) { await server.close(); fatal(e instanceof UnsafeDirectory ? e.message : `Could not write ${secretFile}: ${(e as Error).message}`); }
process.stdout.write(JSON.stringify({ socket: socketPath, secret_file: secretFile }) + '\n');
process.on('SIGTERM', () => void shutdown()); process.on('SIGINT', () => void shutdown());
