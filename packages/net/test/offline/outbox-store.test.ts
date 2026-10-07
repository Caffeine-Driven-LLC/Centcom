import { mkdtempSync, readFileSync, writeFileSync, appendFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';
import { OfflineBufferFull, createDurableOutbox, createFileSeqStore, initCrypto, memoryKeychain, type OfflineDraft } from '../../src/index.js';

beforeAll(async () => { await initCrypto(); });
const dir = () => mkdtempSync(join(tmpdir(), 'cc-offline-')); const draft = (n: number, o: Partial<OfflineDraft> = {}): OfflineDraft => ({ kind: 'message.user', id: `msg_${String(n).padStart(26, 'A')}`.slice(0, 30), secret: { text: `SECRET-TEXT-${n}` }, ...o });
const SID = 'ses_01JA3Z8K2M5N7P9Q0R1S2T3V4W';

describe('durable outbox (acceptance 2, 3)', () => {
  it('keeps frames in order, survives a restart, and hands them over once each with their ids', async () => {
    const d = dir(); const kc = memoryKeychain(); const a = await createDurableOutbox(d, SID, { keychain: kc }); for (let i = 1; i <= 10; i++) await a.push(draft(i)); expect(a.size().frames).toBe(10);
    const b = await createDurableOutbox(d, SID, { keychain: kc }); expect(b.size()).toEqual(a.size()); const got: string[] = []; expect(await b.drain(async (x) => { got.push(x.id); })).toBe(10); expect(got).toEqual(Array.from({ length: 10 }, (_, i) => draft(i + 1).id)); expect(b.size().frames).toBe(0); const c = await createDurableOutbox(d, SID, { keychain: kc }); expect(c.size().frames).toBe(0);
  });
  it('is encrypted on disk: no message text, and the key lives in the keychain only', async () => { const d = dir(); const kc = memoryKeychain(); const o = await createDurableOutbox(d, SID, { keychain: kc }); await o.push(draft(1, { p: { to: 'x' } })); const file = readFileSync(join(d, `outbox-${SID}.jsonl`), 'utf8'); expect(file).not.toContain('SECRET-TEXT'); expect(file.length).toBeGreaterThan(20); expect(kc.entries.size).toBe(1); expect(file).not.toContain([...kc.entries.values()][0]!); });
  it('the 501st frame and the byte cap are refused with OfflineBufferFull and nothing stored is dropped', async () => {
    const o = await createDurableOutbox(dir(), SID, { keychain: memoryKeychain(), maxFrames: 500 }); for (let i = 1; i <= 500; i++) await o.push(draft(i, { secret: { t: 'x' } })); await expect(o.push(draft(501))).rejects.toMatchObject({ name: 'OfflineBufferFull', limit: 'frames' }); expect(o.size().frames).toBe(500);
    const small = await createDurableOutbox(dir(), SID, { keychain: memoryKeychain(), maxBytes: 2000 }); await small.push(draft(1, { secret: { t: 'y'.repeat(500) } })); await small.push(draft(2, { secret: { t: 'y'.repeat(500) } })); await expect(small.push(draft(3, { secret: { t: 'y'.repeat(900) } }))).rejects.toBeInstanceOf(OfflineBufferFull); expect(small.size().frames).toBe(2);
  });
  it('a repeated id is stored once; a torn or damaged line is skipped with a warning and the rest are kept', async () => {
    const d = dir(); const kc = memoryKeychain(); const warns: string[] = []; const o = await createDurableOutbox(d, SID, { keychain: kc, warn: (m) => warns.push(m) }); await o.push(draft(1)); await o.push(draft(1)); await o.push(draft(2)); expect(o.size().frames).toBe(2);
    appendFileSync(join(d, `outbox-${SID}.jsonl`), '{"n":"AAAA","c":"trunc'); const r = await createDurableOutbox(d, SID, { keychain: kc, warn: (m) => warns.push(m) }); expect(r.size().frames).toBe(2); expect(r.corrupted).toBe(1); expect(warns).toContain('offline.outbox_line_unreadable'); const f = join(d, `outbox-${SID}.jsonl`); expect(readFileSync(f, 'utf8').trim().split('\n')).toHaveLength(2); writeFileSync(f, 'not json at all\n'); const z = await createDurableOutbox(d, SID, { keychain: kc }); expect(z.size().frames).toBe(0);
  });
  it('drain keeps what could not be sent, drops what the relay will never take, and clear empties the file', async () => {
    const d = dir(); const o = await createDurableOutbox(d, SID, { keychain: memoryKeychain() }); for (let i = 1; i <= 4; i++) await o.push(draft(i)); let calls = 0; const n = await o.drain(async (x) => { calls++; if (x.id === draft(2).id) throw Object.assign(new Error('refused'), { code: 'forbidden' }); if (x.id === draft(3).id) throw new Error('link down'); }); expect(n).toBe(1); expect(calls).toBe(3); expect(o.size().frames).toBe(2); await o.clear(); expect(o.size()).toEqual({ frames: 0, bytes: 0 });
  });
  it('another session has its own file', async () => { const d = dir(); const kc = memoryKeychain(); const a = await createDurableOutbox(d, SID, { keychain: kc }); const b = await createDurableOutbox(d, 'ses_OTHER', { keychain: kc }); await a.push(draft(1)); expect(b.size().frames).toBe(0); });
});
describe('file seq store (acceptance 8)', () => {
  it('keeps the position per session across restarts, rejects nonsense, and never leaves a half file', async () => {
    const d = dir(); const a = createFileSeqStore(d); expect(await a.load(SID)).toBeNull(); await a.save(SID, 41); await a.save(SID, 42); const b = createFileSeqStore(d); expect(await b.load(SID)).toBe(42); expect(await b.load('ses_OTHER')).toBeNull(); writeFileSync(join(d, `seq-${SID}.json`), '{"seq":-3}'); expect(await b.load(SID)).toBeNull(); writeFileSync(join(d, `seq-${SID}.json`), 'garbage'); expect(await b.load(SID)).toBeNull();
  });
});
