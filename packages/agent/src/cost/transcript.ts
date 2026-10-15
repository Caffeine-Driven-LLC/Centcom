/**
 * Reads a recorded Claude Code transcript (the `.jsonl` files `claude` writes) and says where the tokens went: requests, context growth,
 * prompt-cache behaviour, sub-agents, and which text Centcom put in front of the model. Owns only the arithmetic; it reads no files and
 * prints nothing. It must not keep message text: only counts leave this module.
 */
import { estimateTokens } from '../board/text.js';

type J = Record<string, unknown>;

/** One API request as the transcript recorded it (a request is written on several lines; they are merged by message id). */
export interface RequestRecord { id: string; agent: 'main' | 'sub'; model: string; input: number; cacheWrite: number; cacheRead: number; output: number; at?: number }

/** The markers Centcom's own text carries (see board/digest.ts, skills injection, the team notice and the carry-over summary). */
export const CENTCOM_MARKERS: { name: string; re: RegExp }[] = [
  { name: 'auto skills', re: /\[Centcom auto skills:[\s\S]*?\n\n/g },
  { name: 'team context (board digest)', re: /<team-context>[\s\S]*?<\/team-context>\n*/g },
  { name: 'team notice', re: /\[Centcom team notice[\s\S]*?\]\n\n/g },
  { name: 'carry-over summary', re: /This conversation (?:is being continued|started with another coding agent)\. Summary of it so far:[\s\S]*/g },
  { name: 'budget notice', re: /\[Centcom budget[^\]]*\]\n*/g },
];

export interface CacheBreak { index: number; agent: 'main' | 'sub'; rewritten: number; idleMs?: number; cause: 'idle' | 'rewrite' }
export interface TranscriptSummary {
  requests: { main: number; sub: number };
  models: Record<string, number>;
  totals: { input: number; cacheWrite: number; cacheRead: number; output: number };
  byAgent: { main: { input: number; cacheWrite: number; cacheRead: number; output: number }; sub: { input: number; cacheWrite: number; cacheRead: number; output: number } };
  /** Prompt size (fresh + cache write + cache read) of the first and last main request, and the largest. */
  context: { first: number; last: number; max: number };
  /** cacheRead / (cacheRead + cacheWrite + input) over all requests; 1 is a perfect prompt cache. */
  cacheHitRatio: number;
  /** Requests whose prompt was mostly rewritten into the cache instead of read from it. `idle` = more than 5 minutes after the one before (the cache expired); `rewrite` = the early part of the prompt was written again (it changed, or the context was edited). */
  cacheBreaks: CacheBreak[];
  subagentCalls: number;
  userMessages: number;
  /** Text Centcom put into user messages, by kind: how many messages carried it and about how many tokens. */
  centcomText: { kind: string; messages: number; tokens: number }[];
  /** Tokens of the very first request: what the session costs before the person has done anything. */
  firstRequestTokens: number;
}

const num = (v: unknown): number => (typeof v === 'number' && Number.isFinite(v) ? v : 0);
const obj = (v: unknown): J | undefined => (v && typeof v === 'object' && !Array.isArray(v) ? (v as J) : undefined);

/** Merges the lines of one transcript into one record per request. `agent` says which kind of transcript this file is. */
export function requestsOf(lines: Iterable<string>, agent: 'main' | 'sub'): { requests: RequestRecord[]; userTexts: string[]; agentToolCalls: number } {
  const byId = new Map<string, RequestRecord>(); const order: string[] = []; const userTexts: string[] = []; let agentToolCalls = 0; const seenTools = new Set<string>();
  for (const line of lines) {
    if (!line.trim()) continue; let d: J; try { d = JSON.parse(line) as J; } catch { continue; }
    const m = obj(d.message);
    if (d.type === 'assistant' && m) {
      const u = obj(m.usage); const content = Array.isArray(m.content) ? m.content : [];
      for (const b of content) { const bo = obj(b); if (bo?.type === 'tool_use' && (bo.name === 'Agent' || bo.name === 'Task') && !seenTools.has(String(bo.id))) { seenTools.add(String(bo.id)); agentToolCalls++; } }
      if (!u || m.model === '<synthetic>') continue;
      const id = String(m.id ?? d.requestId ?? d.uuid ?? order.length); const at = typeof d.timestamp === 'string' ? Date.parse(d.timestamp) : undefined;
      const rec: RequestRecord = { id, agent, model: String(m.model ?? 'unknown'), input: num(u.input_tokens), cacheWrite: num(u.cache_creation_input_tokens), cacheRead: num(u.cache_read_input_tokens), output: num(u.output_tokens), ...(at !== undefined && Number.isFinite(at) ? { at } : {}) };
      const old = byId.get(id);
      if (!old) { byId.set(id, rec); order.push(id); } else byId.set(id, { ...old, output: Math.max(old.output, rec.output), input: Math.max(old.input, rec.input), cacheWrite: Math.max(old.cacheWrite, rec.cacheWrite), cacheRead: Math.max(old.cacheRead, rec.cacheRead) });
    } else if (d.type === 'user' && m && agent === 'main') {
      const c = m.content; if (typeof c === 'string') userTexts.push(c); else if (Array.isArray(c)) for (const b of c) { const bo = obj(b); if (bo?.type === 'text' && typeof bo.text === 'string') userTexts.push(bo.text); }
    }
  }
  return { requests: order.map((i) => byId.get(i)!), userTexts, agentToolCalls };
}

const FIVE_MIN = 5 * 60_000;
const total = (r: RequestRecord): number => r.input + r.cacheWrite + r.cacheRead;

/** Where the tokens of one session went. `main` is the session transcript, `subs` the transcripts of its sub-agents. */
export function summarizeTranscript(main: Iterable<string>, subs: Iterable<string>[] = []): TranscriptSummary {
  const m = requestsOf(main, 'main'); const sub = subs.map((s) => requestsOf(s, 'sub'));
  const subReqs = sub.flatMap((s) => s.requests); const all = [...m.requests, ...subReqs];
  const sum = (rs: RequestRecord[]) => rs.reduce((a, r) => ({ input: a.input + r.input, cacheWrite: a.cacheWrite + r.cacheWrite, cacheRead: a.cacheRead + r.cacheRead, output: a.output + r.output }), { input: 0, cacheWrite: 0, cacheRead: 0, output: 0 });
  const totals = sum(all); const models: Record<string, number> = {}; for (const r of all) models[r.model] = (models[r.model] ?? 0) + 1;
  const breaks: CacheBreak[] = [];
  const scan = (rs: RequestRecord[], agent: 'main' | 'sub') => { for (let i = 1; i < rs.length; i++) { const prev = rs[i - 1]!; const r = rs[i]!; const prevTotal = total(prev); if (prevTotal < 2000) continue; if (r.cacheRead < prevTotal * 0.5 && r.cacheWrite > prevTotal * 0.5) { const idle = r.at !== undefined && prev.at !== undefined ? r.at - prev.at : undefined; breaks.push({ index: i, agent, rewritten: r.cacheWrite, ...(idle !== undefined ? { idleMs: idle } : {}), cause: idle !== undefined && idle > FIVE_MIN ? 'idle' : 'rewrite' }); } } };
  scan(m.requests, 'main'); for (const s of sub) scan(s.requests, 'sub');
  const ctx = m.requests.map(total);
  const centcomText = CENTCOM_MARKERS.map(({ name, re }) => { let messages = 0; let tokens = 0; for (const t of m.userTexts) { const found = t.match(new RegExp(re.source, re.flags)); if (found) { messages++; tokens += found.reduce((a, f) => a + estimateTokens(f), 0); } } return { kind: name, messages, tokens }; }).filter((k) => k.messages > 0);
  const denom = totals.cacheRead + totals.cacheWrite + totals.input;
  return {
    requests: { main: m.requests.length, sub: subReqs.length }, models, totals,
    byAgent: { main: sum(m.requests), sub: sum(subReqs) },
    context: { first: ctx[0] ?? 0, last: ctx.at(-1) ?? 0, max: ctx.length ? Math.max(...ctx) : 0 },
    cacheHitRatio: denom ? totals.cacheRead / denom : 0, cacheBreaks: breaks,
    subagentCalls: m.agentToolCalls, userMessages: m.userTexts.length, centcomText,
    firstRequestTokens: ctx[0] ?? 0,
  };
}

const k = (n: number): string => (n >= 10_000 ? `${Math.round(n / 1000)}k` : n >= 1000 ? `${(n / 1000).toFixed(1)}k` : String(n));
const tok = (n: number): string => (n >= 1_000_000 ? `${(n / 1_000_000).toFixed(1)}M` : k(n));

/** The summary as plain lines for a terminal or the docs. */
export function formatTranscriptSummary(s: TranscriptSummary): string[] {
  const out: string[] = [];
  out.push(`requests: ${s.requests.main} main + ${s.requests.sub} sub-agent (${s.subagentCalls} sub-agent calls)`);
  out.push(`models: ${Object.entries(s.models).map(([a, n]) => `${a} x${n}`).join(', ') || 'none'}`);
  out.push(`output tokens: ${tok(s.totals.output)} (main ${tok(s.byAgent.main.output)}, sub-agents ${tok(s.byAgent.sub.output)})`);
  out.push(`prompt tokens read from cache: ${tok(s.totals.cacheRead)}; written to cache: ${tok(s.totals.cacheWrite)}; fresh: ${tok(s.totals.input)}`);
  out.push(`context: ${tok(s.context.first)} at the first request, ${tok(s.context.last)} at the last, ${tok(s.context.max)} at most`);
  out.push(`cache hit ratio: ${(s.cacheHitRatio * 100).toFixed(1)} %; cache breaks: ${s.cacheBreaks.length} (${s.cacheBreaks.filter((b) => b.cause === 'rewrite').length} early rewrites, ${s.cacheBreaks.filter((b) => b.cause === 'idle').length} after 5 min idle; ${tok(s.cacheBreaks.reduce((a, b) => a + b.rewritten, 0))} tokens rewritten)`);
  out.push(s.centcomText.length ? `text Centcom added to your messages: ${s.centcomText.map((c) => `${c.kind} in ${c.messages} message(s), about ${tok(c.tokens)} tokens`).join('; ')}` : 'text Centcom added to your messages: none found');
  return out;
}
