/** What `-p` writes to stdout: plain text, one result object, or Centcom's normalised events one per line. Never the CLI's raw output. */
import { redact } from '@centcom/protocol';
import type { NormalisedEvent } from '@centcom/agent';

/** The only event names stream-json carries (besides the final `result`). */
export const STREAM_TYPES = new Set(['session.started', 'text.delta', 'text.done', 'tool.requested', 'tool.result', 'approval.requested', 'usage.report', 'turn.done', 'error']);
export interface PrintUsage { input_tokens?: number; output_tokens?: number; cache_read_tokens?: number; cost_usd_estimate?: number }
export interface PrintResult { is_error: boolean; result: string; usage: PrintUsage; session_id: string; engine: string; duration_ms: number; error?: { code: string; message: string; retry_after_s?: number; request_id?: string } }

/** Removes secrets from every string, at any depth. */
export function scrubDeep<T>(v: T): T {
  if (typeof v === 'string') return redact(v) as T; if (Array.isArray(v)) return v.map(scrubDeep) as T;
  if (v && typeof v === 'object') return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, scrubDeep(x)])) as T; return v;
}
export function formatResult(r: PrintResult, _fmt: 'json' | 'stream-json' = 'json'): string { return JSON.stringify(scrubDeep({ type: 'result', ...r })) + '\n'; }
/** One line for stream-json, or nothing for events that are not part of it. */
export function streamLine(ev: NormalisedEvent): string | undefined { return STREAM_TYPES.has(ev.type) ? JSON.stringify(scrubDeep(ev)) + '\n' : undefined; }

/** Streamed text arrives in pieces, and a secret can be cut in two by the split. This holds back the unfinished last word until the next piece (or the end), so a token is never scrubbed in halves. */
export class Holdback {
  private pending = '';
  /** Add a piece; returns what is safe to print now (up to the last whitespace). */
  push(piece: string): string { this.pending += piece; const cut = Math.max(this.pending.lastIndexOf(' '), this.pending.lastIndexOf('\n'), this.pending.lastIndexOf('\t')); if (cut < 0) return ''; const out = this.pending.slice(0, cut + 1); this.pending = this.pending.slice(cut + 1); return out; }
  /** Whatever is left (at the end of a message). */
  flush(): string { const out = this.pending; this.pending = ''; return out; }
}
