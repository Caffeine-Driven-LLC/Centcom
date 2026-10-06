import { chmod, mkdir, open, readFile, rename } from 'node:fs/promises';
import { dirname } from 'node:path';
import { randomBytes } from 'node:crypto';
import type { RunnerLog, TrustKind, TrustStore } from './types.js';

interface Entry { label: string; at: string }
type Doc = { v: 1; trusted: Record<string, Entry> };
const KINDS = new Set<TrustKind>(['mcp', 'hooks', 'project-rules']);
const HASH = /^[0-9a-f]{64}$/;

/** `trust.json` in the config dir: which MCP servers, hook scripts and project rule files the user approved, by SHA-256. Atomic writes, mode 0600. A damaged file is set aside as `trust.json.corrupt` and treated as empty (nothing stays trusted by accident). */
export class FileTrustStore implements TrustStore {
  private doc?: Doc;
  constructor(private file: string, private o: { now?: () => Date; log?: RunnerLog } = {}) {}

  private async load(): Promise<Doc> {
    if (this.doc) return this.doc;
    let raw: string; try { raw = await readFile(this.file, 'utf8'); } catch (e) { if ((e as NodeJS.ErrnoException).code === 'ENOENT') return (this.doc = { v: 1, trusted: {} }); throw e; }
    try { const j = JSON.parse(raw) as Doc; if (j?.v !== 1 || typeof j.trusted !== 'object' || j.trusted === null || Array.isArray(j.trusted)) throw new Error('shape'); this.doc = { v: 1, trusted: Object.fromEntries(Object.entries(j.trusted).filter(([k, e]) => /^(mcp|hooks|project-rules):[0-9a-f]{64}$/.test(k) && e && typeof e.label === 'string')) }; }
    catch { try { await rename(this.file, this.file + '.corrupt'); } catch { /* the file may be gone or unwritable: still treat as empty */ } this.o.log?.warn('trust.corrupt'); this.doc = { v: 1, trusted: {} }; }
    return this.doc!;
  }
  private async save(d: Doc) {
    await mkdir(dirname(this.file), { recursive: true, mode: 0o700 }); const tmp = `${this.file}.${randomBytes(4).toString('hex')}.tmp`;
    const fh = await open(tmp, 'w', 0o600); try { await fh.writeFile(JSON.stringify(d, null, 2) + '\n'); await fh.sync(); } finally { await fh.close(); }
    await chmod(tmp, 0o600).catch(() => undefined); await rename(tmp, this.file);
  }
  private key(kind: TrustKind, sha: string) { if (!KINDS.has(kind) || !HASH.test(sha)) throw new TypeError('invalid trust key'); return `${kind}:${sha}`; }
  async isTrusted(kind: TrustKind, sha256: string) { return this.key(kind, sha256) in (await this.load()).trusted; }
  async trust(kind: TrustKind, sha256: string, label: string) { const d = await this.load(); d.trusted[this.key(kind, sha256)] = { label: label.slice(0, 200), at: (this.o.now?.() ?? new Date()).toISOString() }; await this.save(d); }
  async revoke(kind: TrustKind, sha256: string) { const d = await this.load(); if (delete d.trusted[this.key(kind, sha256)]) await this.save(d); }
}
