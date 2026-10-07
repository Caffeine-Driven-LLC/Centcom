/** Every sequenced frame, as it was on the wire, one JSON line each, in a file only the owner can read. Ciphertext stays ciphertext. */
import { chmod, mkdir, open, type FileHandle } from 'node:fs/promises';
import { dirname } from 'node:path';
import type { Frame } from '@centcom/protocol';
export class TranscriptFile {
  private handle?: FileHandle; private chain: Promise<void> = Promise.resolve(); private failed = false;
  constructor(private readonly path: string, private readonly warn?: (msg: string) => void) {}
  /** Frames are appended in the order given; a failing disk is reported once and does not stop the session. */
  append(f: Frame): void {
    const line = JSON.stringify(f) + '\n';
    this.chain = this.chain.then(async () => { if (this.failed) return; try { if (!this.handle) { await mkdir(dirname(this.path), { recursive: true, mode: 0o700 }); this.handle = await open(this.path, 'a', 0o600); await chmod(this.path, 0o600).catch(() => undefined); } await this.handle.appendFile(line); } catch { this.failed = true; this.warn?.('lan.transcript_failed'); } });
  }
  flush(): Promise<void> { return this.chain; }
  async close(): Promise<void> { await this.chain; await this.handle?.close().catch(() => undefined); this.handle = undefined; }
}
