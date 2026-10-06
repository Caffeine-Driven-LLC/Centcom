import { spawn } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { ApprovalBridge, describeTool, type ApprovalDecision, type ApprovalRequest, type EventBody } from '../src/index.js';

/** Speak MCP to the real mcp-permission.mjs exactly as claude would. */
async function callApprove(cfgPath: string, args: object): Promise<{ text: string }> {
  const cfg = JSON.parse(readFileSync(cfgPath, 'utf8')).mcpServers.centcom;
  const p = spawn(cfg.command, cfg.args, { env: { ...process.env, ...cfg.env }, stdio: ['pipe', 'pipe', 'inherit'] });
  const lines: string[] = []; let buf = '';
  const waiters: ((m: any) => void)[] = [];
  p.stdout!.setEncoding('utf8'); p.stdout!.on('data', (c: string) => { buf += c; let i; while ((i = buf.indexOf('\n')) >= 0) { const l = buf.slice(0, i); buf = buf.slice(i + 1); lines.push(l); waiters.shift()?.(JSON.parse(l)); } });
  const rpc = (msg: object) => new Promise<any>((res) => { waiters.push(res); p.stdin!.write(JSON.stringify(msg) + '\n'); });
  const init = await rpc({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-03-26', capabilities: {}, clientInfo: { name: 't', version: '0' } } });
  expect(init.result.serverInfo.name).toBe('centcom');
  p.stdin!.write(JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' }) + '\n');
  const list = await rpc({ jsonrpc: '2.0', id: 2, method: 'tools/list' });
  expect(list.result.tools[0].name).toBe('approve');
  const call = await rpc({ jsonrpc: '2.0', id: 3, method: 'tools/call', params: { name: 'approve', arguments: args } });
  p.kill(); return { text: call.result.content[0].text };
}

const make = (decide: (r: ApprovalRequest) => Promise<ApprovalDecision>) => {
  const events: EventBody[] = [];
  const bridge = new ApprovalBridge({ agentId: 'a1', cwd: '/w', gate: { decide }, emit: (b) => events.push(b) });
  return { bridge, events };
};

describe('approval bridge', () => {
  it('describes tools for the approval card', () => {
    expect(describeTool('Bash', { command: 'rm -rf dist\nls' })).toMatchObject({ summary: 'rm -rf dist', command: 'rm -rf dist\nls' });
    const e = describeTool('Edit', { file_path: 'src/a.ts', old_string: 'a', new_string: 'b' });
    expect(e.path).toBe('src/a.ts'); expect(e.diff).toContain('-a'); expect(e.diff).toContain('+b');
    expect(describeTool('Write', { file_path: 'n.txt', content: 'hi' }).diff).toContain('+hi');
    expect(describeTool('WebFetch', { url: 'https://x.dev' }).summary).toBe('https://x.dev');
  });

  it('relays an approval through the real MCP script and answers allow', async () => {
    const seen: ApprovalRequest[] = [];
    const { bridge, events } = make(async (r) => { seen.push(r); return { decision: 'approve', scope: 'once' }; });
    await bridge.start();
    const { text } = await callApprove(bridge.mcpConfigPath!, { tool_name: 'Bash', input: { command: 'npm test' }, tool_use_id: 'toolu_1' });
    bridge.close();
    expect(JSON.parse(text)).toEqual({ behavior: 'allow', updatedInput: { command: 'npm test' } });
    expect(seen[0]).toMatchObject({ tool: 'Bash', tool_id: 'toolu_1', command: 'npm test', agent_id: 'a1' });
    expect(events.map((e) => e.type)).toEqual(['approval.requested', 'status', 'approval.resolved']);
  });

  it('answers deny with a message, and denies when the gate throws', async () => {
    const a = make(async () => ({ decision: 'deny', scope: 'once' })); await a.bridge.start();
    expect(JSON.parse((await callApprove(a.bridge.mcpConfigPath!, { tool_name: 'Edit', input: { file_path: 'x', old_string: 'a', new_string: 'b' }, tool_use_id: 't' })).text)).toEqual({ behavior: 'deny', message: 'The user declined this action.' });
    a.bridge.close();
    const b = make(async () => { throw new Error('boom'); }); await b.bridge.start();
    expect(JSON.parse((await callApprove(b.bridge.mcpConfigPath!, { tool_name: 'Bash', input: { command: 'x' }, tool_use_id: 't' })).text).behavior).toBe('deny');
    b.bridge.close();
  });

  it('denies (never allows) when Centcom is unreachable', async () => {
    const { bridge } = make(async () => ({ decision: 'approve', scope: 'once' })); await bridge.start();
    const path = bridge.mcpConfigPath!; const cfg = JSON.parse(readFileSync(path, 'utf8'));
    bridge.close(); // the socket no longer exists when the script tries to connect
    const tmp = join(tmpdir(), `centcom-gone-${Date.now()}.json`); // config pointing at the dead socket
    writeFileSync(tmp, JSON.stringify(cfg));
    expect(JSON.parse((await callApprove(tmp, { tool_name: 'Bash', input: { command: 'x' }, tool_use_id: 't' })).text).behavior).toBe('deny');
  });
});
