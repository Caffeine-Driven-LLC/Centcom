import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { SECRET_PATTERNS } from '@centcom/protocol';
import { detectProvider, leakIds, redactProviderText } from '../../src/index.js';
import { CODEX_OK, res, rig } from './helpers.js';

const FX = JSON.parse(readFileSync(fileURLToPath(new URL('../../../../contracts/fixtures/providers/secret-patterns.json', import.meta.url)), 'utf8')) as { patterns: { id: string; regex: string }[]; must_match: string[]; must_not_match: string[] };
describe('redactProviderText', () => {
  it('the bundled patterns equal the contract file (same ids, same regexes; the generator only sorts them)', () => { const by = (l: readonly { id: string; regex: string }[]) => Object.fromEntries(l.map((p) => [p.id, p.regex])); expect(by(SECRET_PATTERNS)).toEqual(by(FX.patterns)); });
  it('every must_match string is redacted and no must_not_match string is touched', () => { for (const s of FX.must_match) { const r = redactProviderText(`login: ${s} end`); expect(r, s).toContain('[redacted:'); expect(r, s).not.toContain(s); } for (const s of FX.must_not_match) expect(redactProviderText(s), s).toBe(s); });
  it('names the pattern, never the secret', () => { expect(redactProviderText('key sk-ant-api03-AAAAAAAAAAAAAAAAAAAAAAAA')).toBe('key [redacted:anthropic_api_key]'); expect(leakIds('AKIAABCDEFGHIJKLMNOP')).toEqual(['aws_access_key']); });
  it('a login line with a full API key never reaches the status JSON, the call log or messages', async () => {
    const key = 'sk-proj-' + 'A'.repeat(40); const r = rig({ ...CODEX_OK, 'login status': res(`Logged in using an API key - ${key}\n`) }); const s = await detectProvider('codex', r.deps);
    const text = JSON.stringify(s) + r.calls.join('\n'); expect(text).not.toContain(key); expect(leakIds(text)).toEqual([]); expect(s.login_kind).toBe('api_key');
  });
});
