import { VirtualClock } from '@centcom/testkit';
import { newIdGenerator } from '@centcom/protocol';
import { createTelemetry, type Env, type HttpPost, type StateFs, type TelemetryDeps } from '../../src/index.js';

export function stateFs(init: Record<string, string> = {}, o: { failWrites?: boolean } = {}) {
  const m = new Map(Object.entries(init)); const log = { reads: 0, writes: 0, removes: 0 };
  const fs: StateFs = { read: async (p) => { log.reads++; return m.get(p); }, write: async (p, t) => { log.writes++; if (o.failWrites) throw new Error('EACCES'); m.set(p, t); }, remove: async (p) => { log.removes++; m.delete(p); } };
  return { fs, m, log };
}
export interface Req { url: string; headers: Record<string, string>; body: string; at: number; json: { install_id: string; app?: unknown; events: { type: string; at: string; props?: Record<string, unknown> }[] } }
export function rig(o: { enabled?: boolean; env?: Env; status?: number | 'throw' | 'hang'; fs?: ReturnType<typeof stateFs>; commands?: ReadonlySet<string>; features?: ReadonlySet<string>; mono?: () => number; log?: TelemetryDeps['log'] } = {}) {
  const clock = new VirtualClock(); const reqs: Req[] = []; const fsx = o.fs ?? stateFs(); const ids = newIdGenerator({ now: () => clock.now(), random: (n) => { const b = new Uint8Array(n); for (let i = 0; i < n; i++) b[i] = (ids_seed = (ids_seed * 1103515245 + 12345) & 0x7fffffff) & 255; return b; } });
  const state = { status: o.status ?? 204 as number | 'throw' | 'hang', enabled: o.enabled ?? true };
  const http: HttpPost = (url, init) => { reqs.push({ url, headers: init.headers, body: init.body, at: clock.now(), json: JSON.parse(init.body) }); if (state.status === 'throw') return Promise.reject(new Error('network down')); if (state.status === 'hang') return new Promise(() => undefined); return Promise.resolve({ status: state.status as number }); };
  const env: Env = o.env ?? {}; const clk = { now: () => clock.now(), monotonic: o.mono ?? (() => clock.now()), setTimeout: (f: () => void, ms: number) => clock.setTimeout(f, ms), clearTimeout: (h: never) => clock.clearTimeout(h) };
  const t = createTelemetry({ config: () => ({ enabled: state.enabled }), env, clock: clk, fs: fsx.fs, http, ulid: () => ids.next('key').slice(4), ua: 'centcom-cli/1.0.0 (contract/1.2.0; linux-x64; node/22)', baseUrl: 'https://api.test', installIdPath: '/state/telemetry/install_id', app: { name: 'centcom-cli', version: '1.0.0', os: 'linux', arch: 'x64', contract: '1.2.0' }, commands: o.commands, features: o.features, log: o.log });
  return { t, clock, reqs, fs: fsx, state, env };
}
let ids_seed = 7;
export const emitAll = (t: ReturnType<typeof rig>['t']) => { t.appStart(); t.appExit(); t.commandRun('login'); t.sessionCreated('branch', 'relay'); t.sessionJoined('lan'); t.agentStateChange('idle', 'thinking'); t.featureUsed('web.open'); t.errorShown('not_found'); t.perfStartup(120); t.perfFrame(8.4); t.updateResult('1.0.0', '1.1.0', true); };
export const tick = () => new Promise<void>((r) => setImmediate(r));
