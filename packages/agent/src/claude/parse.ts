/**
 * Claude Code `--output-format stream-json --verbose --include-partial-messages` -> normalised events (lane C102).
 * Built from recorded real output (Claude Code 2.1.289). Unknown event types are ignored, never fatal.
 */
import { classifyTool } from '../risk.js';
import { editDiff } from './diff.js';
import type { Capability, EventBody, LoginKind, ProviderErrorCode } from '../types.js';

type J = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any

const CAPS: Capability[] = ['streaming', 'resume', 'subagents', 'mcp', 'skills', 'thinking', 'usage', 'interrupt', 'compact', 'models.list'];

export function loginKindFrom(apiKeySource: unknown): LoginKind {
  if (apiKeySource === 'none' || apiKeySource === undefined) return apiKeySource === 'none' ? 'subscription' : 'unknown';
  if (typeof apiKeySource === 'string' && /bedrock|vertex|foundry|cloud/i.test(apiKeySource)) return 'cloud';
  return 'api_key';
}

function summarise(name: string, input: J): { text: string; path?: string; command?: string } {
  const path = (input.file_path ?? input.path ?? input.notebook_path) as string | undefined;
  if (name === 'Bash') return { text: String(input.command ?? '').slice(0, 300), command: String(input.command ?? '') };
  if (path) return { text: path, path };
  if (input.pattern) return { text: `${input.pattern}${input.path ? ' in ' + input.path : ''}` };
  if (input.url) return { text: String(input.url) };
  if (input.query) return { text: String(input.query) };
  if (input.description) return { text: String(input.description) };
  return { text: JSON.stringify(input).slice(0, 160) };
}

function stateForTool(name: string): string {
  switch (name) {
    case 'Read': case 'NotebookRead': return 'reading-file';
    case 'Edit': case 'MultiEdit': case 'NotebookEdit': return 'editing-file';
    case 'Write': return 'creating-file';
    case 'Bash': return 'running-command';
    case 'Grep': case 'Glob': case 'WebSearch': case 'WebFetch': return 'searching';
    case 'Task': case 'Agent': return 'sub-agent';
    case 'TodoWrite': return 'planning';
    default: return 'tool-running';
  }
}

function errorCodeFor(category: string | undefined, status: number | null | undefined, text: string): ProviderErrorCode {
  if (category === 'authentication_failed' || status === 401 || /not logged in|please run .*login|authentication/i.test(text)) return 'provider_not_signed_in';
  if (category === 'rate_limit' || status === 429 || /rate limit|usage limit|limit reached/i.test(text)) return 'provider_cap_reached';
  if (category === 'overloaded' || category === 'server_error') return 'provider_rate_limited';
  if (category === 'billing_error' || category === 'account_on_hold') return 'provider_cap_reached';
  return 'provider_protocol_error';
}

interface Block { type: string; tool_id?: string; name?: string; json: string; parent?: string | null }

export class ClaudeStreamParser {
  private messageId = '';
  private textIndex = 0;
  private blocks = new Map<number, Block>();
  private tools = new Map<string, { name: string; input: J }>();
  private seenStream = new Set<string>();
  private subagents = new Map<string, string>();
  private usage = { input: 0, output: 0, cacheRead: 0 };
  sessionId?: string;

  /** Parse one stdout line into zero or more event bodies. */
  push(line: string): EventBody[] {
    const t = line.trim();
    if (!t) return [];
    let d: J;
    try { d = JSON.parse(t) as J; } catch { return [{ type: 'engine.warning', code: 'bad_json', text: 'Unreadable line from the Claude Code stream' }]; }
    switch (d.type) {
      case 'system': return this.system(d);
      case 'stream_event': return this.stream(d);
      case 'assistant': return this.assistant(d);
      case 'user': return this.user(d);
      case 'rate_limit_event': return this.limits(d);
      case 'result': return this.result(d);
      default: return [];
    }
  }

  private system(d: J): EventBody[] {
    switch (d.subtype) {
      case 'init':
        this.sessionId = d.session_id;
        return [{ type: 'session.started', engine: 'claude-code', engine_session_id: String(d.session_id ?? ''), model: String(d.model ?? ''), cli_version: d.claude_code_version,
          tools: Array.isArray(d.tools) ? d.tools.map(String) : [], mcp_servers: Array.isArray(d.mcp_servers) ? d.mcp_servers.map((m: J) => ({ name: String(m.name), status: String(m.status) })) : [],
          capabilities: CAPS, login_kind: loginKindFrom(d.apiKeySource) }];
      case 'status': return d.status === 'requesting' ? [{ type: 'status', state: 'thinking' }] : d.status === 'compacting' ? [{ type: 'compaction.started' }] : [];
      case 'api_retry': return [{ type: 'error', code: errorCodeFor(d.error, d.error_status, ''), tool_message: `API retry ${d.attempt}/${d.max_retries} (${d.error ?? 'error'})`, fatal: false,
        retry: { attempt: Number(d.attempt ?? 1), max_retries: Number(d.max_retries ?? 1), delay_ms: Number(d.retry_delay_ms ?? 0) } }];
      case 'permission_denied': return [{ type: 'tool.result', tool_id: String(d.tool_use_id ?? d.tool_name ?? ''), status: 'denied', summary: `Not allowed: ${d.tool_name ?? 'tool'}` }];
      case 'compact_boundary': return [{ type: 'compaction.ended' }];
      default: return []; // hook_started, hook_response, hook_progress, plugin_install ... are the CLI's own business
    }
  }

  private stream(d: J): EventBody[] {
    const e = d.event as J | undefined;
    if (!e) return [];
    const parent = (d.parent_tool_use_id ?? null) as string | null;
    const out: EventBody[] = [];
    switch (e.type) {
      case 'message_start':
        this.messageId = String(e.message?.id ?? 'msg');
        this.seenStream.add(this.messageId);
        this.textIndex = 0; this.blocks.clear();
        if (e.message?.usage) { this.usage.input = e.message.usage.input_tokens ?? 0; this.usage.cacheRead = e.message.usage.cache_read_input_tokens ?? 0; }
        break;
      case 'content_block_start': {
        const b = e.content_block as J; const idx = Number(e.index);
        this.blocks.set(idx, { type: b.type, tool_id: b.id, name: b.name, json: '', parent });
        if (b.type === 'tool_use' || b.type === 'server_tool_use') out.push({ type: 'status', state: stateForTool(String(b.name)) });
        if (b.type === 'thinking') out.push({ type: 'status', state: 'thinking' });
        if (b.type === 'text' && !parent) out.push({ type: 'status', state: 'streaming' });
        break;
      }
      case 'content_block_delta': {
        const idx = Number(e.index); const blk = this.blocks.get(idx); const dl = e.delta as J;
        if (dl.type === 'text_delta') {
          if (parent) out.push(...this.sub(parent), { type: 'subagent.text', subagent_id: parent, text: String(dl.text) });
          else out.push({ type: 'text.delta', message_id: this.messageId, index: this.textIndex++, text: String(dl.text) });
        } else if (dl.type === 'thinking_delta') out.push({ type: 'thinking.delta', message_id: this.messageId, text: String(dl.thinking ?? dl.text ?? '') });
        else if (dl.type === 'input_json_delta' && blk) blk.json += String(dl.partial_json ?? '');
        break;
      }
      case 'content_block_stop': {
        const blk = this.blocks.get(Number(e.index));
        if (blk && (blk.type === 'tool_use' || blk.type === 'server_tool_use')) {
          let input: J = {};
          try { input = blk.json ? (JSON.parse(blk.json) as J) : {}; } catch { /* partial: keep empty */ }
          const name = String(blk.name); const id = String(blk.tool_id);
          this.tools.set(id, { name, input });
          const s = summarise(name, input);
          if (parent) out.push(...this.sub(parent));
          out.push({ type: 'tool.requested', tool_id: id, name, input_summary: s.text, risk: classifyTool(name, input), ...(s.path ? { path: s.path } : {}), ...(s.command ? { command: s.command } : {}), ...(parent ? { parent_tool_id: parent } : {}) });
        }
        break;
      }
      case 'message_delta':
        if (e.usage?.output_tokens !== undefined) this.usage.output = e.usage.output_tokens;
        break;
      case 'message_stop':
        if (!parent) out.push({ type: 'text.done', message_id: this.messageId, input_tokens: this.usage.input, output_tokens: this.usage.output });
        break;
    }
    return out;
  }

  private sub(parent: string): EventBody[] {
    if (this.subagents.has(parent)) return [];
    this.subagents.set(parent, parent);
    return [{ type: 'subagent.started', subagent_id: parent, parent_tool_id: parent, label: this.tools.get(parent)?.name ?? 'subagent' }];
  }

  /** Complete assistant messages: only used when the stream events for that message were not seen (no partial messages). */
  private assistant(d: J): EventBody[] {
    const m = d.message as J | undefined;
    if (!m || (m.id && this.seenStream.has(String(m.id)))) return [];
    const out: EventBody[] = [];
    for (const b of (m.content ?? []) as J[]) {
      if (b.type === 'text' && b.text) { out.push({ type: 'status', state: 'streaming' }, { type: 'text.delta', message_id: String(m.id), index: 0, text: String(b.text) }, { type: 'text.done', message_id: String(m.id) }); }
      if (b.type === 'tool_use') {
        const input = (b.input ?? {}) as J; this.tools.set(String(b.id), { name: String(b.name), input }); const s = summarise(String(b.name), input);
        out.push({ type: 'status', state: stateForTool(String(b.name)) }, { type: 'tool.requested', tool_id: String(b.id), name: String(b.name), input_summary: s.text, risk: classifyTool(String(b.name), input), ...(s.path ? { path: s.path } : {}), ...(s.command ? { command: s.command } : {}) });
      }
    }
    return out;
  }

  private user(d: J): EventBody[] {
    const content = d.message?.content;
    if (!Array.isArray(content)) return [];
    const out: EventBody[] = [];
    for (const b of content as J[]) {
      if (b.type !== 'tool_result') continue;
      const id = String(b.tool_use_id);
      const text = Array.isArray(b.content) ? b.content.map((x: J) => x.text ?? '').join('\n') : String(b.content ?? '');
      const t = this.tools.get(id);
      const failed = b.is_error === true;
      const denied = failed && /permission|not allowed|denied|requested permissions/i.test(text);
      let diff: string | undefined;
      if (!failed && t && (t.name === 'Edit' || t.name === 'Write' || t.name === 'MultiEdit')) {
        const p = String(t.input.file_path ?? 'file');
        if (t.name === 'Edit') diff = editDiff(p, String(t.input.old_string ?? ''), String(t.input.new_string ?? ''));
        else if (t.name === 'Write') diff = editDiff(p, '', String(t.input.content ?? ''));
        else if (Array.isArray(t.input.edits)) diff = (t.input.edits as J[]).map((e) => editDiff(p, String(e.old_string ?? ''), String(e.new_string ?? ''))).join('\n');
      }
      out.push({ type: 'tool.result', tool_id: id, status: denied ? 'denied' : failed ? 'error' : 'ok', summary: firstLines(text, 3), ...(diff ? { diff } : {}) });
      out.push({ type: 'status', state: 'thinking' });
    }
    return out;
  }

  private limits(d: J): EventBody[] {
    const w = d.rate_limit_info?.unifiedWindows as J | undefined;
    if (!w) return [];
    return [{ type: 'limits.report', windows: Object.entries(w).map(([name, v]) => ({ name, utilization: Number((v as J).utilization ?? 0), resets_at: Number((v as J).resetsAt ?? 0) })) }];
  }

  private result(d: J): EventBody[] {
    const out: EventBody[] = [];
    const u = (d.usage ?? {}) as J;
    // context now = the last API call's prompt (fresh + cached input); the window comes from modelUsage
    const iters = Array.isArray(u.iterations) ? (u.iterations as J[]) : [];
    const last = (iters.length ? iters[iters.length - 1]! : u) as J;
    const ctxTokens = Number(last.input_tokens ?? 0) + Number(last.cache_read_input_tokens ?? 0) + Number(last.cache_creation_input_tokens ?? 0);
    const mu = Object.values((d.modelUsage ?? {}) as Record<string, J>)[0];
    const win = Number(mu?.contextWindow ?? 0);
    out.push({ type: 'usage.report', input_tokens: Number(u.input_tokens ?? 0) + Number(u.cache_creation_input_tokens ?? 0), output_tokens: Number(u.output_tokens ?? 0), cache_read_tokens: Number(u.cache_read_input_tokens ?? 0), ...(typeof d.total_cost_usd === 'number' ? { cost_usd: d.total_cost_usd } : {}), cost_is_estimate: true,
      ...(win > 0 && ctxTokens > 0 ? { context_tokens: ctxTokens, context_window: win, context_used_pct: Math.min(100, Math.round((ctxTokens / win) * 100)) } : {}) });
    if (d.is_error) {
      const text = String(d.result ?? 'Claude Code reported an error');
      out.push({ type: 'error', code: errorCodeFor(undefined, d.api_error_status, text), tool_message: firstLines(text, 4), fatal: true });
      out.push({ type: 'status', state: 'error' }, { type: 'turn.done', outcome: 'error', stop_reason: String(d.terminal_reason ?? d.subtype ?? 'error') });
    } else {
      out.push({ type: 'status', state: 'success' }, { type: 'turn.done', outcome: 'ok', stop_reason: String(d.terminal_reason ?? d.stop_reason ?? 'completed') });
    }
    return out;
  }
}

function firstLines(s: string, n: number): string { return s.split('\n').slice(0, n).join('\n').slice(0, 400); }
