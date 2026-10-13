/** `pnpm gate <G1..G6> [--backend mock|<base url>] [--out gate-report-<G>.json]`: exit 0 only if the gate passed.
 *  Built now: G1 (device-flow login, GET /v1/me). G2 to G5 need the relay, queue, billing and branch-mode session lanes and are reported as `not_built` (a failure,
 *  never a pass). G6 runs G1 to G5 and passes only if all of them do. */
import { writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { startMockBackend } from '../../packages/testkit/src/mock-backend/index.js';
import { runSteps, type GateReport } from './gate.js';
import { g1Steps, type G1Context } from './g1.js';

export const GATES = ['G1', 'G2', 'G3', 'G4', 'G5', 'G6'] as const; export type GateId = (typeof GATES)[number];
const NEEDS: Record<string, string> = { G2: 'the relay handshake, heartbeat and resume lanes', G3: 'the host and guest session, queue and approval lanes (two headless clients)', G4: 'checkout, entitlement and quota lanes', G5: 'branch mode, locks, presence, notifications and webhooks together' };
const UA = 'centcom-cli/0.0.0-gate (contract/1.0.0; linux-x64; node/22.0.0)';

export async function runGate(gate: GateId, o: { backend: string; announce?: (c: string, u: string) => void }): Promise<GateReport> {
  if (gate === 'G6') {
    const t0 = Date.now(); const parts: GateReport[] = []; for (const g of GATES.slice(0, 5)) parts.push(await runGate(g, o));
    return { gate, passed: parts.every((p) => p.passed), steps: parts.map((p) => ({ id: p.gate, status: p.passed ? 'pass' as const : 'fail' as const, duration_ms: Date.parse(p.ended_at) - Date.parse(p.started_at), ...(p.passed ? {} : { evidence: p.steps.find((s) => s.status === 'fail')?.evidence ?? 'failed' }) })), started_at: new Date(t0).toISOString(), ended_at: new Date().toISOString() };
  }
  if (gate !== 'G1') return runSteps(gate, {}, [{ id: 'built', async run() { throw Object.assign(new Error(NEEDS[gate]), { code: 'not_built' }); } }]);
  const mock = o.backend === 'mock' ? await startMockBackend({ clock: 'real', seed: 1 }) : undefined;
  try {
    const ctx: G1Context = { baseUrl: mock ? mock.url : o.backend, userAgent: UA, interactive: !mock, ...(o.announce ? { announce: o.announce } : {}) };
    return await runSteps(gate, ctx, g1Steps());
  } finally { await mock?.stop(); }
}
export async function main(argv: string[], log: (l: string) => void = console.log): Promise<number> {
  const { values, positionals } = parseArgs({ args: argv, allowPositionals: true, options: { backend: { type: 'string' }, out: { type: 'string' } } });
  const gate = (positionals[0] ?? '').toUpperCase() as GateId; if (!GATES.includes(gate)) { log(`usage: pnpm gate <${GATES.join('|')}> [--backend mock|<base url>] [--out file]`); return 2; }
  const backend = values.backend ?? 'mock'; if (backend !== 'mock' && !/^https?:\/\//.test(backend)) { log('--backend must be mock or an http(s) base URL'); return 2; }
  const r = await runGate(gate, { backend, announce: (code, uri) => log(`Open ${uri} and approve the code ${code}`) });
  for (const s of r.steps) log(`${s.status === 'pass' ? 'ok  ' : s.status === 'skipped' ? 'skip' : 'FAIL'} ${s.id}${s.evidence ? ` (${s.evidence})` : ''} ${s.duration_ms} ms`);
  log(r.passed ? `Gate ${gate}: passed` : `Gate ${gate}: NOT passed`); writeFileSync(values.out ?? `gate-report-${gate}.json`, JSON.stringify(r, null, 2) + '\n'); return r.passed ? 0 : 1;
}
if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) process.exit(await main(process.argv.slice(2)));
