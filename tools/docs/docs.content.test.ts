import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { COMMANDS } from '../../apps/cli/src/help/index.js';
import { KEYS } from '../../packages/config/src/index.ts';
import { envProblems, orphanProblems } from './check.js';
import { check, generated } from './gen-cli-reference.js';
import { loadList, spellProblems } from './spell.js';

const ROOT = fileURLToPath(new URL('../../', import.meta.url));
const read = (f: string) => readFileSync(join(ROOT, 'docs/site', f), 'utf8');

describe('fake flag drift (lane C096)', () => {
  it('a flag added to the command list makes the generated-files check fail, and removing it makes it pass again', () => {
    expect(check()).toEqual([]);
    const c = COMMANDS[0]!;
    c.flags.push({ flag: '--fake-flag', description: 'x' });
    try { const bad = check(); expect(bad).toContain('docs/site/reference/cli/centcom.md'); expect(bad).toContain('docs/man/centcom.1'); } finally { c.flags.pop(); }
    expect(check()).toEqual([]);
  });
  it('a documented environment variable that the code lacks is reported', () => {
    expect(envProblems('| `NO_COLOR` |', '').map((p) => p.what)).toContain('NO_COLOR is documented but does not exist in the code');
  });
});

describe('man pages, structure and lint', () => {
  const pages = () => Object.entries(generated()).filter(([p]) => p.endsWith('.1'));
  it('each page is balanced roff and every command has one', () => {
    for (const [p, t] of pages()) {
      const lines = t.split('\n');
      expect(lines.filter((l) => l === '.nf').length, p).toBe(lines.filter((l) => l === '.fi').length);
      lines.forEach((l, i) => { if (l === '.TP') expect(lines[i + 1], p).toMatch(/^\.B /); });
      expect(t.match(/\\(?![\\&"-])/g) ?? [], p).toEqual([]);
      expect(lines.find((l) => l.startsWith('.SH ')), p).toBe('.SH NAME');
    }
    expect(pages().map(([p]) => p).sort()).toEqual(COMMANDS.map((c) => `docs/man/${c.name === 'centcom' ? 'centcom' : `centcom-${c.name}`}.1`).sort());
  });
  it.skipIf(spawnSync('mandoc', ['-V']).error !== undefined)('mandoc -Tlint reports nothing (runs where mandoc is installed)', () => {
    for (const [p] of pages()) { const r = spawnSync('mandoc', ['-Tlint', join(ROOT, p)], { encoding: 'utf8' }); expect(r.stdout + r.stderr, p).toBe(''); }
  });
});

describe('spell check and claims', () => {
  it('finds a known misspelling in prose but not in code, and rejects claims the contracts do not make', () => {
    const list = loadList('teh->the\n# c\nenviroment->environment\n');
    expect(spellProblems({ a: 'This is teh page.\n\n```sh\nteh\n```\n\n`enviroment` and [x](./teh.md)' }, list).map((p) => p.what)).toEqual(['"teh" is a misspelling of "the"']);
    expect(spellProblems({ a: 'It is zero-knowledge and 100% secure. Key cen_live_abcdefghijklmnop1234.' }, list).length).toBe(3); // centcom-synthetic-secret (a made-up key for the claims check)
    expect(spellProblems({ a: 'Use cen_live_… as a placeholder and ses_01JA… too.' }, list)).toEqual([]);
    expect(() => loadList('nonsense')).toThrow(/bad line/);
  });
  it('a guide page missing from the sidebar is found', () => {
    const sidebar = read('.vitepress/config.ts');
    expect(orphanProblems([join(ROOT, 'docs/site/guide/install.md')], sidebar)).toEqual([]);
    expect(orphanProblems([join(ROOT, 'docs/site/guide/lost-page.md')], sidebar).map((p) => p.what)).toEqual(['is not in the sidebar of docs/site/.vitepress/config.ts']);
  });
});

describe('the configuration reference', () => {
  it('lists every key of the schema, and both copies are what the schema produces', () => {
    const page = read('reference/config.md');
    for (const k of KEYS) expect(page, k).toContain(`| \`${k}\` |`);
    expect(KEYS.length).toBeGreaterThan(10);
    expect(generated()['docs/site/reference/config.md']).toBe(page);
    expect(readFileSync(join(ROOT, 'docs/configuration.md'), 'utf8')).toBe(generated()['docs/configuration.md']);
  });
});

describe('the guide covers what lane C096 asks for', () => {
  it('has the pages, and says what is planned instead of promising it', () => {
    for (const f of ['guide/install.md', 'guide/getting-started.md', 'guide/command-post.md', 'guide/cross-computer.md', 'guide/teams.md', 'guide/billing.md', 'guide/security.md', 'guide/privacy.md', 'guide/troubleshooting.md', 'reference/config.md', 'reference/env.md', 'reference/cli/index.md']) expect(existsSync(join(ROOT, 'docs/site', f)), f).toBe(true);
    expect(read('guide/install.md')).toMatch(/## Planned/);
    expect(read('guide/security.md')).toContain('Traffic analysis is not hidden in v1');
    expect(read('guide/cross-computer.md')).toMatch(/## Not built yet/);
  });
  it('the plan table matches the reference plans of the billing contract', () => {
    const contract = readFileSync(join(ROOT, 'contracts/07-billing-entitlements.md'), 'utf8'); const page = read('guide/billing.md');
    const pairs: [string, string][] = [['| `max_session_members` | 8 (LAN) | 4 | 12 |', '| People in a session | 8 (LAN) | 4 | 12 |'], ['| `max_parallel_agents` | 4 | 8 | 16 |', '| Parallel agents | 4 | 8 | 16 |'], ['| `max_seats` | 1 | 1 | 5 (+ add-on seats) |', '| Seats | 1 | 1 | 5, with add-on seats |'], ['| `webhooks_max` | 0 | 2 | 20 |', '| Webhooks | 0 | 2 | 20 |'], ['| `history_days` | 0 | 7 | 30 |', '| Session history | none | 7 days | 30 days |']];
    for (const [c, p] of pairs) { expect(contract).toContain(c); expect(page).toContain(p); }
  });
});
