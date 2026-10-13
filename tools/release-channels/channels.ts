/** Release channels for rehearsing the update path without a real account, key or host: publish signed releases to stable, beta or nightly, promote one channel to
 *  another, pull a bad release back, and raise the minimum supported version. Everything is signed with a key the CALLER makes (tests make a throwaway pair);
 *  no private key is ever stored in this repository, and the production trust list (apps/cli/src/autoupdate/keys.ts) is a separate, human step.
 *  Output is the REST form of the manifest (CT-API-RELEASES, OpenAPI `ReleaseManifest`): `sha256:<hex>`, `signature`, `macos`/`windows`. */
import { createHash } from 'node:crypto';
import { b64, initCrypto, sodium } from '../../packages/net/src/index.js';

export type Channel = 'stable' | 'beta' | 'nightly';
export type ApiPlatform = 'linux' | 'macos' | 'windows'; export type Arch = 'x64' | 'arm64';
export interface ReleaseFile { platform: ApiPlatform; arch: Arch; body: Buffer; kind?: string }
export interface ReleaseInput { version: string; files: ReleaseFile[]; minSupported?: string; notesUrl?: string; releasedAt?: string }
export interface Signer { id: string; secretKey: Uint8Array }
export interface PublishedRelease { channel: Channel; version: string; releasedAt: string; minSupported: string; notesUrl?: string; files: (ReleaseFile & { sha256: string; sig: string; kid: string })[] }
export interface ApiManifest {
  channel: Channel; version: string; released_at: string; min_supported_version: string; notes_url?: string;
  artifacts: { platform: ApiPlatform; arch: Arch; kind: string; url: string; sha256: string; size: number; signature: string; sig_kid: string }[];
}
/** A throwaway signing pair for tests and rehearsals. */
export async function makeTestSigner(id = 'rel-test'): Promise<{ signer: Signer; publicKey: string }> {
  await initCrypto(); const kp = sodium().crypto_sign_keypair(); return { signer: { id, secretKey: kp.privateKey }, publicKey: b64(kp.publicKey) };
}
/** The signature covers the 32 digest bytes, exactly as the update client verifies it. */
export const signDigest = (digest: Uint8Array, s: Signer): string => b64(sodium().crypto_sign_detached(digest, s.secretKey));

export class ReleaseChannels {
  private readonly history = new Map<Channel, PublishedRelease[]>();
  constructor(private signer: Signer, private readonly clock: () => string = () => '2026-10-13T00:00:00.000Z') {}
  /** Replaces the key used from now on (a rotation: older releases keep the signature they were published with). */
  rotate(signer: Signer): void { this.signer = signer; }
  publish(channel: Channel, r: ReleaseInput): PublishedRelease {
    if (!/^\d+\.\d+\.\d+(-[0-9A-Za-z.-]+)?$/.test(r.version)) throw new Error(`bad version ${r.version}`);
    if (!r.files.length) throw new Error('a release needs at least one file');
    const files = r.files.map((f) => ({ ...f, sha256: createHash('sha256').update(f.body).digest('hex'), sig: signDigest(createHash('sha256').update(f.body).digest(), this.signer), kid: this.signer.id }));
    const p: PublishedRelease = { channel, version: r.version, releasedAt: r.releasedAt ?? this.clock(), minSupported: r.minSupported ?? '0.0.0', ...(r.notesUrl ? { notesUrl: r.notesUrl } : {}), files };
    this.history.set(channel, [...(this.history.get(channel) ?? []), p]); return p;
  }
  /** Copies the newest release of `from` to `to` (the same signed files, a new channel label). */
  promote(from: Channel, to: Channel): PublishedRelease {
    const src = this.latest(from); if (!src) throw new Error(`nothing is published on ${from}`);
    const p: PublishedRelease = { ...src, channel: to }; this.history.set(to, [...(this.history.get(to) ?? []), p]); return p;
  }
  /** Pulls the newest release of a channel back so the one before it is served again. */
  yank(channel: Channel): PublishedRelease | undefined { const h = this.history.get(channel) ?? []; const gone = h.pop(); this.history.set(channel, h); return gone; }
  /** Raises the minimum supported version on the newest release of a channel (clients below it are "too old"). */
  setMinSupported(channel: Channel, v: string): void { const l = this.latest(channel); if (l) l.minSupported = v; }
  latest(channel: Channel): PublishedRelease | undefined { return (this.history.get(channel) ?? []).at(-1); }
  /** Every release ever published on a channel, oldest first (what a replay attack would serve). */
  all(channel: Channel): readonly PublishedRelease[] { return this.history.get(channel) ?? []; }
  file(channel: Channel, version: string, platform: ApiPlatform, arch: Arch): Buffer | undefined { return this.all(channel).find((r) => r.version === version)?.files.find((f) => f.platform === platform && f.arch === arch)?.body; }
  manifest(r: PublishedRelease, platform: ApiPlatform, arch: Arch, baseUrl: string): ApiManifest {
    return { channel: r.channel, version: r.version, released_at: r.releasedAt, min_supported_version: r.minSupported, ...(r.notesUrl ? { notes_url: r.notesUrl } : {}),
      artifacts: r.files.filter((f) => f.platform === platform && f.arch === arch).map((f) => ({ platform: f.platform, arch: f.arch, kind: f.kind ?? 'binary', url: `${baseUrl}/artifacts/${r.channel}/${r.version}/${f.platform}-${f.arch}`, sha256: `sha256:${f.sha256}`, size: f.body.length, signature: f.sig, sig_kid: f.kid })) };
  }
}
