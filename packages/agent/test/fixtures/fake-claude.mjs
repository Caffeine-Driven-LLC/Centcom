#!/usr/bin/env node
// A stand-in for the `claude` executable (lane C102/C030): the same stream-json shapes as the recording in claude-ok.jsonl, with a turn that streams slowly so a test can stop it.
//   FAKE_CLAUDE_VERSION       what `--version` prints (default "2.1.289 (Claude Code)")
//   FAKE_CLAUDE_RECEIPT=0     leave `interrupt_receipt_v1` out of the init capabilities
//   FAKE_CLAUDE_IGNORE_CONTROL=1   advertise it but never answer an interrupt request
//   FAKE_CLAUDE_ARGV_FILE     write the argument list there as JSON
//   FAKE_CLAUDE_MODE_FILE     write "<permission mode>" there
import { createInterface } from 'node:readline';
import { writeFileSync } from 'node:fs';

const a = process.argv.slice(2);
if (a.includes('--version')) { console.log(process.env.FAKE_CLAUDE_VERSION ?? '2.1.289 (Claude Code)'); process.exit(0); }
if (process.env.FAKE_CLAUDE_ARGV_FILE) writeFileSync(process.env.FAKE_CLAUDE_ARGV_FILE, JSON.stringify(a));
const out = (o) => process.stdout.write(JSON.stringify(o) + '\n');
const sid = 'fake-session-1';
out({ type: 'system', subtype: 'init', session_id: sid, model: 'fake', apiKeySource: 'none', claude_code_version: '2.1.289', capabilities: process.env.FAKE_CLAUDE_RECEIPT === '0' ? [] : ['interrupt_receipt_v1'], tools: [], mcp_servers: [] });
let timer; let n = 0;
const stream = (event) => out({ type: 'stream_event', event, session_id: sid, parent_tool_use_id: null, uuid: '0' });
const finish = (subtype, isError) => out({ type: 'result', subtype, is_error: isError, session_id: sid, result: '', stop_reason: isError ? null : 'end_turn', total_cost_usd: 0, usage: { input_tokens: 1, output_tokens: 1 } });
process.on('SIGINT', () => process.exit(130));
createInterface({ input: process.stdin }).on('line', (line) => {
  let j; try { j = JSON.parse(line); } catch { return; }
  if (j.type === 'user') {
    stream({ type: 'message_start', message: { id: 'msg_fake', type: 'message', role: 'assistant', content: [], model: 'fake', usage: { input_tokens: 1, output_tokens: 0 } } });
    stream({ type: 'content_block_start', index: 0, content_block: { type: 'text', text: '' } });
    timer = setInterval(() => { n++; stream({ type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: `${n} ` } }); if (n >= 200) { clearInterval(timer); stream({ type: 'content_block_stop', index: 0 }); stream({ type: 'message_stop' }); finish('success', false); } }, 25);
  } else if (j.type === 'control_request' && j.request?.subtype === 'interrupt') {
    if (process.env.FAKE_CLAUDE_IGNORE_CONTROL === '1') return;
    clearInterval(timer);
    out({ type: 'control_response', response: { subtype: 'success', request_id: j.request_id, response: { still_queued: [] } } });
    out({ type: 'user', message: { role: 'user', content: [{ type: 'text', text: '[Request interrupted by user]' }] }, parent_tool_use_id: null, session_id: sid });
    finish('error_during_execution', true);
  }
}).on('close', () => process.exit(0));
