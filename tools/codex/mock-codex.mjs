#!/usr/bin/env node
/**
 * A mock `codex`: speaks the app-server protocol of codex-cli 0.161.0 the way the recorded real traffic does
 * (packages/agent/test/fixtures/providers/codex), so Centcom can be run and tested end to end without Codex.
 * It really runs commands and edits files, in their own process group with CODEX_THREAD_ID in their environment, and like the real
 * thing it does NOT stop a running command on turn/interrupt.
 *
 * Prompts it understands (anything else gets a plain answer):
 *   run: <shell command>            runs it (asks first unless the policy is "never")
 *   edit <file> from <a> to <b>     replaces text in a file (asks first)
 *   create <file> with <text>       writes a new file (asks first)
 *   sleep <seconds>                 a long command, to try Stop
 *   think <text>                    reasoning, then an answer
 *   ask <question> | <a> | <b>      asks the person (item/tool/requestUserInput); with no options it wants free text
 *   fail usage | fail auth | fail   the turn fails with the matching error
 * Environment: MOCK_CODEX_SIGNED_IN=0 (signed out), MOCK_CODEX_DELAY_MS (pause between deltas, default 8), MOCK_CODEX_HOME (thread store).
 */
import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, isAbsolute, join, resolve } from 'node:path';
import { createInterface } from 'node:readline';

const VERSION = '0.161.0'; const args = process.argv.slice(2); const signedIn = process.env.MOCK_CODEX_SIGNED_IN !== '0';
if (args[0] === '--version' || args[0] === '-V') { console.log(`codex-cli ${VERSION}`); process.exit(0); }
if (args[0] === 'login' && args[1] === 'status') { if (signedIn) { console.log('Logged in using ChatGPT'); process.exit(0); } console.error('Not logged in'); process.exit(1); }
if (args[0] !== 'app-server') { console.error('mock codex: only --version, login status and app-server exist'); process.exit(2); }

const STORE = join(process.env.MOCK_CODEX_HOME ?? join(tmpdir(), 'mock-codex'), 'threads.json');
const load = () => { try { return JSON.parse(readFileSync(STORE, 'utf8')); } catch { return {}; } };
const save = (t) => { mkdirSync(dirname(STORE), { recursive: true }); writeFileSync(STORE, JSON.stringify(t)); };
const send = (o) => process.stdout.write(JSON.stringify(o) + '\n');
const note = (method, params) => send({ method, params, emittedAtMs: Date.now() });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const DELAY = Number(process.env.MOCK_CODEX_DELAY_MS ?? 8);
const MODELS = [{ id: 'mock-sol', model: 'mock-sol', displayName: 'Mock-Sol', description: 'The mock workhorse model.', hidden: false, isDefault: true, supportedReasoningEfforts: ['low', 'medium', 'high'].map((reasoningEffort) => ({ reasoningEffort, description: reasoningEffort })), defaultReasoningEffort: 'low' }, { id: 'mock-luna', model: 'mock-luna', displayName: 'Mock-Luna', description: 'A smaller mock model.', hidden: false, isDefault: false, supportedReasoningEfforts: [{ reasoningEffort: 'low' }], defaultReasoningEffort: 'low' }];

let nextServerId = 0; const waiting = new Map(); const threads = load(); const live = new Map(); // threadId -> { cwd, approvalPolicy, turn }
const ask = (method, params) => new Promise((res) => { const id = nextServerId++; waiting.set(id, res); send({ method, id, params }); });

async function agentText(threadId, turnId, text) {
  const id = 'msg_' + randomUUID().replace(/-/g, ''); const item = { type: 'agentMessage', id, text: '', phase: 'final_answer', memoryCitation: null, delivery: null, questions: null };
  note('item/started', { item, threadId, turnId });
  for (const w of text.match(/\S+\s*/g) ?? []) { note('item/agentMessage/delta', { threadId, turnId, itemId: id, delta: w }); await sleep(DELAY); }
  note('item/completed', { item: { ...item, text }, threadId, turnId });
}
const usage = (threadId, turnId, out) => { note('thread/tokenUsage/updated', { threadId, turnId, tokenUsage: { total: { totalTokens: 9000 + out, inputTokens: 9000, outputTokens: out }, last: { totalTokens: 900 + out, inputTokens: 900, cachedInputTokens: 0, outputTokens: out, reasoningOutputTokens: 0 }, modelContextWindow: 258400 } }); note('account/rateLimits/updated', { rateLimits: { limitId: 'codex', primary: { usedPercent: 8, windowDurationMins: 300, resetsAt: Math.floor(Date.now() / 1000) + 9000 }, secondary: { usedPercent: 1, windowDurationMins: 10080, resetsAt: Math.floor(Date.now() / 1000) + 400000 }, planType: 'plus' } }); };
const decision = (r) => (r && typeof r.decision === 'string' ? r.decision : 'decline');
const needsAsk = (t) => t.approvalPolicy !== 'never';

async function runCommand(t, threadId, turnId, command) {
  const id = 'exec-' + randomUUID(); const item = { type: 'commandExecution', id, command: `/bin/sh -lc ${JSON.stringify(command)}`, cwd: t.cwd, processId: null, source: 'agent', status: 'inProgress', commandActions: [{ type: 'unknown', command }], aggregatedOutput: null, exitCode: null, durationMs: null };
  note('item/started', { item, threadId, turnId });
  if (needsAsk(t)) { const d = decision(await ask('item/commandExecution/requestApproval', { kind: 'command', threadId, turnId, itemId: id, startedAtMs: Date.now(), environmentId: 'local', command: item.command, cwd: t.cwd, commandActions: item.commandActions })); note('serverRequest/resolved', { threadId, requestId: nextServerId - 1 }); if (!d.startsWith('accept')) { note('item/completed', { item: { ...item, status: 'declined' }, threadId, turnId }); return 'declined'; } }
  const t0 = Date.now(); t.running = true;
  const out = await new Promise((res) => { // own process group, like the real thing; the tag is how Centcom finds it
    const c = spawn('/bin/sh', ['-c', command], { cwd: t.cwd, detached: true, env: { ...process.env, CODEX_THREAD_ID: threadId }, stdio: ['ignore', 'pipe', 'pipe'] }); let buf = '';
    c.stdout.on('data', (d) => { buf += d; note('item/commandExecution/outputDelta', { threadId, turnId, itemId: id, delta: Buffer.from(d).toString('base64') }); }); c.stderr.on('data', (d) => { buf += d; });
    c.on('close', (code, sig) => res({ buf, code: code ?? (sig ? 143 : 1) })); c.on('error', () => res({ buf, code: 127 }));
  });
  t.running = false; note('item/completed', { item: { ...item, status: out.code === 0 ? 'completed' : 'failed', processId: String(Date.now()), aggregatedOutput: out.buf.slice(0, 200000), exitCode: out.code, durationMs: Date.now() - t0 }, threadId, turnId });
  return out;
}
async function fileChange(t, threadId, turnId, rel, make) {
  const path = isAbsolute(rel) ? rel : resolve(t.cwd, rel); const id = 'exec-' + randomUUID(); const before = existsSync(path) ? readFileSync(path, 'utf8') : null; const after = make(before);
  const diff = before === null ? after : `--- a/${rel}\n+++ b/${rel}\n@@ -1 +1 @@\n-${(before ?? '').trimEnd()}\n+${after.trimEnd()}\n`; const changes = [{ path, kind: before === null ? { type: 'add' } : { type: 'update', move_path: null }, diff }]; const item = { type: 'fileChange', id, changes, status: 'inProgress' };
  note('item/started', { item, threadId, turnId });
  if (t.sandbox === 'read-only') { note('item/completed', { item: { ...item, status: 'failed' }, threadId, turnId }); return 'failed'; }
  if (needsAsk(t)) { const d = decision(await ask('item/fileChange/requestApproval', { threadId, turnId, itemId: id, startedAtMs: Date.now(), reason: null, grantRoot: null })); note('serverRequest/resolved', { threadId, requestId: nextServerId - 1 }); if (!d.startsWith('accept')) { note('item/completed', { item: { ...item, status: 'declined' }, threadId, turnId }); return 'declined'; } }
  mkdirSync(dirname(path), { recursive: true }); writeFileSync(path, after); note('turn/diff/updated', { threadId, turnId, diff }); note('item/completed', { item: { ...item, status: 'completed' }, threadId, turnId }); return 'ok';
}

async function turn(threadId, turnId, prompt, t) {
  prompt = /\nTask:\n([\s\S]*)$/.exec(prompt)?.[1] ?? prompt; // a night-cycle prompt carries its task after the rules
  const live_ = () => t.turn?.id === turnId; const say = (text) => (live_() ? agentText(threadId, turnId, text) : undefined); // an interrupted turn says no more
  let m; let ended = 'completed'; let error = null;
  if ((m = /^\s*run:\s*([\s\S]+)$/i.exec(prompt))) { await say( 'Running that now.'); const r = await runCommand(t, threadId, turnId, m[1].trim()); await say( r === 'declined' ? 'Understood, I did not run it.' : `The command finished with exit code ${r.code}.`); }
  else if ((m = /^\s*sleep\s+(\d+)/i.exec(prompt))) { await say( `Sleeping for ${m[1]} seconds.`); const r = await runCommand(t, threadId, turnId, `sleep ${m[1]} && echo done`); await say( r === 'declined' ? 'Skipped.' : 'Done sleeping.'); }
  else if ((m = /^\s*edit\s+(\S+)\s+from\s+(\S+)\s+to\s+(\S+)/i.exec(prompt))) { const r = await fileChange(t, threadId, turnId, m[1], (b) => (b ?? '').split(m[2]).join(m[3])); await say( r === 'ok' ? `Changed ${m[2]} to ${m[3]} in ${m[1]}.` : `I could not change ${m[1]} (${r}).`); }
  else if ((m = /^\s*create\s+(\S+)\s+with\s+([\s\S]+)$/i.exec(prompt))) { const r = await fileChange(t, threadId, turnId, m[1], () => m[2].trim() + '\n'); await say( r === 'ok' ? `Created ${m[1]}.` : `I could not create ${m[1]} (${r}).`); }
  else if ((m = /^\s*ask\s+([\s\S]+)$/i.exec(prompt))) {
    const [q, ...opts] = m[1].split('|').map((x) => x.trim()); const itemId = 'ui_' + randomUUID();
    const r = await ask('item/tool/requestUserInput', { threadId, turnId, itemId, questions: [{ id: 'q1', header: 'Question', question: q, isOther: false, isSecret: false, options: opts.length ? opts.map((label) => ({ label, description: '' })) : null }] });
    const picked = r?.answers?.q1?.answers ?? []; await say(picked.length ? `You chose: ${picked.join(', ')}.` : 'No answer given.');
  }
  else if ((m = /^\s*think\s+([\s\S]+)$/i.exec(prompt))) { const id = 'rs_' + randomUUID(); note('item/started', { item: { type: 'reasoning', id, summary: [], content: [] }, threadId, turnId }); note('item/reasoning/summaryTextDelta', { threadId, turnId, itemId: id, delta: `Considering: ${m[1]}` }); note('item/completed', { item: { type: 'reasoning', id, summary: [`Considering: ${m[1]}`], content: [] }, threadId, turnId }); await say( `After thinking: ${m[1]}`); }
  else if ((m = /^\s*fail(?:\s+(usage|auth))?/i.exec(prompt))) { ended = 'failed'; const info = m[1] === 'usage' ? 'usageLimitExceeded' : m[1] === 'auth' ? { httpConnectionFailed: { httpStatusCode: 401 } } : 'other'; const message = m[1] === 'usage' ? 'You have reached your usage limit.' : m[1] === 'auth' ? 'unexpected status 401 Unauthorized: Missing bearer or basic authentication' : 'The mock turn failed.'; error = { message, codexErrorInfo: info, additionalDetails: null }; note('error', { error, willRetry: false, threadId, turnId }); }
  else await say( `Hello from mock Codex. You said: ${prompt.slice(0, 200)}`);
  if (live_()) usage(threadId, turnId, 40); return { ended, error };
}

async function handle(m) {
  const { id, method, params: p = {} } = m; const ok = (result = {}) => send({ id, result }); const bad = (code, message) => send({ id, error: { code, message } });
  switch (method) {
    case 'initialize': return ok({ userAgent: `${p.clientInfo?.name ?? 'client'}/${VERSION} (Mock OS; x64) mock (${p.clientInfo?.name}; ${p.clientInfo?.version})`, codexHome: '$HOME/.codex', platformFamily: 'unix', platformOs: process.platform });
    case 'account/read': ok({ account: signedIn ? { type: 'chatgpt', email: 'user@example.test', planType: 'plus' } : null, requiresOpenaiAuth: true }); if (signedIn) note('account/updated', { authMode: 'chatgpt', planType: 'plus' }); return;
    case 'model/list': return ok({ data: MODELS, nextCursor: null });
    case 'thread/start': case 'thread/resume': {
      const resume = method === 'thread/resume'; const threadId = resume ? String(p.threadId) : randomUUID(); if (resume && !threads[threadId]) return bad(-32600, `no rollout found for thread id ${threadId}`);
      const t = { cwd: p.cwd ?? threads[threadId]?.cwd ?? process.cwd(), approvalPolicy: p.approvalPolicy ?? 'untrusted', sandbox: p.sandbox ?? 'workspace-write', history: threads[threadId]?.history ?? [] }; live.set(threadId, t); threads[threadId] = { cwd: t.cwd, history: t.history }; save(threads);
      ok({ thread: { id: threadId, cwd: t.cwd, modelProvider: 'openai', model: p.model ?? 'mock-sol' }, model: p.model ?? 'mock-sol', modelProvider: 'openai', cwd: t.cwd, approvalPolicy: t.approvalPolicy, sandbox: { type: 'workspaceWrite' }, reasoningEffort: null });
      note('thread/started', { thread: { id: threadId, cwd: t.cwd } }); for (const name of ['codex_apps']) note('mcpServer/startupStatus/updated', { threadId, name, status: 'ready', error: null, failureReason: null }); return;
    }
    case 'turn/start': {
      const threadId = String(p.threadId); const t = live.get(threadId); if (!t) return bad(-32600, 'thread not found'); if (t.turn) return bad(-32600, 'a turn is already running');
      if (p.approvalPolicy) t.approvalPolicy = p.approvalPolicy; if (p.sandboxPolicy?.type) t.sandbox = { readOnly: 'read-only', workspaceWrite: 'workspace-write', dangerFullAccess: 'danger-full-access' }[p.sandboxPolicy.type] ?? t.sandbox;
      const turnId = randomUUID(); const prompt = (p.input ?? []).filter((i) => i.type === 'text').map((i) => i.text).join('\n'); t.turn = { id: turnId, interrupted: false };
      ok({ turn: { id: turnId, items: [], status: 'inProgress', error: null } }); note('thread/status/changed', { threadId, status: { type: 'active', activeFlags: [] } }); note('turn/started', { threadId, turn: { id: turnId, items: [], status: 'inProgress', error: null } });
      const um = { type: 'userMessage', id: randomUUID(), content: [{ type: 'text', text: prompt, text_elements: [] }] }; note('item/started', { item: um, threadId, turnId }); note('item/completed', { item: um, threadId, turnId });
      void turn(threadId, turnId, prompt, t).then(({ ended, error }) => { if (!t.turn || t.turn.id !== turnId) return; const status = t.turn.interrupted ? 'interrupted' : ended; t.turn = undefined; t.history.push({ prompt }); threads[threadId] = { cwd: t.cwd, history: t.history }; save(threads); note('turn/completed', { threadId, turn: { id: turnId, items: [], status, error: status === 'failed' ? error : null } }); });
      return;
    }
    case 'turn/interrupt': { const t = live.get(String(p.threadId)); ok({}); if (t?.turn && t.turn.id === p.turnId) { const turnId = t.turn.id; t.turn.interrupted = true; t.turn = undefined; note('turn/completed', { threadId: p.threadId, turn: { id: turnId, items: [], status: 'interrupted', error: null } }); } return; } // the command it started keeps running, as on the real thing
    case 'thread/compact/start': { ok({}); const threadId = String(p.threadId); const turnId = randomUUID(); const id = randomUUID(); note('item/started', { item: { type: 'contextCompaction', id }, threadId, turnId }); note('item/completed', { item: { type: 'contextCompaction', id }, threadId, turnId }); return; }
    case 'initialized': return;
    default: if (id !== undefined) bad(-32601, `Invalid request: unknown variant \`${method}\``);
  }
}
const rl = createInterface({ input: process.stdin });
rl.on('line', (line) => { let m; try { m = JSON.parse(line); } catch { return; } if (m.id !== undefined && m.method === undefined) { const w = waiting.get(m.id); if (w) { waiting.delete(m.id); w(m.result ?? {}); } return; } void handle(m).catch((e) => { if (m.id !== undefined) send({ id: m.id, error: { code: -32603, message: String(e?.message ?? e) } }); }); });
rl.on('close', () => setTimeout(() => process.exit(0), 50));
