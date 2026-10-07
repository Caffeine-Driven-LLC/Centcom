import { z } from 'zod';
const Env = z.object({ VITE_API_BASE: z.string().url().default('https://api.centcom.dev'), VITE_RELAY_BASE: z.string().regex(/^wss?:\/\//, 'must start with ws:// or wss://').default('wss://relay.centcom.dev') });
export type ShellEnv = { apiBase: string; relayBase: string };
/** Reads and checks the two settings; a bad value falls back to the default and is reported, so the shell still starts. */
export function parseEnv(raw: Record<string, unknown>): { env: ShellEnv; problems: string[] } {
  const r = Env.safeParse({ VITE_API_BASE: raw.VITE_API_BASE || undefined, VITE_RELAY_BASE: raw.VITE_RELAY_BASE || undefined }); const problems: string[] = [];
  if (r.success) return { env: { apiBase: r.data.VITE_API_BASE.replace(/\/$/, ''), relayBase: r.data.VITE_RELAY_BASE.replace(/\/$/, '') }, problems };
  for (const i of r.error.issues) problems.push(`${String(i.path[0])}: ${i.message}`); const d = Env.parse({}); return { env: { apiBase: d.VITE_API_BASE, relayBase: d.VITE_RELAY_BASE }, problems };
}
