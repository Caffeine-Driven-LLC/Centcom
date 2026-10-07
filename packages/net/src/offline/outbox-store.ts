/** Frames written while offline, kept on disk (encrypted at rest) until they can be sent. Ids are kept, so a replay is harmless. */
import { appendFile, mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { OfflineDraft, OfflineStore } from '../session/client.js';
import type { Keychain } from '../crypto/keychain.js';
import { b64, sodium, unb64 } from '../crypto/sodium.js';
import { OfflineBufferFull } from './errors.js';

export interface DurableOutbox extends OfflineStore { size(): { frames: number; bytes: number }; clear(): Promise<void>; /** lines that could not be read when the file was loaded */ readonly corrupted: number }
export interface OutboxOptions { maxFrames?: number; maxBytes?: number; /** where the key that encrypts the file lives (the OS keychain) */ keychain: Keychain; warn?: (msg: string, ctx?: Record<string, unknown>) => void }
export const MAX_FRAMES = 500; export const MAX_BYTES = 4 * 1024 * 1024; const ACCOUNT = 'offline-outbox-key';
const safe = (sid: string): string => sid.replace(/[^A-Za-z0-9_-]/g, '_').slice(0, 64);

/** Loads or creates the session's outbox. The file is one encrypted JSON line per frame; an unreadable line (a torn write, a bad byte) is skipped with a warning and the rest are kept. */
export async function createDurableOutbox(dir: string, sid: string, o: OutboxOptions): Promise<DurableOutbox> {
  const maxFrames = o.maxFrames ?? MAX_FRAMES; const maxBytes = o.maxBytes ?? MAX_BYTES; const s = sodium(); const path = join(dir, `outbox-${safe(sid)}.jsonl`);
  let keyText = await o.keychain.get(ACCOUNT); if (!keyText) { keyText = b64(s.crypto_secretbox_keygen()); await o.keychain.set(ACCOUNT, keyText); } const key = unb64(keyText);
  const seal = (d: OfflineDraft): string => { const n = s.randombytes_buf(s.crypto_secretbox_NONCEBYTES); return JSON.stringify({ n: b64(n), c: b64(s.crypto_secretbox_easy(new TextEncoder().encode(JSON.stringify(d)), n, key)) }); };
  const open = (line: string): OfflineDraft | undefined => { try { const j = JSON.parse(line) as { n: string; c: string }; const pt = s.crypto_secretbox_open_easy(unb64(j.c), unb64(j.n), key); const d = JSON.parse(new TextDecoder().decode(pt)) as OfflineDraft; return typeof d.kind === 'string' && typeof d.id === 'string' ? d : undefined; } catch { return undefined; } };
  let lines: { text: string; d: OfflineDraft; bytes: number }[] = []; let corrupted = 0; let chain: Promise<unknown> = Promise.resolve(); const serial = <T>(f: () => Promise<T>): Promise<T> => { const r = chain.then(f, f); chain = r.catch(() => undefined); return r; };
  try { const raw = await readFile(path, 'utf8'); for (const l of raw.split('\n')) { if (!l.trim()) continue; const d = open(l); if (!d) { corrupted++; o.warn?.('offline.outbox_line_unreadable'); continue; } if (!lines.some((x) => x.d.id === d.id)) lines.push({ text: l, d, bytes: Buffer.byteLength(l) }); } } catch { /* no file yet */ }
  const bytes = () => lines.reduce((a, l) => a + l.bytes, 0);
  const rewrite = async (): Promise<void> => { await mkdir(dir, { recursive: true, mode: 0o700 }); const tmp = `${path}.${process.pid}.tmp`; await writeFile(tmp, lines.map((l) => l.text).join('\n') + (lines.length ? '\n' : ''), { mode: 0o600 }); await rename(tmp, path); };
  if (corrupted) await rewrite().catch(() => undefined);
  return {
    get corrupted() { return corrupted; }, size: () => ({ frames: lines.length, bytes: bytes() }),
    push: (d) => serial(async () => {
      if (lines.some((l) => l.d.id === d.id)) return; const text = seal(d); const b = Buffer.byteLength(text); if (lines.length >= maxFrames) throw new OfflineBufferFull('frames'); if (bytes() + b > maxBytes) throw new OfflineBufferFull('bytes');
      await mkdir(dir, { recursive: true, mode: 0o700 }); await appendFile(path, text + '\n', { mode: 0o600 }); lines.push({ text, d, bytes: b });
    }),
    drain: (send) => serial(async () => { let n = 0; while (lines.length) { const first = lines[0]!; try { await send(first.d); } catch (e) { const code = (e as { code?: string }).code; if (code && ['invalid_frame', 'forbidden', 'role_insufficient', 'muted', 'queue_full', 'frame_too_large', 'quota_exceeded', 'too_large'].includes(code)) { lines.shift(); await rewrite(); continue; } break; } lines.shift(); n++; await rewrite(); } return n; }),
    clear: () => serial(async () => { lines = []; await rewrite(); }),
  };
}
