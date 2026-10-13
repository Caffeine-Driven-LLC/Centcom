/** The service's feature flags in the terminal app (lane C067). Only user-visible switches: today the two kill switches for the agents
 *  (`provider.claude_code`, `provider.codex`). Reading a flag never waits for the network: the answer is what was fetched last time
 *  (kept in the state folder), else the default, which is "on". Nothing here decides anything about permissions, the sandbox or crypto. */
import { join } from 'node:path';
import { FlagsClient, createHttpClient, defaultUserAgent, type FlagsChange } from '@centcom/net';
import { defaultDeps, stateDir } from '@centcom/config';
import { engineFlag } from '@centcom/agent';
import type { EngineName } from './engine-pick.js';

export interface RemoteFlags { client: FlagsClient; /** true when the service has switched this agent off */ blocked(engine: EngineName): boolean; stop(): void }

export function startRemoteFlags(o: { baseUrl: string; version: string; env?: Record<string, string | undefined>; dir?: string; fetch?: typeof fetch }): RemoteFlags {
  const clock = { now: () => Date.now(), setTimeout: (f: () => void, ms: number) => { const h = setTimeout(f, ms); h.unref?.(); return h; }, clearTimeout: (h: never) => clearTimeout(h as unknown as NodeJS.Timeout) };
  const http = createHttpClient({ baseUrl: o.baseUrl, getAccessToken: async () => undefined, userAgent: defaultUserAgent(o.version), ...(o.fetch ? { fetch: o.fetch } : {}) });
  const env = o.env ?? process.env; const client = new FlagsClient({ http, cacheDir: o.dir ?? join(stateDir(defaultDeps())), clock, config: { get: () => undefined }, env, isDevBuild: env.CENTCOM_DEV === '1' });
  client.start();
  return { client, stop: () => client.stop(), blocked: (engine) => { const k = engineFlag(engine); return k ? client.flag(k) === false : false; } };
}
/** What to say when the flags change while the app runs: only for the agent in use, and only when it was switched off. Running work is never stopped. */
export function watchEngineFlag(flags: RemoteFlags, engine: string, say: (text: string) => void): () => void {
  let was = engine === 'claude-code' || engine === 'codex' ? flags.blocked(engine) : false;
  return flags.client.on('flags-changed', (_d: FlagsChange) => { if (engine !== 'claude-code' && engine !== 'codex') return; const now = flags.blocked(engine); if (now && !was) say(`${engine === 'codex' ? 'Codex' : 'Claude Code'} has been switched off by Centcom for now. What is running goes on; new sessions will use the other agent.`); was = now; });
}
