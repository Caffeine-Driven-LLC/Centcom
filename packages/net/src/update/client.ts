/** The update client: check a channel, download the artifact for this computer, verify it, put it in place, or go back. Verification always comes before applying. */
import { dirname, join } from 'node:path';
import type { HttpClient } from '../http/types.js';
import { applyBinary, rollbackBinary } from './applier.js';
import { downloadArtifact, type Progress } from './downloader.js';
import { ManagedInstallError, NoUpdateError, NotVerifiedError } from './errors.js';
import { detectInstallMethod, updateCommand, type InstallMethod } from './install-method.js';
import type { ReleaseKeySet } from './keys.js';
import { compareVersions, isPrerelease } from './semver.js';
import { verifyArtifact } from './verifier.js';
import { rm } from 'node:fs/promises';

export type Channel = 'stable' | 'beta' | 'nightly';
export interface ReleaseArtifact { platform: string; arch: string; kind?: string; url: string; sha256: string; size: number; sig: string; sig_kid?: string }
export interface ReleaseManifest { channel: Channel; version: string; released_at: string; min_supported: string; notes_url?: string; artifacts: ReleaseArtifact[] }
export interface CheckResult { available: boolean; version?: string; channel: Channel; notesUrl?: string; required: boolean }
export interface StagedUpdate { version: string; channel: Channel; path: string; artifact: ReleaseArtifact; verified: boolean }
export interface UpdateClientOptions {
  http: HttpClient; currentVersion: string; platform: NodeJS.Platform; arch: string; channel: Channel; keys: ReleaseKeySet; installDir: string;
  /** The installed program's path (default: `<installDir>/centcom[.exe]`). */ exePath?: string; install?: { execPath: string; scriptPath?: string; isSea?: boolean }; fetch?: typeof fetch;
}
/** The OpenAPI contract names the platforms differently from the manifest schema (and the field names differ too); both spellings are read, until the contracts agree. */
export const API_PLATFORM: Record<string, string> = { linux: 'linux', darwin: 'macos', win32: 'windows' };
const NODE_PLATFORM: Record<string, string> = { macos: 'darwin', windows: 'win32' };
type Loose = Record<string, unknown>;
export function normaliseManifest(raw: unknown): ReleaseManifest {
  const m = (raw && typeof raw === 'object' ? raw : {}) as Loose; const s = (v: unknown) => (typeof v === 'string' ? v : '');
  return { channel: m.channel as Channel, version: s(m.version), released_at: s(m.released_at), min_supported: s(m.min_supported ?? m.min_supported_version) || '0.0.0', ...(typeof m.notes_url === 'string' ? { notes_url: m.notes_url } : {}),
    artifacts: (Array.isArray(m.artifacts) ? (m.artifacts as Loose[]) : []).map((a) => ({ platform: NODE_PLATFORM[s(a.platform)] ?? s(a.platform), arch: s(a.arch), ...(typeof a.kind === 'string' ? { kind: a.kind } : {}), url: s(a.url), sha256: s(a.sha256).replace(/^sha256:/, ''), size: typeof a.size === 'number' ? a.size : 0, sig: s(a.sig ?? a.signature), ...(typeof a.sig_kid === 'string' ? { sig_kid: a.sig_kid } : {}) })) };
}

export class UpdateClient {
  private manifest?: ReleaseManifest; private tooOld = false; readonly method: InstallMethod;
  private readonly exe: string; private readonly staged: string; private readonly prev: string;
  constructor(private readonly o: UpdateClientOptions) {
    this.method = detectInstallMethod({ execPath: o.install?.execPath ?? o.exePath ?? '', scriptPath: o.install?.scriptPath, isSea: o.install?.isSea, platform: o.platform });
    this.exe = o.exePath ?? join(o.installDir, o.platform === 'win32' ? 'centcom.exe' : 'centcom'); this.staged = join(dirname(this.exe), `.centcom-update${o.platform === 'win32' ? '.exe' : ''}.part`); this.prev = `${this.exe}.prev`;
  }
  /** The service said this client is too old (HTTP 426 or close code 4426): an update is required. */
  markRequired(): void { this.tooOld = true; }

  async check(o: { signal?: AbortSignal } = {}): Promise<CheckResult> {
    const r = await this.o.http.call('getLatestRelease', { path: { channel: this.o.channel }, query: { platform: API_PLATFORM[this.o.platform] ?? this.o.platform, arch: this.o.arch } } as never, { signal: o.signal });
    const m = normaliseManifest(r.data); this.manifest = m; const required = this.tooOld || compareVersions(this.o.currentVersion, m.min_supported ?? '0.0.0') < 0;
    /* only a higher version on this channel; a pre-release is never offered on stable */
    const newer = compareVersions(m.version, this.o.currentVersion) > 0 && !(this.o.channel === 'stable' && isPrerelease(m.version)) && m.channel === this.o.channel;
    return { available: newer, channel: this.o.channel, required, ...(newer ? { version: m.version } : {}), ...(m.notes_url ? { notesUrl: m.notes_url } : {}) };
  }
  private artifact(): ReleaseArtifact { const a = this.manifest?.artifacts.find((x) => x.platform === this.o.platform && x.arch === this.o.arch && (x.kind ?? 'binary') === 'binary'); if (!a) throw new NoUpdateError('There is no download for this computer in that release.'); return a; }

  async download(o: { onProgress?: (p: Progress) => void; signal?: AbortSignal } = {}): Promise<StagedUpdate> {
    if (!this.manifest) await this.check({ signal: o.signal }); const m = this.manifest!; const a = this.artifact();
    if (this.method === 'npm' || this.method === 'homebrew') throw new ManagedInstallError(updateCommand(this.method)!);
    await downloadArtifact({ url: a.url, dest: this.staged, size: a.size, fetch: this.o.fetch, onProgress: o.onProgress, signal: o.signal });
    return { version: m.version, channel: m.channel, path: this.staged, artifact: a, verified: false };
  }
  /** Checks the hash and the signature. On failure the file is deleted and nothing else changed. */
  async verify(s: StagedUpdate): Promise<void> { try { await verifyArtifact(s.path, s.artifact, this.o.keys); s.verified = true; } catch (e) { s.verified = false; await rm(s.path, { force: true }); throw e; } }
  async apply(s: StagedUpdate): Promise<{ restartRequired: boolean; previous: string }> {
    if (!s.verified) throw new NotVerifiedError(); if (this.method === 'npm' || this.method === 'homebrew') throw new ManagedInstallError(updateCommand(this.method)!);
    const r = await applyBinary({ exe: this.exe, staged: s.path, prev: this.prev }, this.o.platform); return { restartRequired: r.restartRequired, previous: this.o.currentVersion };
  }
  async rollback(): Promise<void> { await rollbackBinary({ exe: this.exe, prev: this.prev }, this.o.platform); }
}
