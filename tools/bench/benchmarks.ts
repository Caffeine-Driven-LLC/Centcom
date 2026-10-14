/** The benchmarks. Each returns samples (milliseconds, or operations per second). They run in-process on fixtures; nothing touches the network. */
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { initCrypto, sodium, encryptPayload, decryptPayload, signFrame, verifyFrame, type FrameHeader } from '../../packages/net/src/index.js';
import { parseFrame } from '../../packages/protocol/src/index.js';
import { renderHalfBlock, getBaked } from '../../packages/mascot/src/index.js';
import { TranscriptLayout } from '../../packages/tui/src/transcript/index.js';
import { SessionStore } from '../../packages/tui/src/index.js';
import { keypressSamples } from '../../packages/tui/src/perf/keypress.js';
import { parseUnifiedDiff, renderDiffRows } from '../../packages/tui/src/diff/index.js';
import { GuestIngest, initialGuestState, reduceGuestState, type DecodedFrame } from '../../packages/session/src/guest/index.js';
import { mkdtempSync, rmSync } from 'node:fs';
import v8 from 'node:v8';
import vm from 'node:vm';
import { tmpdir } from 'node:os';


const ROOT = fileURLToPath(new URL('../../', import.meta.url));
export interface Bench { id: string; unit: 'ms' | 'ops/s' | 'MB'; fast: boolean; budget: number | null; /** false: measured and shown, not yet gating (waiting for something the budget assumes) */ gated: boolean; run(): Promise<number[]> | number[] }
/** `n` samples; each is the average of `inner` runs, so very fast operations are not drowned by timer noise. */
const time = (fn: () => void, n: number, warm = 3, inner = 1): number[] => { for (let i = 0; i < warm * inner; i++) fn(); const out: number[] = []; for (let i = 0; i < n; i++) { const t0 = performance.now(); for (let j = 0; j < inner; j++) fn(); out.push((performance.now() - t0) / inner); } return out; };
/** Set to a number like 1.25 to make the transcript benchmark that much slower (the self-test of the gate). */
const slow = (): number => Number(process.env.CENTCOM_BENCH_SLOWDOWN_TRANSCRIPT ?? 1);
const spin = (ms: number) => { const t = performance.now(); while (performance.now() - t < ms) { /* wait */ } };

/** A diff of `lines` changed lines spread over files with context, as `git diff` writes it. */
function bigDiff(lines: number): string {
  const out: string[] = []; let left = lines; let f = 0;
  while (left > 0) { out.push(`diff --git a/src/f${f}.ts b/src/f${f}.ts`, `--- a/src/f${f}.ts`, `+++ b/src/f${f}.ts`); for (let h = 0; h < 5 && left > 0; h++) { out.push(`@@ -${h * 60 + 1},30 +${h * 60 + 1},30 @@ function f${h}()`); for (let i = 0; i < 30 && left > 0; i++, left--) out.push(i % 3 === 0 ? `-const value${i} = compute(${i}, 'old');` : i % 3 === 1 ? `+const value${i} = compute(${i}, 'new', { retry: ${i} });` : ` const unchanged${i} = ${i};`); } f++; }
  return out.join('\n') + '\n';
}
/** Frames of a busy shared session: a user message, then the assistant's answer in deltas, a tool call and its result, an agent state. */
function sessionFrames(n: number): DecodedFrame[] {
  const out: DecodedFrame[] = []; const base = { v: 1, t: 'event', sid: 'ses_01JA3Z8K2M5N7P9Q0R1S2T3V4W', from: 'mem_01JA3Z8K2M5N7P9Q0R1S2T3V4W', ts: '2026-10-06T12:00:00.000Z' };
  for (let i = 1; out.length < n; i++) { const m = 'msg_' + i; const add = (k: string, p: Record<string, unknown> | undefined, secret: Record<string, unknown>) => { if (out.length < n) out.push({ ...base, id: 'msg_f' + out.length, k, seq: out.length + 1, ...(p ? { p } : {}), secret } as unknown as DecodedFrame); };
    add('message.user', undefined, { text: `question ${i}` }); for (let d = 0; d < 6; d++) add('message.assistant.delta', undefined, { message_id: m, index: d, text: `piece ${d} of the answer to ${i} ` }); add('message.assistant.done', undefined, { message_id: m });
    add('tool.request', undefined, { agent_id: 'agt_x', tool_id: 't' + i, name: 'Read', input_summary: 'src/a.ts', risk: 'low' }); add('tool.result', undefined, { agent_id: 'agt_x', tool_id: 't' + i, status: 'ok', summary: 'ok' }); add('agent.state', { agent_id: 'agt_x', state: i % 2 ? 'thinking' : 'streaming' }, {}); }
  return out;
}
function transcriptItems(n: number) { return Array.from({ length: n }, (_, i) => (i % 3 === 0 ? { kind: 'user' as const, id: `u${i}`, text: `question number ${i} about the retry logic`, ts: i } : { kind: 'assistant' as const, id: `a${i}`, messageId: `m${i}`, agentId: 'agt_x', text: `Here is an answer ${i}. `.repeat(8), done: true })); }
let keys: { key: Uint8Array; sk: Uint8Array; pk: Uint8Array } | undefined;
async function crypto() { await initCrypto(); const s = sodium(); const kp = s.crypto_sign_keypair(); keys ??= { key: s.randombytes_buf(32), sk: kp.privateKey, pk: kp.publicKey }; return keys; }
const header: FrameHeader = { v: 1, t: 'event', id: 'msg_01JA3Z8K2M5N7P9Q0R1S2T3V4W', sid: 'ses_01JA3Z8K2M5N7P9Q0R1S2T3V4W', from_dev: 'dev_01JA3Z8K2M5N7P9Q0R1S2T3V4W', k: 'message.user' };

export const BENCHES: Bench[] = [
  { id: 'cli.version.warm', unit: 'ms', fast: true, budget: 150, gated: false, run: () => { const run = () => { const t0 = performance.now(); execFileSync(process.execPath, ['--import', 'tsx', join('apps/cli/src/main.tsx'), '--version'], { cwd: ROOT, stdio: 'ignore' }); return performance.now() - t0; }; run(); return [run(), run(), run(), run(), run()]; } },
  { id: 'transcript.scroll.frame', unit: 'ms', fast: true, budget: 16, gated: true, run: () => {
    const items = transcriptItems(10_000); const l = new TranscriptLayout().update(items, 100); const at = Math.floor(l.total / 2);
    return time(() => { const t0 = performance.now(); l.update(items, 100); l.slice(at, at + 40); if (slow() > 1) spin((performance.now() - t0) * (slow() - 1)); }, 40, 5, 10); } },
  { id: 'transcript.layout.10k', unit: 'ms', fast: false, budget: 1500, gated: true, run: () => { const items = transcriptItems(10_000); return time(() => { new TranscriptLayout().update(items, 100); }, 5, 1); } },
  { id: 'mascot.redraw', unit: 'ms', fast: true, budget: 2, gated: true, run: () => { const rows = getBaked('idle_breathe')!.frames[0]!.rows; return time(() => { renderHalfBlock(rows, 'truecolor'); }, 40, 3, 20); } },
  { id: 'envelope.parse', unit: 'ms', fast: true, budget: 0.5, gated: true, run: () => { const f = { v: 1, t: 'event', id: header.id, sid: header.sid, k: 'message.user', seq: 7, ts: '2026-10-06T12:00:00.000Z', from: 'mem_01JA3Z8K2M5N7P9Q0R1S2T3V4W', ct: { alg: 'xchacha20poly1305', kid: 'k1', n: 'A'.repeat(32), c: 'B'.repeat(200) } }; return time(() => { parseFrame(f); }, 40, 3, 100); } },
  { id: 'crypto.encrypt_sign.4k', unit: 'ms', fast: true, budget: 1, gated: true, run: async () => { const k = await crypto(); const secret = { text: 'x'.repeat(4096) }; return time(() => { const ct = encryptPayload({ key: k.key, kid: 'k1', header, secret }); signFrame(k.sk, { header, ct }); }, 40, 3, 10); } },
  { id: 'crypto.encrypt_sign.192k', unit: 'ms', fast: true, budget: 8, gated: true, run: async () => { const k = await crypto(); const secret = { text: 'x'.repeat(130_000) }; return time(() => { const ct = encryptPayload({ key: k.key, kid: 'k1', header, secret }); signFrame(k.sk, { header, ct }); }, 30, 2, 2); } },
  { id: 'crypto.verify_decrypt.4k', unit: 'ms', fast: true, budget: 1, gated: true, run: async () => { const k = await crypto(); const ct = encryptPayload({ key: k.key, kid: 'k1', header, secret: { text: 'x'.repeat(4096) } }); const sig = signFrame(k.sk, { header, ct }); return time(() => { verifyFrame(k.pk, { header, ct }, sig); decryptPayload({ keyFor: () => k.key, header, ct }); }, 40, 3, 10); } },
  /** First paint of a 5,000-line diff: parse and lay out every row (budget 300 ms). */
  { id: 'diff.paint.5k', unit: 'ms', fast: false, budget: 300, gated: true, run: () => { const d = bigDiff(5000); return time(() => { renderDiffRows(parseUnifiedDiff(d), { width: 100, expanded: new Set() }); }, 8, 2); } },
  /** The guest reducer's throughput on a busy session (budget: at least 20,000 frames a second). */
  { id: 'guest.reducer.rate', unit: 'ops/s', fast: false, budget: 20000, gated: true, run: () => { const frames = sessionFrames(4000); const out: number[] = []; for (let r = 0; r < 6; r++) { let s = initialGuestState({ member: 'mem_x', role: 'editor' }); const t0 = performance.now(); for (const f of frames) s = reduceGuestState(s, f); out.push(frames.length / ((performance.now() - t0) / 1000)); } return out.slice(1); } },
  /** Resume: 5,000 buffered frames arriving in the worst order (newest first) are put in order and reduced to a state (budget 1.5 s). */
  { id: 'resume.replay.5k', unit: 'ms', fast: false, budget: 1500, gated: true, run: () => { const frames = sessionFrames(5000).reverse(); return time(() => { const ing = new GuestIngest<DecodedFrame>(0, 5000); let s = initialGuestState({ member: 'mem_x', role: 'editor' }); for (const f of frames) for (const g of ing.push(f)) s = reduceGuestState(s, g); if (s.lastSeq !== 5000) throw new Error('replay lost frames'); }, 4, 1); } },
  /** From the key reaching the app to the first byte of the new frame: a real Ink render of the whole app, 60 messages on screen, production React is not assumed (the harness runs under tsx). */
  { id: 'prompt.keypress.paint', unit: 'ms', fast: false, budget: 50, gated: false /* informational: it depends on the terminal size and on React's build; the launcher runs the production build, which is faster */, run: () => keypressSamples(30) },
  /** Saving a conversation of 1,000 messages (about 600 ms apart while the agent writes). */
  { id: 'session.save.1k', unit: 'ms', fast: true, budget: 25, gated: false, run: () => {
    const dir = mkdtempSync(join(tmpdir(), 'bench-sess-')); try { const st = new SessionStore(dir); const id = 'ses_01M4E2D01F1YX15N2QNNA56NK1'; const items = Array.from({ length: 1000 }, (_, i) => (i % 2 ? { id: 'a' + i, kind: 'assistant', messageId: 'm' + i, agentId: 'x', text: 'Lorem ipsum dolor sit amet '.repeat(80), done: true } : { id: 'u' + i, kind: 'user', text: 'question ' + i, ts: i })) as never[];
      for (let i = 0; i < 1000; i++) st.append(id, '/tmp', { v: 1, seq: i, ts: new Date().toISOString(), agent_id: 'agt', type: 'text.delta', message_id: 'm' + i, index: 0, text: 'Lorem ipsum dolor sit amet '.repeat(80) } as never);
      const meta = { id, cwd: '/tmp', engine: 'claude-code', title: 't', createdAt: 1, updatedAt: 2, messages: 1000 }; return time(() => { st.save(meta, items); }, 20, 3); } finally { rmSync(dir, { recursive: true, force: true }); } } },
  /** `centcom --version` through the bundled launcher path (the compiled bundle and V8's code cache), not through tsx. */
  { id: 'cli.start.bundle', unit: 'ms', fast: false, budget: 400, gated: false, run: () => {
    const dir = mkdtempSync(join(tmpdir(), 'bench-bundle-')); try { const out = join(dir, 'cli.mjs'); execFileSync(process.execPath, [join(ROOT, 'tools/dev/bundle-cli.mjs'), out]); const env = { ...process.env, NODE_ENV: 'production', NODE_COMPILE_CACHE: join(dir, 'v8') };
      return time(() => { execFileSync(process.execPath, [out, '--version'], { env, stdio: 'ignore' }); }, 6, 2); } finally { rmSync(dir, { recursive: true, force: true }); } } },
  /** The leak check of the card, with a criterion that can be measured: after 10,000 frames of a busy session are in the guest's state, 10,000 more are added; the heap that stays (after a full collection) must be at most 4 MB. It measures about 0.4 MB (the state keeps a bounded window, and the frames carry about 0.4 MB of text), so 4 MB leaves ten times that and a leak of whole frames or of the state itself would break it. */
  { id: 'memory.leak.deltas.10k', unit: 'MB', fast: false, budget: 4, gated: true, run: () => {
    v8.setFlagsFromString('--expose_gc'); const gc = vm.runInNewContext('gc') as () => void; const frames = sessionFrames(10_000); const later = sessionFrames(10_000).map((f, i) => ({ ...f, id: 'msg_g' + i, seq: 10_000 + i + 1 })) as DecodedFrame[];
    const out: number[] = []; for (let r = 0; r < 3; r++) { let s = initialGuestState({ member: 'mem_x', role: 'editor' }); for (const f of frames) s = reduceGuestState(s, f); gc(); gc(); const h0 = process.memoryUsage().heapUsed; for (const f of later) s = reduceGuestState(s, f); gc(); gc(); out.push(Math.max(0, process.memoryUsage().heapUsed - h0) / 1024 / 1024); void s; } return out; } },
  { id: 'memory.transcript.10k', unit: 'MB', fast: false, budget: 300, gated: false /* the harness itself (tsx and the loaded packages) uses about 300 MB; this gates once it is measured in the packaged CLI */, run: () => { const items = transcriptItems(10_000); const l = new TranscriptLayout().update(items, 100); l.slice(0, 40); globalThis.gc?.(); return [process.memoryUsage().rss / 1024 / 1024]; } },
];
function join(...p: string[]) { return p.join('/'); }
