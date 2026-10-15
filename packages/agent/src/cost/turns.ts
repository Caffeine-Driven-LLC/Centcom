/**
 * Measures what Centcom itself adds to a `claude` turn, without a real model call: it drives the real Claude engine against a stand-in
 * process, records the argument list of every turn, and sizes the text Centcom puts in front of the model. Owns the measurement only;
 * it must not start a real `claude`.
 */
import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import type { ChildProcess, spawn as nodeSpawn } from 'node:child_process';
import { ClaudeCodeEngine } from '../claude/engine.js';
import { estimateTokens } from '../board/text.js';
import type { EngineStartOptions, NormalisedEvent } from '../types.js';

/** The `claude` flags whose value reaches the cached prefix of the prompt (tools, system prompt, model). A change in one of them between two turns of a session makes the provider rewrite the cache. */
export const PREFIX_FLAGS = ['--append-system-prompt', '--system-prompt', '--model', '--effort', '--allowedTools', '--disallowedTools', '--mcp-config', '--settings', '--add-dir', '--permission-prompt-tool', '--agents'] as const;
/** Flags that legitimately differ between turns and do not touch the prefix. */
const TURN_FLAGS = new Set(['--resume']);

/** The values of every occurrence of `flag` in an argument list (variadic flags give several). */
export function flagValues(argv: string[], flag: string): string[] {
  const out: string[] = []; for (let i = 0; i < argv.length; i++) if (argv[i] === flag) { let j = i + 1; while (j < argv.length && !argv[j]!.startsWith('--')) { out.push(argv[j]!); j++; if (flag !== '--allowedTools' && flag !== '--disallowedTools') break; } }
  return out;
}

/** A stand-in `claude` child process: answers each prompt with one short message and ends. `tokens` shapes the usage it reports. */
function fakeChild(sessionId: string, tokens: { input: number; cacheWrite: number; cacheRead: number; output: number }): ChildProcess {
  const c = new EventEmitter() as ChildProcess & EventEmitter; const out = new PassThrough();
  Object.assign(c, { stdin: new PassThrough(), stdout: out, stderr: new PassThrough(), pid: undefined, kill: () => true });
  const line = (o: object) => out.write(JSON.stringify(o) + '\n');
  const usage = { input_tokens: tokens.input, cache_creation_input_tokens: tokens.cacheWrite, cache_read_input_tokens: tokens.cacheRead, output_tokens: tokens.output };
  setImmediate(() => {
    line({ type: 'system', subtype: 'init', session_id: sessionId, model: 'claude-sonnet-5-5', apiKeySource: 'none', claude_code_version: '2.1.289', capabilities: [], tools: [], mcp_servers: [] });
    const stream = (event: object) => line({ type: 'stream_event', event, session_id: sessionId, parent_tool_use_id: null, uuid: '0' });
    stream({ type: 'message_start', message: { id: 'msg_1', type: 'message', role: 'assistant', content: [], model: 'claude-sonnet-5-5', usage } });
    stream({ type: 'content_block_start', index: 0, content_block: { type: 'text', text: '' } });
    stream({ type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: 'ok' } });
    stream({ type: 'content_block_stop', index: 0 }); stream({ type: 'message_delta', delta: { stop_reason: 'end_turn' }, usage }); stream({ type: 'message_stop' });
    line({ type: 'result', subtype: 'success', is_error: false, session_id: sessionId, result: 'ok', stop_reason: 'end_turn', total_cost_usd: 0, usage, modelUsage: {} });
    setImmediate(() => { out.end(); c.emit('close', 0, null); });
  });
  return c;
}

export interface CapturedTurns { argv: string[][]; prompts: string[]; /** What each turn sent to claude on standard input (the user message, as text). */ sent: string[]; events: NormalisedEvent[] }
/** Runs the real Claude engine for `prompts.length` turns of one session against the stand-in and returns what it launched `claude` with each time. */
export async function captureTurns(prompts: string[], start: Partial<EngineStartOptions> = {}, hooks: { beforeSend?: (turn: number) => void } = {}): Promise<CapturedTurns> {
  const argv: string[][] = []; const sent: string[] = []; const events: NormalisedEvent[] = [];
  const spawn = ((_bin: string, args: readonly string[]) => { argv.push([...args]); const c = fakeChild('sess-1', { input: 3, cacheWrite: 500, cacheRead: 30000, output: 20 }); let text = ''; sent.push(''); const at = sent.length - 1; c.stdin?.on('data', (b: Buffer) => { text += String(b); sent[at] = text; }); return c; }) as unknown as typeof nodeSpawn;
  const engine = new ClaudeCodeEngine({ spawn, bin: 'claude' });
  const s = await engine.start({ agentId: 'agt_cost', cwd: process.cwd(), ...start });
  for (let i = 0; i < prompts.length; i++) {
    hooks.beforeSend?.(i); await s.send(prompts[i]!);
    for await (const ev of s.events) { events.push(ev); if (ev.type === 'turn.done') break; }
  }
  await s.stop();
  return { argv, prompts, sent, events };
}

export interface PrefixChange { flag: string; turn: number; before: string[]; after: string[] }
/** Between consecutive turns of one session: the prefix-relevant flags whose values changed. An empty list means the cached prefix is byte-stable across the session. */
export function prefixChanges(argvs: string[][]): PrefixChange[] {
  const out: PrefixChange[] = [];
  for (let t = 1; t < argvs.length; t++) for (const f of PREFIX_FLAGS) { if (TURN_FLAGS.has(f)) continue; const a = flagValues(argvs[t - 1]!, f); const b = flagValues(argvs[t]!, f); if (a.join('\u0000') !== b.join('\u0000')) out.push({ flag: f, turn: t, before: a, after: b }); }
  return out;
}

export interface AddOn { name: string; where: 'system prompt' | 'message' | 'tool list'; chars: number; tokens: number; when: string }
/** Sizes a piece of text Centcom adds. */
export const sizeOf = (name: string, where: AddOn['where'], text: string, when: string): AddOn => ({ name, where, chars: text.length, tokens: estimateTokens(text), when });
