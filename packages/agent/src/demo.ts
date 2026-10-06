/**
 * Demo engine: a scripted agent that produces realistic event streams (reading, searching, editing with a diff,
 * approvals, failing then passing tests, errors). Used for development, tests and `centcom --demo`; it needs no
 * network, no login and no model. Same AgentEngine interface as the real engines.
 */
import { AsyncQueue } from './queue.js';
import { newId } from './ids.js';
import { classifyCommand } from './risk.js';
import type { AgentEngine, ApprovalDecision, Capability, EngineSession, EngineStartOptions, EventBody, NormalisedEvent, PermissionGate, Risk } from './types.js';

const CAPS = new Set<Capability>(['streaming', 'approvals', 'resume', 'subagents', 'thinking', 'usage', 'interrupt', 'compact']);

const DIFF = `--- a/src/auth/session.ts
+++ b/src/auth/session.ts
@@ -41,7 +41,9 @@ export function isExpired(session: Session, now = Date.now()) {
   if (!session.expiresAt) return false;
-  return session.expiresAt < now;
+  // expiresAt is in seconds; Date.now() is in milliseconds
+  const expiresMs = session.expiresAt * 1000;
+  return expiresMs <= now;
 }
`;

export interface DemoOptions { speed?: number }
export class DemoEngine implements AgentEngine {
  readonly id = 'fake' as const; readonly provider = 'other' as const; readonly label = 'Demo';
  constructor(private d: DemoOptions = {}) {}
  capabilities() { return CAPS; }
  async start(o: EngineStartOptions): Promise<EngineSession> { return new DemoSession(o, this.d.speed ?? 1); }
}

class DemoSession implements EngineSession {
  readonly agentId: string; readonly events = new AsyncQueue<NormalisedEvent>();
  private seq = 0; private turn?: string; private abort?: AbortController; private sid = newId('ses'); private gate?: PermissionGate; private n = 0;
  constructor(o: EngineStartOptions, private speed: number) { this.agentId = o.agentId; this.gate = o.approvalGate; this.sessionStarted(o); }
  resumeToken() { return this.sid; }
  private emit(b: EventBody) { this.events.push({ ...b, v: 1, seq: ++this.seq, ts: new Date().toISOString(), agent_id: this.agentId, ...(this.turn ? { turn_id: this.turn } : {}) } as NormalisedEvent); }
  private sessionStarted(o: EngineStartOptions) {
    this.emit({ type: 'session.started', engine: 'fake', engine_session_id: this.sid, model: o.model ?? 'demo-model', cli_version: 'demo', tools: ['Read', 'Edit', 'Bash', 'Grep'], mcp_servers: [], capabilities: [...CAPS], login_kind: 'unknown' });
  }
  private sleep(ms: number) {
    const sig = this.abort?.signal;
    return new Promise<void>((res, rej) => {
      if (this.speed <= 0) return res();
      const t = setTimeout(res, ms / this.speed);
      sig?.addEventListener('abort', () => { clearTimeout(t); rej(new Error('abort')); }, { once: true });
    });
  }
  async interrupt() { if (!this.abort) return { stopped: false }; this.abort.abort(); return { stopped: true }; }
  async stop() { await this.interrupt(); this.events.close(); }
  async send(prompt: string) {
    const turn = newId('trn'); this.turn = turn; this.abort = new AbortController();
    this.emit({ type: 'turn.started', turn_id: turn });
    void this.run(prompt).catch(() => { this.emit({ type: 'status', state: 'idle' }); this.emit({ type: 'turn.done', outcome: 'canceled' }); }).finally(() => { this.abort = undefined; });
    return { turn_id: turn };
  }

  private async say(text: string, perMs = 22) {
    const id = newId('msg'); this.emit({ type: 'status', state: 'streaming' });
    const words = text.split(/(\s+)/); let i = 0, chunk = '';
    for (const w of words) { chunk += w; if (chunk.length >= 12 || w.includes('\n')) { this.emit({ type: 'text.delta', message_id: id, index: i++, text: chunk }); chunk = ''; await this.sleep(perMs * 3); } }
    if (chunk) this.emit({ type: 'text.delta', message_id: id, index: i++, text: chunk });
    this.emit({ type: 'text.done', message_id: id, input_tokens: 1800 + this.n * 300, output_tokens: Math.ceil(text.length / 4) });
  }
  private async think(text: string, hard = false) {
    this.emit({ type: 'status', state: hard ? 'thinking-hard' : 'thinking' });
    const id = newId('msg'); for (const part of text.match(/.{1,40}(\s|$)/g) ?? [text]) { this.emit({ type: 'thinking.delta', message_id: id, text: part }); await this.sleep(60); }
    await this.sleep(300);
  }
  private async tool(name: string, state: string, summary: string, risk: Risk, result: { status: 'ok' | 'error'; summary: string; diff?: string }, extra: { path?: string; command?: string; ask?: { diff?: string } } = {}) {
    const id = newId('tu');
    this.emit({ type: 'status', state });
    this.emit({ type: 'tool.requested', tool_id: id, name, input_summary: summary, risk, ...(extra.path ? { path: extra.path } : {}), ...(extra.command ? { command: extra.command } : {}) });
    await this.sleep(500);
    if (extra.ask || risk !== 'low') {
      const aid = newId('apr');
      this.emit({ type: 'approval.requested', approval_id: aid, tool_id: id, summary: `${name}: ${summary}`, risk, ...(extra.command ? { command: extra.command } : {}), ...(extra.ask?.diff ? { diff: extra.ask.diff } : {}), ...(extra.path ? { path: extra.path } : {}) });
      this.emit({ type: 'status', state: 'awaiting-approval' });
      const d: ApprovalDecision = this.gate ? await this.gate.decide({ approval_id: aid, agent_id: this.agentId, tool_id: id, tool: name, summary, risk, ...(extra.command ? { command: extra.command } : {}), ...(extra.ask?.diff ? { diff: extra.ask.diff } : {}), ...(extra.path ? { path: extra.path } : {}) }) : { decision: 'approve', scope: 'once' };
      this.emit({ type: 'approval.resolved', approval_id: aid, decision: d.decision, scope: d.scope, by: 'user' });
      if (d.decision === 'deny') { this.emit({ type: 'status', state: 'denied' }); this.emit({ type: 'tool.result', tool_id: id, status: 'denied', summary: 'You declined this action.' }); await this.sleep(700); return false; }
      this.emit({ type: 'status', state: state });
    }
    await this.sleep(900);
    this.emit({ type: 'tool.result', tool_id: id, status: result.status, summary: result.summary, ...(result.diff ? { diff: result.diff } : {}) });
    return result.status === 'ok';
  }
  private usage() { this.n++; this.emit({ type: 'usage.report', input_tokens: 2400 * this.n, output_tokens: 610 * this.n, cache_read_tokens: 9000, cost_usd: 0.031 * this.n, cost_is_estimate: true, context_used_pct: Math.min(95, 12 * this.n) }); this.emit({ type: 'limits.report', windows: [{ name: 'five_hour', utilization: Math.min(0.97, 0.18 + 0.05 * this.n), resets_at: Math.floor(Date.now() / 1000) + 3 * 3600 }, { name: 'seven_day', utilization: 0.41, resets_at: Math.floor(Date.now() / 1000) + 3 * 86400 }] }); }
  private done(ok = true) { this.usage(); this.emit({ type: 'status', state: ok ? 'success' : 'idle' }); this.emit({ type: 'turn.done', outcome: ok ? 'ok' : 'error', stop_reason: 'completed' }); }

  private async run(prompt: string) {
    const p = prompt.toLowerCase();
    this.emit({ type: 'status', state: 'prompt-received' }); await this.sleep(250);
    if (/\berror\b|sign.?in|login/.test(p)) {
      this.emit({ type: 'error', code: 'provider_not_signed_in', tool_message: 'Not logged in. Run `claude auth login` in your terminal, then try again.', fatal: true });
      this.emit({ type: 'status', state: 'provider-auth-required' }); this.emit({ type: 'turn.done', outcome: 'error', stop_reason: 'auth' }); return;
    }
    if (/limit|cap|quota/.test(p)) {
      this.emit({ type: 'error', code: 'provider_cap_reached', tool_message: 'You reached your 5-hour usage limit. It resets at 18:40.', fatal: true });
      this.emit({ type: 'status', state: 'provider-cap-reached' }); this.emit({ type: 'turn.done', outcome: 'error', stop_reason: 'cap' }); return;
    }
    if (/delete|danger|force|wipe|clean/.test(p)) {
      await this.think('The user wants a clean slate. That involves deleting files, so I should ask first.');
      await this.say('I can clear the build output and reinstall, but these commands are destructive, so I need your approval first.\n');
      const ok = await this.tool('Bash', 'running-command', 'rm -rf node_modules dist && git push --force', classifyCommand('rm -rf node_modules dist && git push --force'), { status: 'ok', summary: 'removed 2 directories' }, { command: 'rm -rf node_modules dist && git push --force' });
      await this.say(ok ? 'Done. Everything is clean.' : 'No problem, I left everything as it was.');
      return this.done(true);
    }
    if (/search|find|where|grep/.test(p)) {
      await this.think('I will search the codebase for the symbol and read the best match.');
      await this.tool('Grep', 'searching', 'isExpired in src/', 'low', { status: 'ok', summary: '4 matches in 3 files' });
      await this.tool('Read', 'reading-file', 'src/auth/session.ts', 'low', { status: 'ok', summary: '142 lines' }, { path: 'src/auth/session.ts' });
      await this.say('`isExpired` is defined in **src/auth/session.ts** (line 41) and used in:\n\n- `src/auth/middleware.ts`\n- `src/api/refresh.ts`\n- `test/auth/session.test.ts`\n');
      return this.done(true);
    }
    if (/compact|context/.test(p)) {
      await this.say('The context is getting long, so I will compact it.\n');
      this.emit({ type: 'status', state: 'compacting' }); this.emit({ type: 'compaction.started' }); await this.sleep(1800);
      this.emit({ type: 'compaction.ended', tokens_before: 142000, tokens_after: 21000 });
      await this.say('Compacted from 142k to 21k tokens. Nothing important was lost.');
      return this.done(true);
    }
    if (/ask|which|choose/.test(p)) {
      this.emit({ type: 'status', state: 'asking-question' }); this.emit({ type: 'question.asked', question_id: newId('que'), text: 'Should I fix this in `isExpired` or in the caller?', options: ['In isExpired', 'In the caller'] });
      await this.sleep(1500); await this.say('I will fix it in `isExpired`, since every caller shares the same bug.');
      return this.done(true);
    }
    // default: the classic "fix the failing test" story
    await this.think('The test fails on a boundary. Let me read the session code and find where expiry is compared.', true);
    await this.say("I'll start by looking at the failing test and the code it covers.\n");
    await this.tool('Read', 'reading-file', 'test/auth/session.test.ts', 'low', { status: 'ok', summary: '88 lines' }, { path: 'test/auth/session.test.ts' });
    await this.tool('Grep', 'searching', 'expiresAt in src/', 'low', { status: 'ok', summary: '3 matches in 2 files' });
    await this.think('expiresAt is stored in seconds but compared with Date.now(), which is milliseconds.');
    await this.say('Found it: `expiresAt` is in **seconds** but `isExpired` compares it with `Date.now()` (**milliseconds**), so sessions look valid far too long.\n');
    const edited = await this.tool('Edit', 'editing-file', 'src/auth/session.ts', 'medium', { status: 'ok', summary: 'Updated 1 file, +3 -1', diff: DIFF }, { path: 'src/auth/session.ts', ask: { diff: DIFF } });
    if (!edited) { await this.say('Understood, I did not change the file. Tell me how you would like to fix it.'); return this.done(true); }
    const t1 = await this.tool('Bash', 'running-command', 'pnpm test auth', 'medium', { status: 'error', summary: 'FAIL test/auth/refresh.test.ts\n  1 failed, 11 passed' }, { command: 'pnpm test auth' });
    if (!t1) { await this.say('The tests still fail in the refresh flow. The same unit bug is there.'); await this.tool('Edit', 'editing-file', 'src/api/refresh.ts', 'medium', { status: 'ok', summary: 'Updated 1 file, +1 -1', diff: DIFF.replace(/session\.ts/g, 'refresh.ts') }, { path: 'src/api/refresh.ts', ask: { diff: DIFF.replace(/session\.ts/g, 'refresh.ts') } }); }
    await this.tool('Bash', 'running-command', 'pnpm test auth', 'medium', { status: 'ok', summary: 'PASS  12 tests' }, { command: 'pnpm test auth' });
    await this.say('All **12 tests pass** now.\n\nWhat changed:\n\n- `isExpired` converts `expiresAt` to milliseconds\n- the refresh flow had the same bug and got the same fix\n\n```ts\nconst expiresMs = session.expiresAt * 1000;\nreturn expiresMs <= now;\n```\n');
    this.done(true);
  }
}
