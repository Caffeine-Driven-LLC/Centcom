import { describe, expect, it } from 'vitest';
import { detectProvider, effectiveKind, rangePosition, satisfies } from '../../src/index.js';
import { CLAUDE_OK, CODEX_OK, res, rig } from './helpers.js';

describe('semver', () => {
  it.each([['2.1.0', '>=2.0.0 <3.0.0', true], ['2.0.0', '>=2.0.0 <3.0.0', true], ['3.0.0', '>=2.0.0 <3.0.0', false], ['1.9.0', '>=2.0.0 <3.0.0', false], ['0.55.0', '>=0.40.0 <1.0.0', true], ['junk', '>=1.0.0', false], ['1.0.0', 'nonsense', false], ['1.2.3', '=1.2.3', true]])('%s in %s is %s', (v, r, ok) => { expect(satisfies(v, r)).toBe(ok); });
  it('positions: below, above, unknown', () => { expect(rangePosition('1.9.0', '>=2.0.0 <3.0.0')).toBe('below'); expect(rangePosition('3.1.0', '>=2.0.0 <3.0.0')).toBe('above'); expect(rangePosition(undefined, '>=2.0.0')).toBe('unknown'); expect(rangePosition('2.1.0', '>=2.0.0 <3.0.0')).toBe('yes'); });
});

describe('detectProvider', () => {
  it('an in-range Claude Code: installed, supported, signed in with a subscription', async () => {
    const { deps } = rig(CLAUDE_OK); const s = await detectProvider('claude-code', deps); expect(s).toMatchObject({ installed: true, version: '2.1.0', supported: 'yes', signed_in: 'yes', login_kind: 'subscription', effective_kind: 'subscription', provider: 'anthropic', supported_range: '>=2.0.0 <3.0.0', errors: [], auth_command: true }); expect(s.checked_at).toMatch(/Z$/);
  });
  it('1.9.0 is below the supported range and says so', async () => { const { deps } = rig({ ...CLAUDE_OK, '--version': res('1.9.0\n') }); const s = await detectProvider('claude-code', deps); expect(s.supported).toBe('below'); expect(s.errors).toContain('provider_version_unsupported'); });
  it('Codex: ChatGPT login is a subscription, an API key line is api_key, a stale login is not signed in', async () => {
    expect(await detectProvider('codex', rig(CODEX_OK).deps)).toMatchObject({ installed: true, version: '0.55.0', supported: 'yes', signed_in: 'yes', login_kind: 'subscription', provider: 'openai' });
    expect(await detectProvider('codex', rig({ ...CODEX_OK, 'login status': res('Logged in using an API key - sk-proj-AAAAAAAAAAAAAAAAAAAAAAAAAAAA\n') }).deps)).toMatchObject({ signed_in: 'yes', login_kind: 'api_key', effective_kind: 'api_key' });
    expect(await detectProvider('codex', rig({ ...CODEX_OK, 'login status': res('Not logged in\n', 1) }).deps)).toMatchObject({ signed_in: 'no', errors: ['provider_not_signed_in'] });
  });
  it.each([[{ authMethod: 'claude.ai' }, 0, 'yes', 'subscription'], [{ authMethod: 'oauth_token' }, 0, 'yes', 'subscription'], [{ authMethod: 'api_key' }, 0, 'yes', 'api_key'], [{ authMethod: 'api_key_helper' }, 0, 'yes', 'api_key'], [{ authMethod: 'third_party' }, 0, 'yes', 'cloud'], [{ authMethod: 'none' }, 1, 'no', 'unknown']] as const)('claude auth status %j exit %s -> signed_in %s, %s', async (json, code, signed, kind) => {
    const s = await detectProvider('claude-code', rig({ ...CLAUDE_OK, 'auth status': res(JSON.stringify(json), code) }).deps); expect(s.signed_in).toBe(signed); expect(s.login_kind).toBe(kind);
  });
  it('a non-JSON claude reply is unknown and treated as a subscription', async () => { const s = await detectProvider('claude-code', rig({ ...CLAUDE_OK, 'auth status': res('Hello?') }).deps); expect(s).toMatchObject({ signed_in: 'unknown', login_kind: 'unknown', effective_kind: 'subscription' }); expect(effectiveKind('unknown')).toBe('subscription'); });
  it('a Claude Code without the auth subcommand: signed_in is unknown and only --version and auth --help were asked', async () => {
    const r = rig({ '--version': res('2.0.1\n'), 'auth --help': res('', 1) }); const s = await detectProvider('claude-code', r.deps); expect(s).toMatchObject({ signed_in: 'unknown', auth_command: false }); expect(r.calls).not.toContain('auth status');
  });
  it('a missing tool is installed:false with no errors, and nothing else is run', async () => { const r = rig(CLAUDE_OK, { installed: [] }); const s = await detectProvider('claude-code', r.deps); expect(s).toMatchObject({ installed: false, supported: 'unknown', errors: [] }); expect(r.calls).toEqual([]); });
  it('a probe that hangs (killed at 5 s) leaves the rest intact and reports provider_protocol_error', async () => {
    const s = await detectProvider('codex', rig({ ...CODEX_OK, '--version': res('', null, { timedOut: true }) }).deps); expect(s).toMatchObject({ installed: true, supported: 'unknown', signed_in: 'yes', errors: expect.arrayContaining(['provider_protocol_error']) }); expect(s.version).toBeUndefined();
  });
  it('an over-long probe output is an error and its text is dropped', async () => { const s = await detectProvider('codex', rig({ ...CODEX_OK, 'login status': res('x'.repeat(10), null, { tooLong: true }) }).deps); expect(s.signed_in).toBe('unknown'); expect(s.errors).toContain('provider_protocol_error'); });
  it('if every probe hangs forever the whole detection still ends at 15 s', async () => {
    const never = () => new Promise<never>(() => undefined); const r = rig({ '--version': never, 'auth --help': never }); let done = false; const p = detectProvider('claude-code', r.deps).then((x) => { done = true; return x; });
    await r.clock.advance(14_999); expect(done).toBe(false); await r.clock.advance(2); const s = await p; expect(s.errors).toContain('provider_protocol_error'); expect(s.installed).toBe(true);
  });
  it('the binary override variables are used', async () => { const r = rig(CODEX_OK, { installed: ['/opt/my-codex'], env: { CENTCOM_CODEX_BIN: '/opt/my-codex' } }); r.deps.which = (n) => (n === '/opt/my-codex' ? n : undefined); const s = await detectProvider('codex', { ...r.deps, env: { CENTCOM_CODEX_BIN: '/opt/my-codex' } }); expect(s.installed).toBe(true); expect(s.path).toBe('/opt/my-codex'); });
  it('garbage version text gives supported unknown, not a crash', async () => { const s = await detectProvider('codex', rig({ ...CODEX_OK, '--version': res('???') }).deps); expect(s.supported).toBe('unknown'); });
  it('an engine that cannot be detected is rejected with provider_capability_missing', async () => { await expect(detectProvider('fake', rig({}).deps)).rejects.toMatchObject({ code: 'provider_capability_missing' }); });
});

describe('cache', () => {
  it('two detectAll calls within 30 s run each probe once; --refresh and 30 s later run them again', async () => {
    const r = rig({ ...CLAUDE_OK, ...CODEX_OK }); await r.detector.detectAll(); const n = r.calls.length; await r.detector.detectAll(); expect(r.calls.length).toBe(n); await r.clock.advance(29_000); await r.detector.detectAll(); expect(r.calls.length).toBe(n);
    await r.detector.detectAll({ refresh: true }); expect(r.calls.length).toBe(n * 2); await r.clock.advance(31_000); await r.detector.detectAll(); expect(r.calls.length).toBe(n * 3);
  });
});
