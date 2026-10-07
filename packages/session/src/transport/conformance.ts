/** One suite, three transports: whatever carries a session must behave the same (hello and welcome, order, echo with number, resume, bad frames, closing). */
import { afterEach, describe, expect, it } from 'vitest';
import type { SessionTransport } from './types.js';

export interface ConformanceRig { transport: SessionTransport; /** a second transport to the same session, starting from `lastSeq` (a new connection after the first one went away) */ again(lastSeq: number | null): Promise<SessionTransport>; teardown(): Promise<void> }
const SID = 'ses_01JA3Z8K2M5N7P9Q0R1S2T3V4W'; const frameId = (n: number) => `msg_${String(n).padStart(26, 'A')}`.slice(0, 30);
const reaction = (n: number) => ({ t: 'event' as const, id: frameId(n), sid: SID, k: 'reaction', p: { target: frameId(9999), code: `c${n}`, op: 'add' } });
const until = async (f: () => boolean, ms = 5000): Promise<void> => { const t0 = Date.now(); while (!f()) { if (Date.now() - t0 > ms) throw new Error('timed out waiting'); await new Promise((r) => setTimeout(r, 5)); } };

export function transportConformance(name: string, make: () => Promise<ConformanceRig>): void {
  describe(`transport conformance: ${name}`, () => {
    const rigs: ConformanceRig[] = []; const open: SessionTransport[] = []; afterEach(async () => { for (const t of open.splice(0)) await t.close().catch(() => undefined); for (const r of rigs.splice(0)) await r.teardown(); });
    const start = async () => { const r = await make(); rigs.push(r); open.push(r.transport); return r; };
    it('connects, gets a welcome for protocol 1 with our member, and is ready', async () => {
      const { transport } = await start(); const w = await transport.connect(); expect(w.protocol).toBe(1); expect(w.member.id).toMatch(/^mem_/); expect(transport.welcome).toBe(w); expect(transport.state).toBe('ready'); expect(['relay', 'lan', 'local']).toContain(transport.kind);
    });
    it('delivers 100 frames in order, each echoed to us with its number and our member as sender', async () => {
      const { transport } = await start(); await transport.connect(); const got: { id?: string; seq?: number; from?: string }[] = []; transport.on('frame', (f) => { if (f.k === 'reaction') got.push({ id: f.id, seq: f.seq, from: f.from }); });
      for (let n = 1; n <= 100; n++) await transport.send(reaction(n)); await until(() => got.length === 100); expect(got.map((g) => g.id)).toEqual(Array.from({ length: 100 }, (_, i) => frameId(i + 1))); const seqs = got.map((g) => g.seq!); expect(seqs.every((s, i) => i === 0 || s === seqs[i - 1]! + 1)).toBe(true); expect(new Set(got.map((g) => g.from)).size).toBe(1); expect(got[0]!.from).toBe(transport.welcome!.member.id);
    });
    it('stays alive: still ready after a moment of silence', async () => { const { transport } = await start(); await transport.connect(); await new Promise((r) => setTimeout(r, 250)); expect(transport.state).toBe('ready'); });
    it('resumes from last_seq: a second connection gets only what came after', async () => {
      const r = await start(); await r.transport.connect(); const first: number[] = []; r.transport.on('frame', (f) => { if (f.k === 'reaction') first.push(f.seq!); }); for (let n = 1; n <= 10; n++) await r.transport.send(reaction(n)); await until(() => first.length === 10); const mid = first[4]!; await r.transport.close();
      const t2 = await r.again(mid); open.push(t2); const second: number[] = []; t2.on('frame', (f) => { if (f.k === 'reaction') second.push(f.seq!); }); await t2.connect(); await until(() => second.length >= 5, 5000); expect(second.slice(0, 5)).toEqual(first.slice(5, 10));
    });
    it('a frame the protocol does not allow is refused without breaking the connection', async () => { const { transport } = await start(); await transport.connect(); await expect(transport.send({ t: 'event' } as never)).rejects.toBeDefined(); await expect(transport.send({ t: 'sys.hello', p: {} } as never)).rejects.toBeDefined(); expect(transport.state).toBe('ready'); const seen: string[] = []; transport.on('frame', (f) => { if (f.k === 'reaction') seen.push(f.id ?? ''); }); await transport.send(reaction(1)); await until(() => seen.length === 1); });
    it('closes gracefully and closing again does nothing', async () => { const { transport } = await start(); await transport.connect(); const closed: number[] = []; transport.on('closed', (c) => closed.push(c.code)); await transport.close(); await transport.close(); expect(transport.state === 'closed' || transport.state === 'idle').toBe(true); expect(closed.length).toBeLessThanOrEqual(1); await expect(transport.send(reaction(2))).rejects.toBeDefined(); });
  });
}
