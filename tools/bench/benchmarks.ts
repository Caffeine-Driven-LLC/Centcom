/** The benchmarks. Each returns samples (milliseconds, or operations per second). They run in-process on fixtures; nothing touches the network. */
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { initCrypto, sodium, encryptPayload, decryptPayload, signFrame, verifyFrame, type FrameHeader } from '../../packages/net/src/index.js';
import { parseFrame } from '../../packages/protocol/src/index.js';
import { renderHalfBlock, getBaked } from '../../packages/mascot/src/index.js';
import { TranscriptLayout } from '../../packages/tui/src/transcript/index.js';
import { SessionStore } from '../../packages/tui/src/index.js';
import { keypressSamples } from '../../packages/tui/src/perf/keypress.js';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';


const ROOT = fileURLToPath(new URL('../../', import.meta.url));
export interface Bench { id: string; unit: 'ms' | 'ops/s' | 'MB'; fast: boolean; budget: number | null; /** false: measured and shown, not yet gating (waiting for something the budget assumes) */ gated: boolean; run(): Promise<number[]> | number[] }
/** `n` samples; each is the average of `inner` runs, so very fast operations are not drowned by timer noise. */
const time = (fn: () => void, n: number, warm = 3, inner = 1): number[] => { for (let i = 0; i < warm * inner; i++) fn(); const out: number[] = []; for (let i = 0; i < n; i++) { const t0 = performance.now(); for (let j = 0; j < inner; j++) fn(); out.push((performance.now() - t0) / inner); } return out; };
/** Set to a number like 1.25 to make the transcript benchmark that much slower (the self-test of the gate). */
const slow = (): number => Number(process.env.CENTCOM_BENCH_SLOWDOWN_TRANSCRIPT ?? 1);
const spin = (ms: number) => { const t = performance.now(); while (performance.now() - t < ms) { /* wait */ } };

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
  { id: 'memory.transcript.10k', unit: 'MB', fast: false, budget: 300, gated: false /* the harness itself (tsx and the loaded packages) uses about 300 MB; this gates once it is measured in the packaged CLI */, run: () => { const items = transcriptItems(10_000); const l = new TranscriptLayout().update(items, 100); l.slice(0, 40); globalThis.gc?.(); return [process.memoryUsage().rss / 1024 / 1024]; } },
];
function join(...p: string[]) { return p.join('/'); }
