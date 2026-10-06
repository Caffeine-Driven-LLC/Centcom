import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { rig } from './rig.js';

const fx = JSON.parse(readFileSync(new URL('../../../../contracts/fixtures/providers/secret-patterns.json', import.meta.url), 'utf8')) as { must_match: string[]; must_not_match: string[] };
describe('session logs never hold secrets', () => {
  it('the named examples become [redacted:<id>]', async () => {
    const { store } = rig(); const h = store.sync.create({ cwd: '/w' });
    h.note('tool.result', { summary: 'key sk-ant-api03-AAAAAAAAAAAAAAAAAAAAAAAA and {"refresh_token":"abcdefghijklmnopqrstuvwxyz"}', env: { SECRET: 'x' } }); await h.close();
    const text = readFileSync(join(store.dir, h.id, 'log.jsonl'), 'utf8'); expect(text).toContain('[redacted:anthropic_api_key]'); expect(text).toContain('[redacted:codex_auth_json]'); expect(text).not.toContain('SECRET');
  });
  it('every must_match string is gone from every file of the session; every must_not_match string is kept', async () => {
    const { store } = rig(); const h = store.sync.create({ cwd: '/w' }); for (const s of [...fx.must_match, ...fx.must_not_match]) h.note('tool.result', { summary: `before ${s} after` }); h.saveView({ note: 'view' }); await h.close();
    const all = readdirSync(join(store.dir, h.id)).map((f) => readFileSync(join(store.dir, h.id, f), 'utf8')).join('\n') + readFileSync(join(store.dir, 'index.json'), 'utf8');
    for (const s of fx.must_match) expect(all, s).not.toContain(s); const logged = store.sync.open(h.id).records.map((r) => (r.data as { summary?: string }).summary ?? '').join('\n'); for (const s of fx.must_not_match) expect(logged, s).toContain(s);
  });
});
