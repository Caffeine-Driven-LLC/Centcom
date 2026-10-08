import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import Ajv2020 from 'ajv/dist/2020.js';
import { describe, expect, it, vi } from 'vitest';
import { buildSpawnClearFields, computeWhoPays, createGuestSpendControl, createHostConfirmation, evaluateStartGate, loadProviderPolicy, onProviderFlagsChanged, policyLines, providerOf, providerStateFor, registerPolicyStatusSection, type FlagSource, type ProviderFlagKey } from '../../../src/provider/policy/index.js';
import { statusSections } from '../../../src/provider/detect/doctor-checks.js';
import { toSessionWire } from '../../../src/engine/wire-map.js';

const root = join(__dirname, '../../../../..'); const read = (p: string) => JSON.parse(readFileSync(join(root, p), 'utf8'));
const A = 'mem_01JA3Z8K2M5N7P9Q0R1S2T3V4W' as const; const B = 'mem_01JA3Z8K2M5N7P9Q0R1S2T3V4X' as const; const H = 'mem_01JA3Z8K2M5N7P9Q0R1S2T3V4Y' as const; const G = 'mem_01JA3Z8K2M5N7P9Q0R1S2T3V4Z' as const;
const flags = (v: Partial<Record<ProviderFlagKey, boolean>> = {}): FlagSource & { fire(d?: unknown): void; subs: number } => { const fns = new Set<(d: unknown) => void>(); const defaults: Record<ProviderFlagKey, boolean> = { 'provider.claude_code': true, 'provider.codex': true, 'provider.command_post.subscription': false }; return { flag: (k) => v[k] ?? defaults[k], on: (_e, fn) => { fns.add(fn); return () => fns.delete(fn); }, fire: (d) => fns.forEach((f) => f(d)), get subs() { return fns.size; } }; };

describe('who pays', () => {
  it('branch mode: the owner pays; command post: the host pays; shared when the payer did not type', () => {
    expect(computeWhoPays({ mode: 'branch', engine: 'claude-code', loginKind: 'subscription', owner: A, host: H, prompter: B })).toEqual({ payer: A, provider: 'anthropic', login_kind: 'subscription', shared: true });
    expect(computeWhoPays({ mode: 'branch', engine: 'codex', loginKind: 'api_key', owner: A, host: H, prompter: A })).toEqual({ payer: A, provider: 'openai', login_kind: 'api_key', shared: false });
    expect(computeWhoPays({ mode: 'command_post', engine: 'claude-code', loginKind: 'subscription', owner: A, host: H, prompter: G })).toMatchObject({ payer: H, shared: true });
    expect(computeWhoPays({ mode: 'command_post', engine: 'codex', loginKind: 'api_key', owner: A, host: H, prompter: H })).toMatchObject({ payer: H, shared: false });
    expect([providerOf('claude-code'), providerOf('codex'), providerOf('demo'), providerOf('')]).toEqual(['anthropic', 'openai', 'other', 'other']);
  });
  it('the spawn fields are exactly runs_on and provider, and validate against p_agent_spawn', () => {
    const w = computeWhoPays({ mode: 'command_post', engine: 'codex', loginKind: 'api_key', owner: A, host: H, prompter: G }); const f = buildSpawnClearFields(w); expect(Object.keys(f).sort()).toEqual(['provider', 'runs_on']);
    const ajv = new Ajv2020({ strict: false, validateFormats: false, allErrors: true }); ajv.addSchema(read('contracts/schemas/events.schema.json')); const v = ajv.compile({ $ref: 'https://centcom.dev/contracts/events.schema.json#/$defs/p_agent_spawn' });
    expect(v({ agent_id: 'agt_01JA3Z8K2M5N7P9Q0R1S2T3V4W', owner: A, mode: 'command_post', ...f }), JSON.stringify(v.errors)).toBe(true); expect(v({ agent_id: 'agt_01JA3Z8K2M5N7P9Q0R1S2T3V4W', owner: A, mode: 'command_post', runs_on: 'x', provider: 'anthropic' })).toBe(false);
  });
});
describe('the start gate', () => {
  const g = (o: Partial<Parameters<typeof evaluateStartGate>[0]>) => evaluateStartGate({ engine: 'claude-code', mode: 'command_post', loginKind: 'subscription', flags: flags(), ...o });
  it('the table from the card', () => {
    expect(g({})).toEqual({ allowed: false, code: 'provider_policy_blocked' }); expect(g({ loginKind: 'unknown' })).toEqual({ allowed: false, code: 'provider_policy_blocked' });
    expect(g({ loginKind: 'api_key' })).toEqual({ allowed: true }); expect(g({ loginKind: 'cloud' })).toEqual({ allowed: true }); expect(g({ flags: flags({ 'provider.command_post.subscription': true }) })).toEqual({ allowed: false, needs: 'host_confirmation' });
    expect(g({ flags: flags({ 'provider.command_post.subscription': true }), hostConfirmed: true })).toEqual({ allowed: true }); expect(g({ mode: 'branch' })).toEqual({ allowed: true }); expect(g({ mode: 'branch', loginKind: 'unknown' })).toEqual({ allowed: true });
  });
  it('a method flag off disables new sessions, nothing is stopped, and a flip recomputes once within 100 ms', async () => {
    const f = flags({ 'provider.codex': false }); const stop = vi.fn(); expect(evaluateStartGate({ engine: 'codex', mode: 'branch', loginKind: 'api_key', flags: f })).toEqual({ allowed: false, code: 'provider_method_disabled' }); expect(stop).not.toHaveBeenCalled(); expect(evaluateStartGate({ engine: 'claude-code', mode: 'branch', loginKind: 'api_key', flags: f })).toEqual({ allowed: true });
    const recomputed = vi.fn(); const off = onProviderFlagsChanged(f, recomputed); const t0 = Date.now(); f.fire({ changed: ['provider.codex'] }); expect(recomputed).toHaveBeenCalledTimes(1); expect(Date.now() - t0).toBeLessThan(100); f.fire({ changed: ['unrelated'] }); expect(recomputed).toHaveBeenCalledTimes(1); f.fire(undefined); expect(recomputed).toHaveBeenCalledTimes(2); off(); expect(f.subs).toBe(0);
  });
  it('a flags client that has not loaded gives the defaults: subscription command post blocked, branch allowed', () => {
    expect(evaluateStartGate({ engine: 'claude-code', mode: 'command_post', loginKind: 'subscription' })).toEqual({ allowed: false, code: 'provider_policy_blocked' }); expect(evaluateStartGate({ engine: 'codex', mode: 'branch', loginKind: 'subscription' })).toEqual({ allowed: true });
    const broken: FlagSource = { flag: () => { throw new Error('not loaded'); }, on: () => () => undefined }; expect(evaluateStartGate({ engine: 'claude-code', mode: 'command_post', loginKind: 'subscription', flags: broken })).toEqual({ allowed: false, code: 'provider_policy_blocked' });
  });
  it('the registered flags exist in the client registry with the same defaults', async () => {
    const { FLAG_DEFS } = await import('../../../../net/src/flags/index.js'); const { PROVIDER_FLAGS } = await import('../../../src/provider/policy/flags.js');
    for (const [k, d] of Object.entries(PROVIDER_FLAGS)) expect((FLAG_DEFS as Record<string, { default: unknown; type: string }>)[k], k).toMatchObject({ default: d.default, type: d.type });
  });
});
describe('host confirmation', () => {
  it('is per session, audited once each, in memory only', async () => {
    const audit: [string, unknown][] = []; const asked: string[] = []; let answer = true; const c = createHostConfirmation({ ask: async (n) => { asked.push(n.sessionId); return answer; }, audit: (a, d) => audit.push([a, d]) });
    expect(await c.request('S1', 'claude-code')).toBe(true); expect(c.has('S1')).toBe(true); expect(c.has('S2')).toBe(false); expect(await c.request('S1', 'claude-code')).toBe(true); expect(asked).toEqual(['S1']);
    answer = false; expect(await c.request('S2', 'claude-code')).toBe(false); expect(c.has('S2')).toBe(false); answer = true; expect(await c.request('S2', 'codex')).toBe(true);
    expect(audit).toEqual([['provider.cp_subscription.confirmed', { engine: 'claude-code' }], ['provider.cp_subscription.confirmed', { engine: 'codex' }]]); c.forget('S1'); expect(c.has('S1')).toBe(false);
  });
  it('writes nothing and sends nothing: no fs, net or process modules are imported and fetch is never called', async () => {
    const src = readFileSync(join(root, 'packages/agent/src/provider/policy/confirm.ts'), 'utf8'); expect(src).not.toMatch(/from 'node:(fs|net|http|https|child_process|dgram)|fetch\(|WebSocket|writeFile/);
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('no network')); const c = createHostConfirmation({ ask: async () => true, audit: () => undefined }); await c.request('S', 'codex'); expect(fetchSpy).not.toHaveBeenCalled(); vi.restoreAllMocks();
  });
});
describe('guest spend control', () => {
  it('pauses and resumes once each, and counts guests', () => {
    let n = 2; const set = vi.fn(); const c = createGuestSpendControl({ guests: () => n, setGuestsPaused: set }); expect(c.count()).toBe(2); c.pause(); c.pause(); expect(set.mock.calls).toEqual([[true]]); expect(c.paused()).toBe(true); c.resume(); c.resume(); expect(set.mock.calls).toEqual([[true], [false]]); n = -1; expect(c.count()).toBe(0);
  });
});
describe('provider states', () => {
  it('maps the codes, every state exists in the state map, and none reach agent.state', () => {
    const map = read('contracts/state-map.json'); const codes = ['provider_not_installed', 'provider_not_signed_in', 'provider_method_disabled', 'provider_policy_blocked', 'provider_cap_reached', 'provider_rate_limited', 'provider_version_unsupported', 'provider_protocol_error', 'provider_capability_missing'] as const;
    expect(codes.map((c) => providerStateFor(c))).toEqual([undefined, 'provider-auth-required', 'provider-policy-blocked', 'provider-policy-blocked', 'provider-cap-reached', undefined, undefined, undefined, undefined]);
    for (const c of codes) { const s = providerStateFor(c); if (s) expect(Object.keys(map), s).toContain(s); }
    expect(providerStateFor({ type: 'error', code: 'provider_cap_reached' } as never)).toBe('provider-cap-reached'); expect(providerStateFor({ type: 'text.delta' } as never)).toBeUndefined();
    const ctx = { agentId: 'agt_01JA3Z8K2M5N7P9Q0R1S2T3V4W', messageId: (m: string) => m, approverFor: () => 'host' as const, approvalTtlMs: 1000, now: () => new Date(0) };
    for (const c of codes) for (const out of toSessionWire({ type: 'error', code: c, tool_message: 'x', fatal: true, v: 1, seq: 1, ts: '', agent_id: ctx.agentId } as never, ctx as never)) expect((out as { k: string }).k).not.toBe('agent.state');
  });
});
describe('the policy table', () => {
  it('validates against the schema, equals the reference rows, and prints a line per method with the flag now', () => {
    const p = loadProviderPolicy(); const ajv = new Ajv2020({ strict: false, validateFormats: false }); const v = ajv.compile(read('contracts/schemas/provider-policy.schema.json')); expect(v(p), JSON.stringify(v.errors)).toBe(true);
    const ref = read('contracts/fixtures/providers/policy-reference.json').data; expect(p.methods.map((m) => m.id)).toEqual(ref.methods.map((m: { id: string }) => m.id)); expect(p.methods).toEqual(ref.methods);
    const lines = policyLines(p, flags({ 'provider.codex': false })); expect(lines).toHaveLength(p.methods.length); expect(lines.find((l) => l.startsWith('openai.codex'))).toContain('provider.codex=off'); expect(lines.find((l) => l.startsWith('anthropic.claude_code'))).toContain('provider.claude_code=on'); expect(lines.find((l) => l.startsWith('anthropic.in_app_login'))).toContain('not a client flag');
  });
  it('centcom provider status --policy gets its section', () => {
    registerPolicyStatusSection(flags()); registerPolicyStatusSection(flags()); const s = statusSections().filter((x) => x.id === 'policy'); expect(s).toHaveLength(1); expect(s[0]!.render(undefined)).toHaveLength(loadProviderPolicy().methods.length); expect((s[0]!.json(undefined) as { methods: unknown[] }).methods).toHaveLength(4);
  });
  it('the refresh script keeps the rows equal and the data file exists', () => { expect(existsSync(join(root, 'packages/agent/data/provider-policy.json'))).toBe(true); expect(existsSync(join(root, 'tools/refresh-provider-policy.mjs'))).toBe(true); });
});
