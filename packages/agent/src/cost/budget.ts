/**
 * The budget guard (on by default): counts what a run and a session have used from the engine's own reports and says when to stop and ask.
 * A run is one request from the person and everything the agent does for it, including its sub-agents; a "continue" does not start a new one.
 * Owns the counting and the decision; it must not interrupt anything itself (the app does that), and it has no price table:
 * cost is only what the engine reported.
 */
import { estimateTokens } from '../board/text.js';
import type { NormalisedEvent } from '../types.js';

/** Every limit; 0 turns that one off. */
export interface BudgetLimits {
  /** The guard as a whole. */ enabled: boolean;
  runRequests: number; runOutputTokens: number; runUsd: number;
  sessionRequests: number; sessionOutputTokens: number; sessionUsd: number;
  /** Autonomous "continue" runs in a row before it asks. */ maxContinues: number;
  /** Sub-agents one run may start (0 = none; negative = no limit). */ maxSubagents: number;
  /** A prompt of about this many tokens is confirmed before it is sent. */ bigPromptTokens: number;
}
/** Low enough to stop a job the size of the 683-request, 2.5M-output-token SAT session long before it ends. */
export const DEFAULT_LIMITS: BudgetLimits = { enabled: true, runRequests: 60, runOutputTokens: 400_000, runUsd: 5, sessionRequests: 400, sessionOutputTokens: 1_500_000, sessionUsd: 0, maxContinues: 3, maxSubagents: 6, bigPromptTokens: 2000 };

export type StopReason = 'run_requests' | 'run_output_tokens' | 'run_usd' | 'session_requests' | 'session_output_tokens' | 'session_usd' | 'continues' | 'subagents';
export interface Stop { reason: StopReason; used: number; limit: number; /** One plain sentence for the person. */ text: string }
export interface Counters { requests: number; outputTokens: number; usd: number; subagents: number }
export interface Meter { enabled: boolean; run: Counters; session: Counters; limits: BudgetLimits; continues: number; paused?: Stop; startedAt: number }

const zero = (): Counters => ({ requests: 0, outputTokens: 0, usd: 0, subagents: 0 });
export const compact = (n: number): string => (n >= 1_000_000 ? `${(n / 1_000_000).toFixed(1)}M` : n >= 1000 ? `${Math.round(n / 1000)}k` : String(Math.round(n)));
const WHAT: Record<StopReason, (u: number, l: number) => string> = {
  run_requests: (u, l) => `This run has made ${u} requests to the model (the limit is ${l}).`,
  run_output_tokens: (u, l) => `This run has produced ${compact(u)} tokens of output (the limit is ${compact(l)}).`,
  run_usd: (u, l) => `This run has cost about $${u.toFixed(2)} as the engine reports it (the limit is $${l.toFixed(2)}).`,
  session_requests: (u, l) => `This conversation has made ${u} requests (the limit is ${l}).`,
  session_output_tokens: (u, l) => `This conversation has produced ${compact(u)} tokens of output (the limit is ${compact(l)}).`,
  session_usd: (u, l) => `This conversation has cost about $${u.toFixed(2)} as the engine reports it (the limit is $${l.toFixed(2)}).`,
  continues: (u, l) => `That is ${u} "continue" messages in a row without a new task from you (the limit is ${l}).`,
  subagents: (u, l) => `This run has started ${u} sub-agents (the limit is ${l}).`,
};

/** What kind of message this is for the budget. */
export type PromptKind = 'task' | 'continue';
const CONTINUE_RE = /^(?:ok(?:ay)?|yes|yeah|please|pls|just|then|now|and)?[\s,.!-]*(?:continue|keep going|go on|carry on|proceed|next|resume|do whatever|choose (?:whatever|what)|you (?:decide|choose)|up to you)\b/i;
const BIG_VERB_RE = /\b(?:build|create|make|implement|generate|write|develop)\b[\s\S]{0,80}\b(?:app|application|platform|system|website|site|game|tool|product|backend|frontend|library)\b/i;
const BIG_SCOPE_RE = /\b(?:from scratch|entire|whole|everything|complete|full[- ]stack|end[- ]to[- ]end|large|thousands?|hundreds?|choose (?:whatever|what)|you decide|as you see fit)\b/i;
/** A short "continue"-style message is an autonomous continuation; anything else is a new task. */
export function classifyPrompt(text: string): PromptKind { const t = text.trim(); return t.length <= 160 && CONTINUE_RE.test(t) ? 'continue' : 'task'; }
export interface BigPrompt { tokens: number; why: 'long' | 'build_everything' }
/** A prompt that should be confirmed before it is sent: long, or a "build the whole thing" job. */
export function bigPrompt(text: string, limits: Pick<BudgetLimits, 'bigPromptTokens'>): BigPrompt | undefined {
  const tokens = estimateTokens(text); if (!limits.bigPromptTokens) return undefined;
  if (tokens >= limits.bigPromptTokens) return { tokens, why: 'long' };
  if (tokens >= Math.round(limits.bigPromptTokens / 40) && BIG_VERB_RE.test(text) && BIG_SCOPE_RE.test(text)) return { tokens, why: 'build_everything' };
  return undefined;
}

export class BudgetGuard {
  private run = zero(); private runBase = zero(); private session = zero(); private sessionBase = zero();
  private continues = 0; private paused?: Stop; private lastCost = 0; private startedAt: number; private limits: BudgetLimits; private gateSeen = false;
  constructor(limits: Partial<BudgetLimits> = {}, private now: () => number = Date.now) { this.limits = { ...DEFAULT_LIMITS, ...limits }; this.startedAt = now(); }

  get enabled(): boolean { return this.limits.enabled; }
  get config(): BudgetLimits { return this.limits; }
  setEnabled(on: boolean): void { this.limits = { ...this.limits, enabled: on }; if (!on) this.paused = undefined; }
  setLimits(l: Partial<BudgetLimits>): void { this.limits = { ...this.limits, ...l }; }
  /** The limit that has stopped the run and is waiting for the person's answer, if any. */
  get stop(): Stop | undefined { return this.paused; }

  /** A message is about to be sent. A new task starts a new run; a "continue" stays in the one it continues. Returns a stop when a row of "continue" messages has gone on too long. */
  startRun(kind: PromptKind): Stop | undefined {
    if (kind === 'task') { this.run = zero(); this.runBase = zero(); this.continues = 0; if (!this.paused?.reason.startsWith('session')) this.paused = undefined; this.startedAt = this.now(); return undefined; }
    this.continues++;
    const max = this.limits.maxContinues;
    if (this.limits.enabled && max > 0 && this.continues > max) return this.pause({ reason: 'continues', used: this.continues, limit: max });
    return undefined;
  }

  private pause(s: Omit<Stop, 'text'>): Stop { const stop = { ...s, text: WHAT[s.reason](s.used, s.limit) }; this.paused = stop; return stop; }

  /** One event of the engine's stream. Returns a stop the first time a limit is passed (and not again until the person lets it go on). */
  note(ev: NormalisedEvent): Stop | undefined {
    if (ev.type === 'usage.progress') { for (const c of [this.run, this.session]) { c.requests += 1; c.outputTokens += ev.output_tokens; } }
    else if (ev.type === 'usage.report') {
      const total = ev.cost_usd; if (typeof total === 'number') { const d = total >= this.lastCost ? total - this.lastCost : total; this.lastCost = total; this.run.usd += d; this.session.usd += d; }
    } else if (ev.type === 'subagent.started') {
      if (this.gateSeen) return undefined; // the engine asked before starting it: already counted and limited there
      this.run.subagents++; this.session.subagents++;
      const max = this.limits.maxSubagents;
      if (this.limits.enabled && max >= 0 && this.run.subagents > max && !this.paused) return this.pause({ reason: 'subagents', used: this.run.subagents, limit: max });
      return undefined;
    } else return undefined;
    return this.check();
  }

  private check(): Stop | undefined {
    const l = this.limits; if (!l.enabled || this.paused) return undefined;
    const r = { requests: this.run.requests - this.runBase.requests, outputTokens: this.run.outputTokens - this.runBase.outputTokens, usd: this.run.usd - this.runBase.usd };
    const s = { requests: this.session.requests - this.sessionBase.requests, outputTokens: this.session.outputTokens - this.sessionBase.outputTokens, usd: this.session.usd - this.sessionBase.usd };
    if (l.runRequests > 0 && r.requests >= l.runRequests) return this.pause({ reason: 'run_requests', used: r.requests, limit: l.runRequests });
    if (l.runOutputTokens > 0 && r.outputTokens >= l.runOutputTokens) return this.pause({ reason: 'run_output_tokens', used: r.outputTokens, limit: l.runOutputTokens });
    if (l.runUsd > 0 && r.usd >= l.runUsd) return this.pause({ reason: 'run_usd', used: r.usd, limit: l.runUsd });
    if (l.sessionRequests > 0 && s.requests >= l.sessionRequests) return this.pause({ reason: 'session_requests', used: s.requests, limit: l.sessionRequests });
    if (l.sessionOutputTokens > 0 && s.outputTokens >= l.sessionOutputTokens) return this.pause({ reason: 'session_output_tokens', used: s.outputTokens, limit: l.sessionOutputTokens });
    if (l.sessionUsd > 0 && s.usd >= l.sessionUsd) return this.pause({ reason: 'session_usd', used: s.usd, limit: l.sessionUsd });
    return undefined;
  }

  /** A sub-agent is about to start (the engine asks first, through a hook). Counts it when allowed. */
  allowSubagent(): { allow: boolean; reason?: string } {
    this.gateSeen = true; const max = this.limits.maxSubagents;
    if (this.limits.enabled && max >= 0 && this.run.subagents >= max) return { allow: false, reason: `Centcom's sub-agent limit for this run is reached (${max}). Do the rest yourself in this conversation, or tell the user they can raise agent.max_subagents.` };
    this.run.subagents++; this.session.subagents++; return { allow: true };
  }

  /** The person said to go on: the limit that stopped it starts a fresh window from here. */
  extend(): void {
    this.runBase = { ...this.run };
    if (this.paused?.reason.startsWith('session')) this.sessionBase = { ...this.session };
    if (this.paused?.reason === 'continues') this.continues = 0;
    if (this.paused?.reason === 'subagents') this.run.subagents = 0;
    this.paused = undefined;
  }

  /** A new conversation: everything starts again. */
  resetSession(): void { this.run = zero(); this.runBase = zero(); this.session = zero(); this.sessionBase = zero(); this.continues = 0; this.paused = undefined; this.lastCost = 0; this.startedAt = this.now(); }

  /** What is left of the run's cost allowance, for the engine's own per-turn cap; undefined when the cost limit is off. */
  remainingRunUsd(): number | undefined { const l = this.limits; if (!l.enabled || l.runUsd <= 0) return undefined; return Math.max(0.5, l.runUsd - (this.run.usd - this.runBase.usd)); }

  meter(): Meter { return { enabled: this.limits.enabled, run: { ...this.run }, session: { ...this.session }, limits: this.limits, continues: this.continues, ...(this.paused ? { paused: this.paused } : {}), startedAt: this.startedAt }; }
}

/** The "what this run may use" sentence shown with a big-prompt question. */
export function allowanceText(l: BudgetLimits): string {
  if (!l.enabled) return 'The budget guard is off, so nothing will pause it.';
  const parts = [l.runRequests > 0 ? `${l.runRequests} requests` : '', l.runOutputTokens > 0 ? `${compact(l.runOutputTokens)} output tokens` : '', l.runUsd > 0 ? `$${l.runUsd.toFixed(2)}` : '', l.maxSubagents >= 0 ? `${l.maxSubagents} sub-agents` : ''].filter(Boolean);
  return parts.length ? `It pauses and asks after ${parts.join(', ')}.` : 'No run limit is set.';
}

/** The limits from the settings (`budget.*` and `agent.max_subagents`). */
export function limitsFromConfig(c: { budget: { enabled: boolean; run_requests: number; run_output_tokens: number; run_usd: number; session_requests: number; session_output_tokens: number; session_usd: number; max_continues: number; big_prompt_tokens: number }; agent: { max_subagents: number } }): BudgetLimits {
  const b = c.budget; return { enabled: b.enabled, runRequests: b.run_requests, runOutputTokens: b.run_output_tokens, runUsd: b.run_usd, sessionRequests: b.session_requests, sessionOutputTokens: b.session_output_tokens, sessionUsd: b.session_usd, maxContinues: b.max_continues, maxSubagents: c.agent.max_subagents, bigPromptTokens: b.big_prompt_tokens };
}
