#!/usr/bin/env node
// A scripted stand-in for `codex app-server` using the real protocol shapes (from `codex app-server generate-json-schema`).
// Behaviour is chosen by the prompt text: "edit" -> asks to change a file, "run" -> asks to run a command, "slow" -> waits for interrupt, "fail" -> turn fails.
import { createInterface } from 'node:readline';
const signedIn = process.env.FAKE_CODEX_SIGNED_IN !== '0';
const out = (o) => process.stdout.write(JSON.stringify(o) + '\n');
let n = 100; let turnId = 0; let pendingApproval; let slowTimer; let current;
const rl = createInterface({ input: process.stdin });
const note = (method, params) => out({ method, params });
const item = (turn, it, kind) => note(kind, { item: it, threadId: 't1', turnId: turn, startedAtMs: 1 });

function finish(turn, status, error) { note('turn/completed', { threadId: 't1', turn: { id: turn, items: [], status, ...(error ? { error } : {}) } }); current = undefined; }
function runTurn(turn, text) {
  note('turn/started', { threadId: 't1', turn: { id: turn, items: [], status: 'inProgress' } });
  if (/fail/.test(text)) return finish(turn, 'failed', { message: '401 Unauthorized: please sign in' });
  if (/slow/.test(text)) { current = turn; slowTimer = setTimeout(() => finish(turn, 'completed'), 20000); return; }
  if (/edit/.test(text)) {
    const changes = [{ path: 'src/a.ts', kind: { type: 'update' }, diff: '@@ -1,1 +1,1 @@\n-const a = 1;\n+const a = 2;\n' }];
    item(turn, { type: 'fileChange', id: 'fc1', changes, status: 'inProgress' }, 'item/started');
    const id = ++n; pendingApproval = { id, turn, kind: 'file' };
    return out({ id, method: 'item/fileChange/requestApproval', params: { itemId: 'fc1', threadId: 't1', turnId: turn, startedAtMs: 2, reason: 'update a.ts' } });
  }
  if (/run/.test(text)) {
    item(turn, { type: 'commandExecution', id: 'c1', command: 'npm test', commandActions: [], cwd: '/w', status: 'inProgress' }, 'item/started');
    const id = ++n; pendingApproval = { id, turn, kind: 'cmd' };
    return out({ id, method: 'item/commandExecution/requestApproval', params: { itemId: 'c1', command: 'npm test', cwd: '/w', threadId: 't1', turnId: turn, startedAtMs: 2 } });
  }
  talk(turn);
}
function talk(turn) {
  item(turn, { type: 'reasoning', id: 'r1', summary: [], content: [] }, 'item/started');
  note('item/reasoning/summaryTextDelta', { itemId: 'r1', delta: 'thinking about it', summaryIndex: 0, threadId: 't1', turnId: turn });
  item(turn, { type: 'agentMessage', id: 'm1', text: '' }, 'item/started');
  for (const d of ['Hello ', 'from ', 'Codex.']) note('item/agentMessage/delta', { itemId: 'm1', delta: d, threadId: 't1', turnId: turn });
  item(turn, { type: 'agentMessage', id: 'm1', text: 'Hello from Codex.' }, 'item/completed');
  note('thread/tokenUsage/updated', { threadId: 't1', turnId: turn, tokenUsage: { last: { inputTokens: 100, outputTokens: 20, cachedInputTokens: 10, reasoningOutputTokens: 0, totalTokens: 120 }, total: { inputTokens: 100, outputTokens: 20, cachedInputTokens: 10, reasoningOutputTokens: 0, totalTokens: 120 }, modelContextWindow: 1200 } });
  note('account/rateLimits/updated', { rateLimits: { primary: { usedPercent: 12, windowDurationMins: 300, resetsAt: 1000 }, secondary: { usedPercent: 40, windowDurationMins: 10080, resetsAt: 2000 } } });
  finish(turn, 'completed');
}

rl.on('line', (line) => {
  const m = JSON.parse(line);
  if (m.method === 'initialize') return out({ id: m.id, result: { userAgent: 'fake', codexHome: '/h', platformFamily: 'unix', platformOs: 'linux' } });
  if (m.method === 'account/read') return out({ id: m.id, result: { account: signedIn ? { type: 'chatgpt', email: 'a@b.c', planType: 'plus' } : null, requiresOpenaiAuth: !signedIn } });
  if (m.method === 'thread/start' || m.method === 'thread/resume') return out({ id: m.id, result: { thread: { id: 't1' }, model: 'gpt-fake', modelProvider: 'openai', cwd: '/w', approvalPolicy: m.params.approvalPolicy, sandbox: m.params.sandbox } });
  if (m.method === 'model/list') return out({ id: m.id, result: { data: [{ id: 'gpt-fake', model: 'gpt-fake', displayName: 'GPT Fake', description: 'for tests', hidden: false }, { id: 'old', model: 'old', displayName: 'Old', description: '', hidden: true }] } });
  if (m.method === 'turn/start') { const turn = 'u' + ++turnId; globalThis.lastTurnParams = m.params; out({ id: m.id, result: { turn: { id: turn, items: [], status: 'inProgress' } } }); const text = m.params.input[0].text; process.stderr.write('POLICY ' + JSON.stringify({ a: m.params.approvalPolicy, s: m.params.sandboxPolicy }) + '\n'); return setTimeout(() => runTurn(turn, text), 5); }
  if (m.method === 'turn/interrupt' && process.env.FAKE_CODEX_IGNORE_INTERRUPT === '1') return; // a hung app-server: never answers, never stops
  if (m.method === 'turn/interrupt') { out({ id: m.id, result: {} }); clearTimeout(slowTimer); if (current) finish(current, 'interrupted'); return; }
  if (m.id !== undefined && m.method === undefined && pendingApproval && m.id === pendingApproval.id) {
    const { turn, kind } = pendingApproval; pendingApproval = undefined; const d = m.result.decision;
    const ok = d === 'accept' || d === 'acceptForSession';
    if (kind === 'file') item(turn, { type: 'fileChange', id: 'fc1', changes: [{ path: 'src/a.ts', kind: { type: 'update' }, diff: '@@ -1,1 +1,1 @@\n-const a = 1;\n+const a = 2;\n' }], status: ok ? 'completed' : 'declined' }, 'item/completed');
    else item(turn, { type: 'commandExecution', id: 'c1', command: 'npm test', commandActions: [], cwd: '/w', status: ok ? 'completed' : 'declined', exitCode: ok ? 0 : null, aggregatedOutput: ok ? 'ok\n3 passed' : '' }, 'item/completed');
    return talk(turn);
  }
  if (m.id !== undefined && m.method) out({ id: m.id, error: { code: -32601, message: 'unknown ' + m.method } });
});
