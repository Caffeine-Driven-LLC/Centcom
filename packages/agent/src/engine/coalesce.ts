import type { RunnerClock } from '../runner/types.js';

export interface DeltaFrame { message_id: string; index: number; text: string }
export interface CoalesceOptions { clock: RunnerClock; emit: (f: DeltaFrame) => void; maxBytes?: number; maxPerSecond?: number; /** The longest a small delta waits before it is sent. */ latencyMs?: number }
interface Seg { msg: string; buf: Buffer; index: number; ended: boolean }

/** Merges many small text deltas into few frames: at most 4 KiB each and at most 10 per second, never cutting a UTF-8 character in half. Lossless: the frames of one message concatenate to exactly its input. */
export function createCoalescer(o: CoalesceOptions) {
  const maxBytes = o.maxBytes ?? 4096; const maxPer = o.maxPerSecond ?? 10; const latency = o.latencyMs ?? 100;
  const segs: Seg[] = []; const sent: number[] = []; let timer: unknown; let flushNow = false;
  const slotWait = () => { const now = o.clock.now(); while (sent.length && now - sent[0]! >= 1000) sent.shift(); return sent.length < maxPer ? 0 : 1000 - (now - sent[0]!); };
  const cut = (b: Buffer): number => { if (b.length <= maxBytes) return b.length; let n = maxBytes; while (n > 0 && (b[n]! & 0xc0) === 0x80) n--; return n || maxBytes; }; // back up to a character boundary
  const arm = (ms: number, flush: boolean) => { if (timer !== undefined) return; timer = o.clock.setTimeout(() => { timer = undefined; pump(flush); }, Math.max(1, ms)); };
  function pump(flush: boolean) {
    if (flush) flushNow = true;
    while (segs.length) {
      const s = segs[0]!;
      if (!s.buf.length) { if (s.ended || segs.length > 1) { segs.shift(); continue; } break; }
      if (!(s.buf.length >= maxBytes || s.ended || flushNow)) { arm(latency, true); return; }
      const wait = slotWait(); if (wait > 0) { arm(wait, false); return; }
      const n = cut(s.buf); const text = s.buf.subarray(0, n).toString('utf8'); s.buf = s.buf.subarray(n); sent.push(o.clock.now()); o.emit({ message_id: s.msg, index: s.index++, text });
    }
    flushNow = false;
  }
  return {
    push(messageId: string, text: string) {
      let s = segs.at(-1); if (!s || s.msg !== messageId || s.ended) { if (s) s.ended = true; s = { msg: messageId, buf: Buffer.alloc(0), index: 0, ended: false }; segs.push(s); }
      s.buf = Buffer.concat([s.buf, Buffer.from(text, 'utf8')]); pump(false);
    },
    /** The message is complete (text.done): everything left goes out as soon as the rate limit allows. */
    end(messageId: string) { const s = segs.findLast((x) => x.msg === messageId); if (s) s.ended = true; pump(false); },
    pending: () => segs.reduce((n, s) => n + s.buf.length, 0),
    dispose() { if (timer !== undefined) o.clock.clearTimeout(timer as never); timer = undefined; segs.length = 0; },
  };
}
