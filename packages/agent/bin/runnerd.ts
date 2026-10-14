#!/usr/bin/env node
/** centcom-runnerd [--socket <path>] [--idle-exit-s 60] [--log <file>] [--unsupported-ok]: hosts the agent runner for local clients. Secret is written to <socket dir>/runner.secret (0600); the log (ids and kinds only) goes to <socket dir>/runnerd.log unless --log says otherwise. CENTCOM_CLAUDE_BIN and CENTCOM_CODEX_BIN name the executables to drive. */
import { randomBytes } from 'node:crypto';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { newIdGenerator } from '@centcom/protocol';
import { ClaudeCodeEngine, CodexEngine, createAgentBus, createFileLog, createProviderDetector, createRunner, makeWhich, preflightFromDetector, runProbe, startIpcServer, AlreadyRunning, UnsafeDirectory, ensurePrivateDir, writeSecretFile, type EngineRegistry } from '../src/index.js';

const a = process.argv.slice(2); const val = (n: string) => { const i = a.indexOf(n); return i >= 0 ? a[i + 1] : undefined; };
const uid = process.getuid?.() ?? 0; const socketPath = val('--socket') ?? join(process.env.XDG_RUNTIME_DIR ?? join(tmpdir(), `centcom-${uid}`), 'centcom', 'runner.sock');
const idleS = Number(val('--idle-exit-s') ?? 60); const secret = randomBytes(32).toString('hex');
const clock = { now: () => Date.now(), setTimeout: (fn: () => void, ms: number) => setTimeout(fn, ms), clearTimeout: (h: never) => clearTimeout(h as NodeJS.Timeout) };
const noop = () => undefined; const logFile = val('--log') ?? join(dirname(socketPath), 'runnerd.log'); const log = createFileLog({ path: logFile, clock, level: process.env.CENTCOM_LOG_LEVEL === 'debug' ? 'debug' : 'info' });
const unsupportedOk = a.includes('--unsupported-ok'); const claudeBin = process.env.CENTCOM_CLAUDE_BIN || 'claude'; const codexBin = process.env.CENTCOM_CODEX_BIN || 'codex';
const engines = { 'claude-code': new ClaudeCodeEngine({ bin: claudeBin }), codex: new CodexEngine() } as const;
const detector = createProviderDetector({ run: runProbe, which: makeWhich(), clock, env: { ...process.env, CENTCOM_CLAUDE_BIN: claudeBin, CENTCOM_CODEX_BIN: codexBin } });
const registry: EngineRegistry = { get: (id) => (engines as Record<string, never>)[id], preflight: preflightFromDetector(detector, { unsupportedOk }) };
const rng = (n: number) => new Uint8Array(randomBytes(n));
const runner = createRunner({ engines: registry, bus: createAgentBus({ onError: noop }), ids: newIdGenerator({ now: () => Date.now(), random: rng }), clock, log });
let server: Awaited<ReturnType<typeof startIpcServer>> | undefined;
const shutdown = async () => { log.info('daemon.shutdown'); await runner.stopAll().catch(noop); await server?.close(); await log.flush(); process.exit(0); };
const fatal = (m: string) => { log.error('daemon.fatal'); process.stderr.write(m + '\n'); void log.flush().finally(() => process.exit(1)); };
try {
  // The default folder is $TMPDIR/centcom-<uid>/centcom: verify the per-user parent as well as the leaf (claimSocket checks the leaf again).
  if (!val('--socket') && !process.env.XDG_RUNTIME_DIR) await ensurePrivateDir(dirname(dirname(socketPath)));
  server = await startIpcServer({ runner, socketPath, secret, clock, log, idleExitMs: idleS * 1000, onIdle: () => void shutdown(), onShutdown: () => void shutdown() }); }
catch (e) { if (e instanceof AlreadyRunning) fatal('already running'); if (e instanceof UnsafeDirectory) fatal(e.message); throw e; }
const secretFile = join(dirname(socketPath), 'runner.secret'); try { await writeSecretFile(secretFile, secret); } catch (e) { await server.close(); fatal(e instanceof UnsafeDirectory ? e.message : `Could not write ${secretFile}: ${(e as Error).message}`); }
log.info('daemon.started', { idle_exit_s: idleS }); process.stdout.write(JSON.stringify({ socket: socketPath, secret_file: secretFile, log_file: logFile }) + '\n');
process.on('SIGTERM', () => void shutdown()); process.on('SIGINT', () => void shutdown());
