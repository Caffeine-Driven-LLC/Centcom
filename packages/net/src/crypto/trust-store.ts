/** Trust on first use: the first keys seen for a device are remembered; different keys later are `changed`, never silently accepted. Only public keys are stored. */
export interface TrustFile { read(): Promise<string | undefined>; write(text: string): Promise<void> }
export type TrustResult = 'new' | 'match' | 'changed';
export class TrustStore {
  private known = new Map<string, { x25519: string; ed25519: string }>(); private loaded = false;
  constructor(private file?: TrustFile) {}
  private async load() { if (this.loaded || !this.file) { this.loaded = true; return; } this.loaded = true; try { const j = JSON.parse((await this.file.read()) ?? '{}') as Record<string, { x25519: string; ed25519: string }>; for (const [k, v] of Object.entries(j)) if (typeof v?.x25519 === 'string' && typeof v?.ed25519 === 'string') this.known.set(k, v); } catch { /* an unreadable file trusts nothing */ } }
  async check(deviceId: string, keys: { x25519: string; ed25519: string }): Promise<TrustResult> {
    await this.load(); const k = this.known.get(deviceId); if (!k) { this.known.set(deviceId, { ...keys }); await this.file?.write(JSON.stringify(Object.fromEntries(this.known), null, 2)); return 'new'; }
    return k.x25519 === keys.x25519 && k.ed25519 === keys.ed25519 ? 'match' : 'changed';
  }
  /** After the person compared fingerprints and accepted the new keys. */
  async accept(deviceId: string, keys: { x25519: string; ed25519: string }): Promise<void> { await this.load(); this.known.set(deviceId, { ...keys }); await this.file?.write(JSON.stringify(Object.fromEntries(this.known), null, 2)); }
}
