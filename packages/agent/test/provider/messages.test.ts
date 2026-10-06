import { describe, expect, it } from 'vitest';
import { ALL_PROVIDER_CODES, providerMessage, type EngineId } from '../../src/index.js';

const OSES: NodeJS.Platform[] = ['linux', 'darwin', 'win32']; const ENGINES: EngineId[] = ['claude-code', 'codex'];
describe('providerMessage', () => {
  it('has all 9 codes', () => { expect(ALL_PROVIDER_CODES).toHaveLength(9); });
  it.each(ALL_PROVIDER_CODES.flatMap((c) => OSES.flatMap((o) => ENGINES.map((e) => [c, o, e] as const))))('%s on %s for %s: title, body and a concrete next step', (code, os, engine) => {
    const m = providerMessage(code, { os, engine }); expect(m.title.length).toBeGreaterThan(5); expect(m.body.length).toBeGreaterThan(10); expect(m.next_step.length).toBeGreaterThan(10); expect(m.next_step).toMatch(/`[^`]+`|Wait|Try|Ask|Pick|Update/);
    expect(JSON.stringify(m)).not.toMatch(/Centcom (Claude|Codex|ChatGPT|Anthropic|OpenAI)/); expect(['info', 'warn', 'error']).toContain(m.severity);
  });
  it('local states and the next steps the card names', () => {
    expect(providerMessage('provider_not_signed_in', { engine: 'codex' })).toMatchObject({ state: 'provider-auth-required' }); expect(providerMessage('provider_not_signed_in', { engine: 'codex' }).next_step).toContain('centcom provider login codex'); expect(providerMessage('provider_not_signed_in', { engine: 'claude-code' }).next_step).toContain('centcom provider login claude');
    expect(providerMessage('provider_cap_reached').state).toBe('provider-cap-reached'); expect(providerMessage('provider_method_disabled').state).toBe('provider-policy-blocked'); expect(providerMessage('provider_policy_blocked').state).toBe('provider-policy-blocked'); expect(providerMessage('provider_rate_limited').state).toBeUndefined();
    expect(providerMessage('provider_method_disabled').next_step).toBe('Try the other provider, or run `centcom provider status` to see what is available.');
  });
  it('the install hint depends on the OS', () => { expect(providerMessage('provider_not_installed', { engine: 'codex', os: 'darwin' }).next_step).toContain('brew install codex'); expect(providerMessage('provider_not_installed', { engine: 'codex', os: 'linux' }).next_step).not.toContain('brew'); expect(providerMessage('provider_not_installed', { engine: 'claude-code', os: 'win32' }).next_step).toContain('PowerShell'); });
  it('the tool\'s own words appear in a quoted block, redacted and cut at 2 KiB; no paths or secrets', () => {
    const m = providerMessage('provider_protocol_error', { tool_message: 'bad key sk-ant-api03-AAAAAAAAAAAAAAAAAAAAAAAA\n' + 'x'.repeat(5000) }); expect(m.body).toContain('> bad key [redacted:anthropic_api_key]'); expect(m.body).not.toContain('sk-ant'); expect(m.body.length).toBeLessThan(2048 + 400);
  });
  it('brand check: no feature of Centcom is styled with a vendor name anywhere in the module', async () => {
    const { readFileSync } = await import('node:fs'); const { fileURLToPath } = await import('node:url'); const src = readFileSync(fileURLToPath(new URL('../../src/provider/messages.ts', import.meta.url)), 'utf8'); expect(src).not.toMatch(/Centcom (Claude|Codex|ChatGPT|Anthropic|OpenAI)/);
  });
});
