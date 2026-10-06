/** Codex app-server notifications -> normalised events. Pure apart from small per-turn bookkeeping, so it is easy to test with recorded traffic. */
import { classifyCommand } from '../risk.js';
import type { EventBody, ProviderErrorCode, Risk } from '../types.js';
import { editDiff } from '../claude/diff.js';

type J = Record<string, any>;
const tail = (s: string, n = 3) => s.trim().split('\n').slice(-n).join('\n').slice(0, 400);

export function diffFor(changes: J[]): string {
  return changes.map((c) => {
    const d = String(c.diff ?? ''); const path = String(c.path ?? '');
    if (/^(---|@@|diff )/m.test(d)) return /^---/m.test(d) ? d : `--- a/${path}\n+++ b/${path}\n${d}`;
    if (c.kind?.type === 'add') return editDiff(path, '', d.split('\n').slice(0, 60).join('\n'));
    if (c.kind?.type === 'delete') return editDiff(path, d.split('\n').slice(0, 60).join('\n'), '');
    return `--- a/${path}\n+++ b/${path}\n${d}`;
  }).join('\n');
}

export function errorCodeFor(message: string): ProviderErrorCode {
  if (/401|unauthori[sz]ed|not (logged|signed) in|log ?in|sign ?in/i.test(message)) return 'provider_not_signed_in';
  if (/usage limit|limit reached|quota|exceeded your/i.test(message)) return 'provider_cap_reached';
  if (/429|rate.?limit|too many requests/i.test(message)) return 'provider_rate_limited';
  return 'provider_protocol_error';
}

export function windowName(mins: number | null | undefined, fallback: string): string {
  if (!mins) return fallback; if (mins <= 360) return 'five_hour'; if (mins >= 9000) return 'seven_day'; return `window_${mins}m`;
}

export interface ApprovalInfo { tool_id: string; tool: string; summary: string; risk: Risk; command?: string; cwd?: string; path?: string; diff?: string; reason?: string }

export class CodexMapper {
  private deltaIndex = new Map<string, number>();
  private changes = new Map<string, J[]>();
  private reasoningStarted = new Set<string>();

  /** Called with the params of a notification; returns zero or more events. */
  notification(method: string, p: J): EventBody[] {
    switch (method) {
      case 'item/started': return this.itemStarted(p.item ?? {});
      case 'item/completed': return this.itemCompleted(p.item ?? {});
      case 'item/agentMessage/delta': { const i = this.deltaIndex.get(p.itemId) ?? 0; this.deltaIndex.set(p.itemId, i + 1); return [{ type: 'text.delta', message_id: p.itemId, index: i, text: String(p.delta ?? '') }]; }
      case 'item/reasoning/textDelta': case 'item/reasoning/summaryTextDelta': return [{ type: 'thinking.delta', message_id: p.itemId, text: String(p.delta ?? '') }];
      case 'item/fileChange/patchUpdated': if (Array.isArray(p.changes)) this.changes.set(p.itemId, p.changes); return [];
      case 'thread/tokenUsage/updated': {
        const last = p.tokenUsage?.last ?? {}; const win = p.tokenUsage?.modelContextWindow; const total = p.tokenUsage?.total?.totalTokens;
        return [{ type: 'usage.report', input_tokens: last.inputTokens ?? 0, output_tokens: last.outputTokens ?? 0, ...(last.cachedInputTokens ? { cache_read_tokens: last.cachedInputTokens } : {}), cost_is_estimate: true, ...(win && total ? { context_used_pct: Math.min(100, Math.round((total / win) * 100)) } : {}) }];
      }
      case 'account/rateLimits/updated': {
        const r = p.rateLimits ?? {}; const windows: { name: string; utilization: number; resets_at: number }[] = [];
        for (const [k, fb] of [['primary', 'five_hour'], ['secondary', 'seven_day']] as const) { const w = r[k]; if (w) windows.push({ name: windowName(w.windowDurationMins, fb), utilization: (w.usedPercent ?? 0) / 100, resets_at: w.resetsAt ?? 0 }); }
        return windows.length ? [{ type: 'limits.report', windows }] : [];
      }
      case 'turn/completed': {
        const t = p.turn ?? {}; const out: EventBody[] = [];
        if (t.status === 'failed' && t.error) out.push({ type: 'error', code: errorCodeFor(String(t.error.message ?? '')), tool_message: String(t.error.message ?? 'The turn failed'), fatal: true });
        out.push({ type: 'status', state: t.status === 'failed' ? 'error' : 'idle' });
        out.push({ type: 'turn.done', outcome: t.status === 'completed' ? 'ok' : t.status === 'interrupted' ? 'canceled' : 'error', ...(t.status ? { stop_reason: String(t.status) } : {}) });
        return out;
      }
      case 'error': {
        const msg = String(p.error?.message ?? 'Codex reported an error'); const code = errorCodeFor(msg);
        if (p.willRetry) return [{ type: 'error', code, tool_message: msg, fatal: false, retry: { attempt: 1, max_retries: 5, delay_ms: 1000 } }];
        return [{ type: 'error', code, tool_message: msg, fatal: true }];
      }
      case 'warning': case 'configWarning': case 'deprecationNotice': return [{ type: 'engine.warning', code: method, text: String(p.message ?? p.text ?? p.summary ?? method).slice(0, 300) }];
      case 'thread/compacted': return [{ type: 'compaction.ended' }];
      default: return [];
    }
  }

  private itemStarted(it: J): EventBody[] {
    switch (it.type) {
      case 'commandExecution': { const command = String(it.command ?? ''); return [{ type: 'status', state: 'running-command' }, { type: 'tool.requested', tool_id: it.id, name: 'Bash', input_summary: command.slice(0, 300), risk: classifyCommand(command), command }]; }
      case 'fileChange': {
        const ch: J[] = it.changes ?? []; this.changes.set(it.id, ch);
        const adds = ch.length > 0 && ch.every((c) => c.kind?.type === 'add'); const path = ch[0]?.path;
        return [{ type: 'status', state: adds ? 'creating-file' : 'editing-file' }, { type: 'tool.requested', tool_id: it.id, name: adds ? 'Write' : 'Edit', input_summary: ch.map((c) => c.path).join(', ').slice(0, 300) || 'file change', risk: 'medium', ...(path ? { path } : {}) }];
      }
      case 'mcpToolCall': return [{ type: 'status', state: 'tool-running' }, { type: 'tool.requested', tool_id: it.id, name: `${it.server}.${it.tool}`, input_summary: JSON.stringify(it.arguments ?? {}).slice(0, 160), risk: it.readOnlyHint ? 'low' : 'medium' }];
      case 'dynamicToolCall': return [{ type: 'status', state: 'tool-running' }, { type: 'tool.requested', tool_id: it.id, name: String(it.tool), input_summary: JSON.stringify(it.arguments ?? {}).slice(0, 160), risk: 'medium' }];
      case 'webSearch': return [{ type: 'status', state: 'searching' }, { type: 'tool.requested', tool_id: it.id, name: 'WebSearch', input_summary: String(it.query ?? ''), risk: 'low' }];
      case 'reasoning': return this.reasoningStarted.has(it.id) ? [] : (this.reasoningStarted.add(it.id), [{ type: 'status', state: 'thinking' }]);
      case 'agentMessage': return [{ type: 'status', state: 'streaming' }];
      case 'contextCompaction': return [{ type: 'compaction.started' }, { type: 'status', state: 'compacting' }];
      default: return [];
    }
  }

  private itemCompleted(it: J): EventBody[] {
    const status = (s: string): 'ok' | 'error' | 'denied' => (s === 'completed' ? 'ok' : s === 'declined' ? 'denied' : 'error');
    switch (it.type) {
      case 'agentMessage': return [{ type: 'text.done', message_id: it.id, text: String(it.text ?? '') }];
      case 'commandExecution': {
        const st = it.status === 'completed' && it.exitCode && it.exitCode !== 0 ? 'error' : status(it.status);
        const out = String(it.aggregatedOutput ?? '');
        return [{ type: 'tool.result', tool_id: it.id, status: st, summary: st === 'denied' ? 'Not allowed' : out.trim() ? tail(out) : st === 'ok' ? 'Done' : `exit code ${it.exitCode ?? '?'}` }];
      }
      case 'fileChange': {
        const ch: J[] = it.changes?.length ? it.changes : this.changes.get(it.id) ?? [];
        const st = status(it.status);
        return [{ type: 'tool.result', tool_id: it.id, status: st, summary: st === 'ok' ? `Updated ${ch.length} file${ch.length === 1 ? '' : 's'}` : st === 'denied' ? 'Not allowed' : 'Patch failed', ...(ch.length ? { diff: diffFor(ch) } : {}) }];
      }
      case 'mcpToolCall': return [{ type: 'tool.result', tool_id: it.id, status: it.status === 'completed' ? 'ok' : 'error', summary: it.error?.message ? String(it.error.message).slice(0, 300) : 'Done' }];
      case 'dynamicToolCall': return [{ type: 'tool.result', tool_id: it.id, status: it.success === false || it.status === 'failed' ? 'error' : 'ok', summary: 'Done' }];
      case 'webSearch': return [{ type: 'tool.result', tool_id: it.id, status: 'ok', summary: String(it.query ?? '') }];
      case 'contextCompaction': return [{ type: 'compaction.ended' }];
      default: return [];
    }
  }

  /** Describe a server-side approval request for the UI (needs the file changes remembered from item/started). */
  approval(method: string, p: J): ApprovalInfo {
    if (method === 'item/commandExecution/requestApproval') {
      const command = String(p.command ?? ''); return { tool_id: String(p.itemId), tool: 'Bash', summary: command.split('\n')[0]!.slice(0, 120) || 'run a command', risk: classifyCommand(command), command, ...(p.cwd ? { cwd: String(p.cwd) } : {}), ...(p.reason ? { reason: String(p.reason) } : {}) };
    }
    if (method === 'item/fileChange/requestApproval') {
      const ch = this.changes.get(String(p.itemId)) ?? []; const adds = ch.length > 0 && ch.every((c) => c.kind?.type === 'add'); const path = ch[0]?.path;
      return { tool_id: String(p.itemId), tool: adds ? 'Write' : 'Edit', summary: ch.map((c) => c.path).join(', ') || String(p.reason ?? 'file change'), risk: 'medium', ...(path ? { path } : {}), ...(ch.length ? { diff: diffFor(ch) } : {}), ...(p.reason ? { reason: String(p.reason) } : {}) };
    }
    return { tool_id: String(p.itemId ?? ''), tool: method, summary: String(p.reason ?? method), risk: 'medium' };
  }
}
