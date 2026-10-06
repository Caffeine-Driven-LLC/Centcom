import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { WebSocket } from 'ws';
import { VirtualClock } from '@centcom/testkit';
import { LanHostServer, type FrameInterceptor, type LanHostOptions } from '../../src/index.js';

export const SID = 'ses_01JA3Z8K2M5N7P9Q0R1S2T3V4W';
export interface Who { memberId: string; deviceId: string; name: string; role: 'host' | 'editor' | 'viewer'; slot?: number; revoked?: boolean }
export const mem = (n: number) => `mem_${String(n).padStart(26, 'A')}`.slice(0, 30); export const dev = (n: number) => `dev_${String(n).padStart(26, 'A')}`.slice(0, 30);
export const tk = (s: string) => s.padEnd(43, '_'); export const msg = (n: number) => `msg_${String(n).padStart(26, 'A')}`.slice(0, 30);
export function makeServer(o: Partial<LanHostOptions> & { tokens?: Map<string, Who>; interceptor?: FrameInterceptor } = {}) {
  const clock = new VirtualClock(Date.UTC(2026, 9, 7, 12)); const tokens = o.tokens ?? new Map<string, Who>(); let ids = 0; const dir = mkdtempSync(join(tmpdir(), 'cc-lanhost-')); const transcriptPath = join(dir, 'transcript.jsonl');
  const srv = new LanHostServer({ sessionId: SID, sessionName: 'demo', hostMember: { id: mem(1), name: 'Host', slot: 0, role: 'host' }, port: 0, bind: '127.0.0.1', tokens: { validate: async (t) => tokens.get(t) ?? null }, transcriptPath, clock, ids: { next: (p) => `${p}_${String(++ids).padStart(26, 'A')}`.slice(0, 30) }, ...o } as LanHostOptions);
  return { srv, clock, tokens, transcriptPath, dir, readTranscript: () => readFileSync(transcriptPath, 'utf8').trim().split('\n').filter(Boolean).map((l) => JSON.parse(l)) };
}
export type Raw = ReturnType<typeof rawClient> extends Promise<infer T> ? T : never;
/** A bare WebSocket client for protocol-level tests. */
export async function rawClient(port: number, o: { subprotocol?: string } = {}) {
  const ws = new WebSocket(`ws://127.0.0.1:${port}/`, o.subprotocol ?? 'centcom.v1'); const frames: Record<string, any>[] = []; const closes: number[] = []; const texts: string[] = [];
  ws.on('message', (d) => { const t = d.toString(); texts.push(t); try { frames.push(JSON.parse(t)); } catch { /* not json */ } }); ws.on('close', (c) => closes.push(c)); ws.on('error', () => undefined);
  await new Promise<void>((res, rej) => { ws.once('open', () => res()); ws.once('error', rej); });
  const wait = async (f: () => boolean, ms = 3000) => { const t0 = Date.now(); while (!f()) { if (Date.now() - t0 > ms) throw new Error('timed out waiting'); await new Promise((r) => setTimeout(r, 5)); } };
  return { ws, frames, closes, texts, wait,
    send: (f: unknown) => ws.send(typeof f === 'string' ? f : JSON.stringify(f)),
    hello: (ticket: string, last: number | null = null, extra: Record<string, unknown> = {}) => ws.send(JSON.stringify({ v: 1, t: 'sys.hello', p: { protocols: [1], caps: ['resume'], ticket, client: { name: 'centcom-cli', version: '1.0.0', contract: '1.2.0' }, last_seq: last, ...extra } })),
    welcomed: () => frames.find((f) => f.t === 'sys.welcome'), byType: (t: string) => frames.filter((f) => f.t === t), seqs: () => frames.filter((f) => typeof f.seq === 'number').map((f) => f.seq as number), closed: () => closes.length > 0,
    close: () => ws.close() };
}
export const reaction = (id: string, extra: Record<string, unknown> = {}) => ({ v: 1, t: 'event', id, sid: SID, k: 'reaction', p: { target: msg(999), code: 'ok', op: 'add' }, ...extra });
