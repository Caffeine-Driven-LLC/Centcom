import { createHash } from 'node:crypto';
import { basename, join, resolve } from 'node:path';
import type { AgentBus } from '../events/index.js';
import type { RunnerClock } from '../runner/types.js';
import type { EngineId } from '../types.js';
import { BUILTIN, BUILTIN_NAME, toClaude, toCodex, urlAllowed, validateDef, type McpServerDef } from './defs.js';
import { BuiltinServer, InvalidConfig, McpError, McpPlanChanged } from './errors.js';
import { parseServers, printTable, setServerTable, type CodexRaw } from './toml.js';
import { unifiedDiff } from './diff.js';
import { jsonErrorAt } from './jsonpos.js';

export interface McpFs { read(path: string): Promise<string | undefined>; writeAtomic(path: string, text: string): Promise<void> }
export type McpEngine = Extract<EngineId, 'claude-code' | 'codex'>; export type McpScope = 'project' | 'user';
export type McpState = 'connected' | 'needs_auth' | 'failed' | 'pending' | 'disabled' | 'unknown';
export interface McpServerStatus { name: string; state: McpState; tools?: number; error?: string; builtin?: boolean }
export interface McpEngineStatus { engine: McpEngine; /** false when this version of the tool does not say. */ reported: boolean; servers: McpServerStatus[] }
export interface EngineReport { servers: { name: string; status: string; tools?: number }[]; errors?: { name: string; error: string }[] }
export interface McpDeps {
  fs: McpFs; home: string; clock: RunnerClock; bus: AgentBus; log?: { info(m: string, c?: Record<string, unknown>): void }; which: (command: string) => string | undefined;
  engines: { status?(engine: EngineId): EngineReport | undefined; testSession(engine: EngineId, mcpConfigJson: string, o: { timeoutMs: number; signal: AbortSignal }): Promise<EngineReport> };
}
export interface McpTarget { engine: McpEngine; scope: McpScope; path: string; baseSha: string | null; newText: string }
export interface McpPlan { targets: McpTarget[]; diff: string; planHash: string; warnings: string[]; scope: McpScope }
export interface McpApplyReport { written: { engine: string; backup?: string }[] }
export type McpOp = { kind: 'add' | 'update' | 'remove'; engine: EngineId | 'both'; scope: McpScope; def?: McpServerDef; name?: string; root?: string };
const ENGINES: McpEngine[] = ['claude-code', 'codex']; const sha = (s: string) => createHash('sha256').update(s).digest('hex');
const STATE: Record<string, McpState> = { connected: 'connected', ok: 'connected', ready: 'connected', 'needs-auth': 'needs_auth', needs_auth: 'needs_auth', failed: 'failed', error: 'failed', pending: 'pending', connecting: 'pending', disabled: 'disabled' };
export const mapState = (s: string): McpState => STATE[String(s).toLowerCase()] ?? 'unknown';
export const claudeConfigArg = (defs: McpServerDef[]): string => JSON.stringify({ mcpServers: Object.fromEntries(defs.filter((d) => d.name !== BUILTIN_NAME).map((d) => [d.name, toClaude(d)])) });

function parseJsonObject(text: string, file: string): Record<string, unknown> {
  let j: unknown; try { j = JSON.parse(text); } catch (e) { throw new InvalidConfig(file, jsonErrorAt(text)); }
  if (!j || typeof j !== 'object' || Array.isArray(j)) throw new InvalidConfig(file); return j as Record<string, unknown>;
}
const indentOf = (text: string) => { const m = /^([ \t]+)"/m.exec(text); return m ? (m[1]!.startsWith('\t') ? '\t' : m[1]!.length) : 2; };
function fromClaude(name: string, e: Record<string, any>): McpServerDef {
  const t = e.type === 'http' || e.type === 'sse' ? e.type : e.url ? 'http' : 'stdio'; const refs: Record<string, string> = {}; const lit: Record<string, string> = {}; const hrefs: Record<string, string> = {};
  for (const [k, v] of Object.entries<string>(e.env ?? {})) { const m = /^\$\{([A-Za-z_][A-Za-z0-9_]*)\}$/.exec(String(v)); if (m) refs[k] = m[1]!; else lit[k] = '(set)'; }
  for (const [k, v] of Object.entries<string>(e.headers ?? {})) { const m = /\$\{([A-Za-z_][A-Za-z0-9_]*)\}/.exec(String(v)); if (m) hrefs[k] = m[1]!; }
  return { name, transport: t, ...(e.command ? { command: String(e.command) } : {}), ...(Array.isArray(e.args) ? { args: e.args.map(String) } : {}), ...(e.url ? { url: String(e.url) } : {}), ...(Object.keys(refs).length ? { env_refs: refs } : {}), ...(Object.keys(hrefs).length ? { header_refs: hrefs } : {}), ...(Object.keys(lit).length ? { env: lit } : {}) };
}
function fromCodex(name: string, r: CodexRaw): McpServerDef {
  const env = (r.env ?? {}) as Record<string, string>; const vars = Array.isArray(r.env_vars) ? (r.env_vars as string[]) : []; const headers: Record<string, string> = { ...((r.env_http_headers ?? {}) as Record<string, string>) }; if (typeof r.bearer_token_env_var === 'string') headers.Authorization = r.bearer_token_env_var;
  return { name, transport: typeof r.url === 'string' ? 'http' : 'stdio', ...(typeof r.command === 'string' ? { command: r.command } : {}), ...(Array.isArray(r.args) ? { args: r.args as string[] } : {}), ...(typeof r.url === 'string' ? { url: r.url } : {}), ...(vars.length ? { env_refs: Object.fromEntries(vars.map((v) => [v, v])) } : {}), ...(Object.keys(headers).length ? { header_refs: headers } : {}), ...(Object.keys(env).length ? { env: Object.fromEntries(Object.keys(env).map((k) => [k, '(set)'])) } : {}) };
}

export interface McpManager {
  list(scope: McpScope, root?: string): Promise<{ engine: McpEngine; servers: McpServerDef[]; builtin: McpServerDef[]; unsupported?: string }[]>;
  plan(op: McpOp): Promise<McpPlan>; apply(plan: McpPlan, confirm: { accepted: true; planHash: string; userScope?: true }): Promise<McpApplyReport>;
  status(): McpEngineStatus[]; testServer(def: McpServerDef, engine: McpEngine): Promise<McpServerStatus>; claudeConfigArg(defs: McpServerDef[]): string; dispose(): void;
}
export function createMcpManager(d: McpDeps): McpManager {
  const seen = new Map<McpEngine, EngineReport>();
  const off = d.bus.on('agent:event', (p) => { const e = p.event; if (e.type !== 'session.started' || (e.engine !== 'claude-code' && e.engine !== 'codex')) return; seen.set(e.engine, { servers: e.mcp_servers.map((s) => ({ name: s.name, status: s.status })) }); d.bus.emit('mcp:status', { engine: e.engine, servers: build(e.engine).servers }); });
  function pathFor(engine: McpEngine, scope: McpScope, root?: string): string | undefined {
    if (engine === 'claude-code') return scope === 'project' && root ? join(root, '.mcp.json') : undefined; // Claude keeps user-level servers in a file with sign-in details: Centcom does not touch it
    return scope === 'user' ? join(d.home, '.codex', 'config.toml') : root ? join(root, '.codex', 'config.toml') : undefined;
  }
  async function readServers(engine: McpEngine, path: string): Promise<{ text: string | undefined; servers: McpServerDef[] }> {
    const text = await d.fs.read(path); if (text === undefined) return { text, servers: [] };
    if (engine === 'claude-code') { const j = parseJsonObject(text, basename(path)); const s = (j.mcpServers ?? {}) as Record<string, Record<string, unknown>>; if (typeof s !== 'object' || Array.isArray(s)) throw new InvalidConfig(basename(path)); return { text, servers: Object.entries(s).filter(([n]) => n !== BUILTIN_NAME).map(([n, e]) => fromClaude(n, e)) }; }
    try { return { text, servers: Object.entries(parseServers(text)).filter(([n]) => n !== BUILTIN_NAME).map(([n, r]) => fromCodex(n, r)) }; } catch { throw new InvalidConfig(basename(path)); }
  }
  function edit(engine: McpEngine, text: string | undefined, kind: McpOp['kind'], name: string, def?: McpServerDef): string {
    if (engine === 'claude-code') {
      const j = text === undefined ? {} : parseJsonObject(text, '.mcp.json'); const servers = { ...((j.mcpServers ?? {}) as Record<string, unknown>) }; const exists = name in servers;
      if (kind === 'add' && exists) throw new McpError('exists', 'There is already a server with that name; use update.'); if (kind !== 'add' && !exists) throw new McpError('not_found', 'There is no server with that name.');
      if (kind === 'remove') delete servers[name]; else servers[name] = toClaude(def!); const next = { ...j, mcpServers: servers }; return JSON.stringify(next, null, text === undefined ? 2 : indentOf(text)) + (text === undefined || text.endsWith('\n') ? '\n' : '');
    }
    const cur = text ?? ''; const exists = name in parseServers(cur); if (kind === 'add' && exists) throw new McpError('exists', 'There is already a server with that name; use update.'); if (kind !== 'add' && !exists) throw new McpError('not_found', 'There is no server with that name.');
    return setServerTable(cur, name, kind === 'remove' ? undefined : printTable(name, toCodex(def!), /\r\n/.test(cur) ? '\r\n' : '\n'));
  }
  const hashOf = (ts: McpTarget[]) => sha(JSON.stringify(ts.map((t) => [t.path, t.baseSha, sha(t.newText)])));
  function build(engine: McpEngine): McpEngineStatus {
    const rep = d.engines.status?.(engine) ?? seen.get(engine); const errors = new Map((rep?.errors ?? []).map((e) => [e.name, e.error]));
    const servers: McpServerStatus[] = (rep?.servers ?? []).map((s) => ({ name: s.name, state: mapState(s.status), ...(s.tools !== undefined ? { tools: s.tools } : {}), ...(errors.has(s.name) ? { error: errors.get(s.name)! } : {}), ...(s.name === BUILTIN_NAME ? { builtin: true } : {}) }));
    if (!servers.some((s) => s.name === BUILTIN_NAME)) servers.unshift({ name: BUILTIN_NAME, state: 'unknown', builtin: true }); return { engine, reported: !!rep, servers };
  }

  return {
    claudeConfigArg, dispose: () => off(),
    async list(scope, root) {
      const out = []; for (const engine of ENGINES) { const p = pathFor(engine, scope, root); if (!p) { out.push({ engine, servers: [], builtin: [BUILTIN], unsupported: engine === 'claude-code' && scope === 'user' ? 'Claude Code keeps user-level servers in a file Centcom does not edit; use `claude mcp add --scope user`.' : 'No folder was given.' }); continue; } out.push({ engine, servers: (await readServers(engine, p)).servers, builtin: [BUILTIN] }); } return out;
    },
    async plan(op) {
      const name = op.def?.name ?? op.name; if (!name) throw new McpError('invalid_server', 'Which server?'); if (name === BUILTIN_NAME) throw new BuiltinServer();
      if (op.kind !== 'remove') { if (!op.def) throw new McpError('invalid_server', 'A definition is needed.'); validateDef(op.def); }
      const engines: McpEngine[] = op.engine === 'both' ? ENGINES : [op.engine as McpEngine]; const targets: McpTarget[] = []; const old = new Map<string, string>(); const warnings: string[] = [];
      for (const engine of engines) {
        const path = pathFor(engine, op.scope, op.root); if (!path) { if (op.engine !== 'both') throw new McpError('unsupported', engine === 'claude-code' && op.scope === 'user' ? 'Claude Code keeps user-level servers in a file Centcom does not edit; use `claude mcp add --scope user`.' : 'A project folder is needed.'); continue; }
        const { text } = await readServers(engine, path); const next = edit(engine, text, op.kind, name, op.def); old.set(path, text ?? ''); targets.push({ engine, scope: op.scope, path, baseSha: text === undefined ? null : sha(text), newText: next });
        if (op.kind !== 'remove' && op.def!.transport === 'stdio') warnings.push(`${basename(path)}: "${op.def!.command}" runs a program on your machine whenever ${engine === 'codex' ? 'Codex' : 'Claude Code'} starts this server.`);
      }
      if (!targets.length) throw new McpError('unsupported', 'Nothing can be written for that choice.');
      return { targets, scope: op.scope, warnings, planHash: hashOf(targets), diff: targets.map((t) => unifiedDiff(old.get(t.path) ?? '', t.newText, `${t.engine}:${basename(t.path)}`)).join('\n') };
    },
    async apply(plan, confirm) {
      if (!confirm || confirm.accepted !== true) throw new McpError('not_confirmed', 'Nothing was written: it needs a confirmation.'); if (confirm.planHash !== plan.planHash || hashOf(plan.targets) !== plan.planHash) throw new McpPlanChanged();
      if (plan.scope === 'user' && confirm.userScope !== true) throw new McpError('needs_user_confirm', 'This changes your user-level settings for every project; confirm that too.');
      for (const t of plan.targets) { const cur = await d.fs.read(t.path); if ((cur === undefined ? null : sha(cur)) !== t.baseSha) throw new McpPlanChanged(); }
      const ts = new Date(d.clock.now()).toISOString().replace(/[-:]/g, '').replace(/\.\d+Z$/, 'Z'); const written: McpApplyReport['written'] = [];
      for (const t of plan.targets) { const cur = await d.fs.read(t.path); let backup: string | undefined; if (cur !== undefined) { backup = `${t.path}.${ts}.centcom-bak`; await d.fs.writeAtomic(backup, cur); } await d.fs.writeAtomic(t.path, t.newText); written.push({ engine: t.engine, ...(backup ? { backup } : {}) }); }
      d.log?.info('mcp.applied', { files: written.length }); return { written };
    },
    status: () => ENGINES.map(build),
    async testServer(def, engine) {
      try { validateDef(def); } catch (e) { return { name: def.name, state: 'failed', error: e instanceof McpError && e.code === 'secret_rejected' ? 'secret_rejected' : 'invalid_definition' }; }
      if (def.transport === 'stdio' && !d.which(def.command!)) return { name: def.name, state: 'failed', error: 'command_not_found' }; if (def.transport !== 'stdio' && !urlAllowed(def.url!)) return { name: def.name, state: 'failed', error: 'url_not_allowed' };
      const ac = new AbortController(); let timer: unknown; const late = new Promise<'late'>((res) => { timer = d.clock.setTimeout(() => { ac.abort(); res('late'); }, 30_000); });
      try { const r = await Promise.race([d.engines.testSession(engine, claudeConfigArg([def]), { timeoutMs: 30_000, signal: ac.signal }), late]); if (r === 'late') return { name: def.name, state: 'failed', error: 'timeout' };
        const s = r.servers.find((x) => x.name === def.name); const err = r.errors?.find((x) => x.name === def.name)?.error; return s ? { name: def.name, state: mapState(s.status), ...(s.tools !== undefined ? { tools: s.tools } : {}), ...(err ? { error: err } : {}) } : { name: def.name, state: 'unknown' }; }
      catch { return { name: def.name, state: 'failed', error: 'session_failed' }; } finally { d.clock.clearTimeout(timer as never); }
    },
  };
}
export const nodeMcpFsFrom = (read: (p: string) => Promise<string | undefined>, write: (p: string, t: string) => Promise<void>): McpFs => ({ read, writeAtomic: write });
void resolve;
