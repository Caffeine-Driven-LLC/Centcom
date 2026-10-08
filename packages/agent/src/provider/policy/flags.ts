/** The three flags this lane reads (also registered in the client's typed registry, packages/net/src/flags/registry.ts). A flags client that has not loaded yields the defaults. */
export const PROVIDER_FLAGS = {
  'provider.claude_code': { type: 'boolean', default: true },
  'provider.codex': { type: 'boolean', default: true },
  'provider.command_post.subscription': { type: 'boolean', default: false },
} as const;
export type ProviderFlagKey = keyof typeof PROVIDER_FLAGS;
/** What the policy needs from the flags client (`FlagsClient` satisfies it). */
export interface FlagSource { flag(key: ProviderFlagKey): boolean; on(ev: 'flags-changed', fn: (d: unknown) => void): () => void }
export const engineFlag = (engine: string): ProviderFlagKey | undefined => (engine === 'claude-code' ? 'provider.claude_code' : engine === 'codex' ? 'provider.codex' : undefined);
/** Reads a flag, falling back to its default when there is no client or it throws. */
export function readFlag(src: FlagSource | undefined, key: ProviderFlagKey): boolean { try { const v = src?.flag(key); return typeof v === 'boolean' ? v : PROVIDER_FLAGS[key].default; } catch { return PROVIDER_FLAGS[key].default; } }
/** Calls `fn` once per flags-changed that touches a provider flag. Returns an unsubscribe. */
export function onProviderFlagsChanged(src: FlagSource | undefined, fn: () => void): () => void {
  if (!src) return () => undefined;
  return src.on('flags-changed', (d) => { const keys = flagKeysOf(d); if (!keys || keys.some((k) => k in PROVIDER_FLAGS)) fn(); });
}
function flagKeysOf(d: unknown): string[] | undefined { if (!d || typeof d !== 'object') return undefined; const o = d as { added?: string[]; removed?: string[]; changed?: string[] }; const all = [...(o.added ?? []), ...(o.removed ?? []), ...(o.changed ?? [])]; return all.length || 'added' in o || 'changed' in o || 'removed' in o ? all : undefined; }
