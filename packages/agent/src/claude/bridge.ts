/** Approval bridge: lets the claude CLI ask Centcom for permission through --permission-prompt-tool.
 *  claude spawns mcp-permission.mjs; that script talks to this server over a private socket; we ask the gate. */
import { randomBytes, timingSafeEqual } from 'node:crypto';
import { chmodSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { createServer, type Server, type Socket } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { classifyTool } from '../risk.js';
import { newId } from '../ids.js';
import type { ApprovalDecision, ApprovalRequest, EventBody, PermissionGate } from '../types.js';
import { editDiff } from './diff.js';

type J = Record<string, unknown>;
export const PERMISSION_TOOL = 'mcp__centcom__approve';
const SCRIPT = fileURLToPath(new URL('./mcp-permission.mjs', import.meta.url));

/** Turn claude's (tool_name, input) into what the approval UI shows. Pure, so it is easy to test. */
export function describeTool(name: string, input: J): { summary: string; path?: string; command?: string; diff?: string } {
  const str = (k: string) => (typeof input[k] === 'string' ? (input[k] as string) : undefined);
  const path = str('file_path') ?? str('notebook_path') ?? str('path');
  if (name === 'Bash') { const command = str('command') ?? ''; return { summary: command.split('\n')[0]!.slice(0, 120), command }; }
  if (name === 'Edit') return { summary: path ?? 'edit', path, diff: path ? editDiff(path, str('old_string') ?? '', str('new_string') ?? '') : undefined };
  if (name === 'Write') return { summary: path ?? 'write', path, diff: path ? editDiff(path, '', (str('content') ?? '').split('\n').slice(0, 60).join('\n')) : undefined };
  if (name === 'MultiEdit' && Array.isArray(input.edits) && path) {
    const diffs = (input.edits as J[]).slice(0, 6).map((e) => editDiff(path, String(e.old_string ?? ''), String(e.new_string ?? '')));
    return { summary: `${path} (${(input.edits as unknown[]).length} edits)`, path, diff: diffs.join('\n') };
  }
  const first = Object.entries(input).find(([, v]) => typeof v === 'string');
  return { summary: path ?? (first ? String(first[1]).slice(0, 120) : name), ...(path ? { path } : {}) };
}

export class ApprovalBridge {
  private server?: Server;
  private dir?: string;
  private sockets = new Set<Socket>();
  mcpConfigPath?: string;

  /** A secret for this run only: the permission script must send it with every request, so no other local process can ask in its name. */
  private token = randomBytes(32).toString('hex');
  constructor(private deps: { agentId: string; cwd: string; gate: PermissionGate; emit: (b: EventBody) => void; node?: string; /** No answer by then: denied (default 10 min). */ timeoutMs?: number; setTimeout?: (f: () => void, ms: number) => unknown; clearTimeout?: (h: unknown) => void }) {}

  /** Start listening and write the MCP config that points claude at our script. Idempotent. */
  async start(): Promise<void> {
    if (this.server) return;
    this.dir = mkdtempSync(join(tmpdir(), 'centcom-'));
    const sock = process.platform === 'win32' ? `\\\\.\\pipe\\centcom-${newId('p')}` : join(this.dir, 's');
    this.server = createServer((s) => this.onConnection(s));
    await new Promise<void>((res, rej) => { this.server!.once('error', rej); this.server!.listen(sock, res); });
    if (process.platform !== 'win32') chmodSync(sock, 0o600); /* the socket is only for this user (its folder is 0700 too) */
    this.mcpConfigPath = join(this.dir, 'mcp.json');
    writeFileSync(this.mcpConfigPath, JSON.stringify({ mcpServers: { centcom: { command: this.deps.node ?? process.execPath, args: [SCRIPT], env: { CENTCOM_APPROVAL_SOCK: sock, CENTCOM_APPROVAL_TOKEN: this.token } } } }), { mode: 0o600 });
  }

  argv(): string[] { return this.mcpConfigPath ? ['--mcp-config', this.mcpConfigPath, '--permission-prompt-tool', PERMISSION_TOOL] : []; }

  private onConnection(s: Socket) {
    this.sockets.add(s); s.setEncoding('utf8'); let buf = ''; let open = true;
    s.on('close', () => { open = false; this.sockets.delete(s); });
    s.on('error', () => undefined);
    s.on('data', (c: string) => {
      buf += c; const i = buf.indexOf('\n'); if (i < 0) return;
      let req: { tool_name: string; input: J; tool_use_id: string; token?: string };
      try { req = JSON.parse(buf.slice(0, i)); } catch { s.end(JSON.stringify({ behavior: 'deny', message: 'Bad request' }) + '\n'); return; }
      if (!this.tokenOk(req.token)) { s.end(JSON.stringify({ behavior: 'deny', message: 'Not allowed.' }) + '\n'); return; } // a request without this run's token is refused before anything is shown
      void this.ask(req).then((v) => { if (open) s.end(JSON.stringify(v) + '\n'); });
    });
  }

  private tokenOk(t: unknown): boolean { if (typeof t !== 'string') return false; const a = Buffer.from(t); const b = Buffer.from(this.token); return a.length === b.length && timingSafeEqual(a, b); }
  private async ask(req: { tool_name: string; input: J; tool_use_id: string }): Promise<{ behavior: 'allow' | 'deny'; updatedInput?: J; message?: string }> {
    const d = describeTool(req.tool_name, req.input ?? {});
    const approval: ApprovalRequest = { approval_id: newId('apr'), agent_id: this.deps.agentId, tool_id: req.tool_use_id, tool: req.tool_name, summary: d.summary, risk: classifyTool(req.tool_name, req.input), cwd: this.deps.cwd, ...(d.command ? { command: d.command } : {}), ...(d.path ? { path: d.path } : {}), ...(d.diff ? { diff: d.diff } : {}) };
    this.deps.emit({ type: 'approval.requested', approval_id: approval.approval_id, tool_id: approval.tool_id, summary: `${approval.tool}: ${d.summary}`, risk: approval.risk, ...(d.command ? { command: d.command } : {}), ...(d.diff ? { diff: d.diff } : {}), ...(d.path ? { path: d.path } : {}) });
    this.deps.emit({ type: 'status', state: 'awaiting-approval' });
    let dec: ApprovalDecision; const st = this.deps.setTimeout ?? ((f, ms) => setTimeout(f, ms)); const ct = this.deps.clearTimeout ?? ((h) => clearTimeout(h as NodeJS.Timeout)); let timer: unknown;
    const late = new Promise<ApprovalDecision>((res) => { timer = st(() => res({ decision: 'deny', scope: 'once', reason: 'timeout' }), this.deps.timeoutMs ?? 600_000); });
    try { dec = await Promise.race([this.deps.gate.decide(approval), late]); } catch { dec = { decision: 'deny', scope: 'once', reason: 'error' }; } finally { ct(timer); }
    this.deps.emit({ type: 'approval.resolved', approval_id: approval.approval_id, decision: dec.decision, scope: dec.scope, by: dec.reason === 'interrupt' ? 'interrupt' : dec.reason === 'timeout' ? 'timeout' : dec.reason?.includes('plan') ? 'policy' : 'user' });
    if (dec.decision === 'approve') return { behavior: 'allow', updatedInput: req.input };
    return { behavior: 'deny', message: dec.reason === 'plan mode is read-only' ? 'Plan mode is read-only; nothing was changed.' : dec.reason === 'interrupt' ? 'The user interrupted.' : dec.reason === 'timeout' ? 'Nobody answered in time, so it was declined.' : 'The user declined this action.' };
  }

  close() {
    for (const s of this.sockets) s.destroy();
    this.server?.close(); this.server = undefined;
    if (this.dir) { try { rmSync(this.dir, { recursive: true, force: true }); } catch { /* temp dir */ } this.dir = undefined; }
  }
}
