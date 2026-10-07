/** Encrypted frames that arrived before the key did: kept (bounded) until `key.grant` is opened. */
import type { Frame } from '@centcom/protocol';
export const KEY_WAIT_FRAMES = 2000; export const KEY_WAIT_BYTES = 8 * 1024 * 1024;
export class KeyWaitBuffer {
  private q: { f: Frame; bytes: number }[] = []; private bytes = 0; evicted = 0;
  constructor(private readonly maxFrames = KEY_WAIT_FRAMES, private readonly maxBytes = KEY_WAIT_BYTES) {}
  get size(): number { return this.q.length; }
  /** Returns how many old frames this push evicted. */
  push(f: Frame): number { const b = f.ct?.c.length ?? 0; this.q.push({ f, bytes: b }); this.bytes += b; let ev = 0; while (this.q.length > this.maxFrames || (this.bytes > this.maxBytes && this.q.length > 1)) { const o = this.q.shift()!; this.bytes -= o.bytes; ev++; } this.evicted += ev; return ev; }
  drain(): Frame[] { const out = this.q.map((x) => x.f); this.q = []; this.bytes = 0; return out; }
}
