#!/usr/bin/env node
// A tiny stdio MCP server with one tool, `approve`. Claude Code calls it (via --permission-prompt-tool) whenever it
// needs a permission decision; we forward the question over a private local socket to Centcom and relay the answer.
// Plain Node, no dependencies, so it starts fast and can be spawned by the claude CLI from anywhere.
import { createConnection } from 'node:net';
import { createInterface } from 'node:readline';

const SOCK = process.env.CENTCOM_APPROVAL_SOCK;
const TOKEN = process.env.CENTCOM_APPROVAL_TOKEN ?? '';
const TOOL = {
  name: 'approve',
  description: 'Ask the Centcom user whether Claude may use a tool. Returns the permission decision.',
  inputSchema: { type: 'object', properties: { tool_name: { type: 'string' }, input: { type: 'object' }, tool_use_id: { type: 'string' } }, required: ['tool_name', 'input'] },
};

const send = (msg) => process.stdout.write(JSON.stringify(msg) + '\n');
const reply = (id, result) => send({ jsonrpc: '2.0', id, result });
const fail = (id, code, message) => send({ jsonrpc: '2.0', id, error: { code, message } });
const verdict = (v) => ({ content: [{ type: 'text', text: JSON.stringify(v) }] });

/** Ask Centcom; if it cannot be reached we deny, never allow. */
function ask(payload) {
  return new Promise((resolve) => {
    if (!SOCK) { resolve({ behavior: 'deny', message: 'Centcom approval channel is not configured.' }); return; }
    let buf = ''; let done = false;
    const finish = (v) => { if (!done) { done = true; try { s.destroy(); } catch { /* already closed */ } resolve(v); } };
    const s = createConnection(SOCK);
    s.setEncoding('utf8');
    s.on('connect', () => s.write(JSON.stringify({ ...payload, token: TOKEN }) + '\n'));
    s.on('data', (c) => { buf += c; const i = buf.indexOf('\n'); if (i >= 0) { try { finish(JSON.parse(buf.slice(0, i))); } catch { finish({ behavior: 'deny', message: 'Bad answer from Centcom.' }); } } });
    s.on('error', () => finish({ behavior: 'deny', message: 'Could not reach Centcom to ask for permission.' }));
    s.on('close', () => finish({ behavior: 'deny', message: 'Centcom closed before answering.' }));
  });
}

const rl = createInterface({ input: process.stdin });
rl.on('line', async (line) => {
  let m; try { m = JSON.parse(line); } catch { return; }
  const { id, method, params } = m;
  if (method === 'initialize') return reply(id, { protocolVersion: params?.protocolVersion ?? '2024-11-05', capabilities: { tools: {} }, serverInfo: { name: 'centcom', version: '0.1.0' } });
  if (method === 'ping') return reply(id, {});
  if (method === 'tools/list') return reply(id, { tools: [TOOL] });
  if (method === 'tools/call') {
    if (params?.name !== 'approve') return fail(id, -32602, 'Unknown tool');
    const a = params.arguments ?? {};
    const v = await ask({ tool_name: String(a.tool_name ?? ''), input: a.input ?? {}, tool_use_id: String(a.tool_use_id ?? '') });
    // Claude Code expects exactly {behavior:'allow', updatedInput} or {behavior:'deny', message}
    return reply(id, verdict(v.behavior === 'allow' ? { behavior: 'allow', updatedInput: v.updatedInput ?? a.input ?? {} } : { behavior: 'deny', message: v.message || 'The user declined this action.' }));
  }
  if (id !== undefined && id !== null) fail(id, -32601, 'Method not found'); // notifications get no reply
});
rl.on('close', () => process.exit(0));
