#!/usr/bin/env node
/** centcom-runnerd [--socket <path>] [--idle-exit-s 60]: hosts the agent runner for local clients. Secret is written to <socket dir>/runner.secret (0600). */
import { randomBytes } from 'node:crypto';
import { writeFile, chmod } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { newIdGenerator } from '@centcom/protocol';
import { ClaudeCodeEngine, CodexEngine, createAgentBus, createRunner, startIpcServer, AlreadyRunning, type EngineRegistry } from '../src/index.js';

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
try { server = await startIpcServer({ runner, socketPath, secret, clock, log, idleExitMs: idleS * 1000, onIdle: () => void shutdown(), onShutdown: () => void shutdown() }); }
catch (e) { if (e instanceof AlreadyRunning) { process.stderr.write('already running\n'); process.exit(1); } throw e; }
const secretFile = join(dirname(socketPath), 'runner.secret'); await writeFile(secretFile, secret, { mode: 0o600 }); await chmod(secretFile, 0o600);
process.stdout.write(JSON.stringify({ socket: socketPath, secret_file: secretFile }) + '\n');
process.on('SIGTERM', () => void shutdown()); process.on('SIGINT', () => void shutdown());
