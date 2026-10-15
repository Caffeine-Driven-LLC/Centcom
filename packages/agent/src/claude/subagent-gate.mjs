#!/usr/bin/env node
// A Claude Code PreToolUse hook for the sub-agent tool. It asks Centcom (over the same private local socket as the approval helper)
// whether one more sub-agent may start in this run, and answers "deny" with the reason when the limit is reached. Plain Node, no dependencies.
// It prints nothing when the answer is yes, so Claude Code's own permission rules still decide. If Centcom cannot be reached it also prints
// nothing: this is a cost limit, not a security check, and a broken channel must not stop the work.
import { createConnection } from 'node:net';
import { readFileSync } from 'node:fs';

const conf = (() => { try { return JSON.parse(readFileSync(process.argv[2] ?? '', 'utf8')); } catch { return undefined; } })();
const finish = (v) => {
  if (v && v.behavior === 'deny') process.stdout.write(JSON.stringify({ hookSpecificOutput: { hookEventName: 'PreToolUse', permissionDecision: 'deny', permissionDecisionReason: String(v.message || 'The sub-agent limit for this run is reached.').slice(0, 500) } }) + '\n');
  process.exit(0);
};
if (!conf?.sock) finish(undefined);
let done = false; const once = (v) => { if (!done) { done = true; finish(v); } };
setTimeout(() => once(undefined), 5000).unref();
let buf = '';
const s = createConnection(conf.sock);
s.setEncoding('utf8');
s.on('connect', () => s.write(JSON.stringify({ kind: 'subagent', tool_name: 'Agent', input: {}, tool_use_id: '', token: conf.token ?? '' }) + '\n'));
s.on('data', (c) => { buf += c; const i = buf.indexOf('\n'); if (i >= 0) { try { once(JSON.parse(buf.slice(0, i))); } catch { once(undefined); } } });
s.on('error', () => once(undefined));
s.on('close', () => once(undefined));
