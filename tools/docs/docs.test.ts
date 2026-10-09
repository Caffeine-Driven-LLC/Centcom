import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { COMMANDS, helpFor, renderHelp, renderTopic, topHelp } from '../../apps/cli/src/help/index.js';
import { ENV_VARS, RELAY_NEVER, RELAY_VISIBLE, TRAFFIC_NOTE } from '../../apps/cli/src/help/topics.js';
import { all, anchorsOf, envProblems, flagProblems, linkProblems, privacyProblems, slug } from './check.js';
import { check, generated, manPage, referencePage, version } from './gen-cli-reference.js';

const ROOT = fileURLToPath(new URL('../../', import.meta.url)); 

describe('drift checks', () => {
  it('the repository passes its own check', () => { expect(all()).toEqual([]); expect(check()).toEqual([]); });
  it('a flag that exists in the command list but not in the top-level help is caught', () => {
    const help = topHelp('0.0.0'); expect(flagProblems(help)).toEqual([]); expect(flagProblems(help.replace('--theme', '--skin')).map((p) => p.what)).toContain('the top-level help does not mention --theme');
    expect(flagProblems(help.replace('centcom keys', 'centcom kyes')).map((p) => p.what)).toContain('the top-level help does not list the "keys" command');
  });
  it('a flag added to the command list shows up as an out-of-date reference page', () => { const c = { ...COMMANDS[0]!, flags: [...COMMANDS[0]!.flags, { flag: '--fake-flag', description: 'x' }] }; expect(referencePage(c)).toContain('--fake-flag'); expect(readFileSync(join(ROOT, 'docs/site/reference/cli/centcom.md'), 'utf8')).not.toContain('--fake-flag'); });
  it('internal links: a missing file and a missing heading are found, good ones pass', () => {
    const pages: Record<string, string> = { '/r/a.md': '# A\n\n## Two words\n\n[ok](./b.md) [ok2](./b.md#second-part) [self](#two-words) [web](https://example.com) [bad](./nope.md) [badanchor](./b.md#missing)', '/r/b.md': '# B\n\n## Second part\n' };
    const p = linkProblems(['/r/a.md'], (f) => pages[f]); expect(p.map((x) => x.what)).toEqual(['link to ./nope.md goes nowhere', 'link to ./b.md#missing: no heading "missing"']); expect(slug('`centcom` Doctor: it\'s!')).toBe('centcom-doctor-its'); expect([...anchorsOf('# A b\n### `C`')]).toEqual(['a-b', 'c']);
  });
  it('environment variables: a documented one that the code lacks, and one in the code that is not documented, are both reported', () => {
    expect(envProblems('| `NO_COLOR` |', 'process.env.NO_COLOR').map((p) => p.what)).toEqual([]); expect(envProblems('| `NO_COLOR` | `CENTO_THEME` |', 'NO_COLOR').map((p) => p.what)).toEqual(['CENTO_THEME is documented but does not exist in the code']); expect(envProblems('', 'DO_NOT_TRACK').map((p) => p.what)).toEqual(['DO_NOT_TRACK exists in the code but is not documented']);
    const live = readFileSync(join(ROOT, 'docs/site/reference/env.md'), 'utf8'); for (const v of ['NO_COLOR', 'DO_NOT_TRACK', 'CENTCOM_TELEMETRY', 'CENTCOM_CONFIG_DIR', 'CENTCOM_API_URL']) expect(live).toContain(`\`${v}\``); expect(ENV_VARS.length).toBeGreaterThan(8);
  });
});

describe('privacy page', () => {
  it('states exactly the "visible to the relay" items of the crypto contract, and that traffic analysis is not hidden', () => {
    const page = readFileSync(join(ROOT, 'docs/site/guide/privacy-relay.md'), 'utf8'); expect(privacyProblems(page)).toEqual([]); const crypto = readFileSync(join(ROOT, 'contracts/05-crypto.md'), 'utf8').split('## 6.')[1]!.split('## 7.')[0]!;
    for (const needle of ['Frame header fields', 'Queue/approval metadata', '`path_hmac`', 'Member public keys', 'Message text, code, diffs, file paths, branch names, commands', 'Session keys, device private keys', 'Plaintext paths', 'Anything inside `ct`']) expect(crypto).toContain(needle);
    expect(RELAY_VISIBLE).toHaveLength(4); expect(RELAY_NEVER).toHaveLength(4); expect(page).toContain(TRAFFIC_NOTE); expect(TRAFFIC_NOTE).toMatch(/not hidden in v1/); expect(readFileSync(join(ROOT, 'docs/site/guide/privacy.md'), 'utf8')).toContain('privacy-relay.md');
  });
});

describe('help text', () => {
  it('renderHelp is at most 80 columns and has no escape codes without colour; colour adds only bold', () => {
    for (const c of COMMANDS) { const t = renderHelp(c, { width: 200, colour: false }); expect(t).not.toMatch(/\u001b/); for (const l of t.split('\n')) expect(l.length, `${c.name}: ${l}`).toBeLessThanOrEqual(80); expect(t).toContain(c.usage); for (const f of c.flags) expect(t).toContain(f.flag); expect(renderHelp(c, { width: 50, colour: false }).split('\n').every((l) => l.length <= 80)).toBe(true); }
    expect(renderHelp(COMMANDS[1]!, { width: 80, colour: true })).toMatch(/\u001b\[1m/);
  });
  it('help with no topic lists every command and topic; an unknown topic is exit 2; topics render', () => {
    const idx = helpFor(undefined, { width: 80, colour: false }); expect(idx.code).toBe(0); for (const c of COMMANDS.filter((x) => x.name !== 'centcom')) expect(idx.text).toContain(c.name); expect(idx.text).toContain('privacy'); expect(helpFor('nope', { width: 80, colour: false }).code).toBe(2);
    expect(renderTopic('privacy', { width: 80, colour: false })).toContain(TRAFFIC_NOTE); expect(renderTopic('exit-codes', { width: 80, colour: false })).toContain('130'); expect(renderTopic('env', { width: 80, colour: false })).toContain('NO_COLOR'); expect(renderTopic('x', { width: 80, colour: false })).toBeUndefined();
  });
  it('the real command line: --help is at most 80 columns with no escape codes under NO_COLOR and lists every command; help and <command> --help work', () => {
    const run = (...a: string[]) => execFileSync(process.execPath, ['--import', 'tsx', join(ROOT, 'apps/cli/src/main.tsx'), ...a], { cwd: ROOT, env: { ...process.env, NO_COLOR: '1' }, encoding: 'utf8' });
    const h = run('--help'); expect(h).not.toMatch(/\u001b/); expect(h.split('\n').filter((l) => l.length > 80)).toEqual([]); for (const c of COMMANDS.filter((x) => x.name !== 'centcom')) expect(h).toContain(`centcom ${c.name}`);
    expect(run('help')).toContain('Commands'); expect(run('init', '--help')).toContain('--dry-run'); expect(run('help', 'privacy')).toContain('not hidden in v1'); expect(() => run('help', 'nope')).toThrow();
  }, 60_000);
});

describe('man pages', () => {
  it('each page has the version and contract in its header, the right sections, and escaped dashes', () => {
    const files = Object.entries(generated()).filter(([p]) => p.endsWith('.1')); expect(files.length).toBe(COMMANDS.length);
    for (const [p, t] of files) { expect(t, p).toMatch(/^\.TH [A-Z-]+ 1 "" "centcom \d+\.\d+\.\d+ \(contract \d+\.\d+\.\d+\)" "Centcom"$/m); expect(t).toContain(version()); for (const s of ['.SH NAME', '.SH SYNOPSIS', '.SH DESCRIPTION', '.SH SEE ALSO']) expect(t, p).toContain(s); expect(t.split('\n').filter((l) => !l.startsWith('.') && /(^|\s)-[a-z-]/.test(l))).toEqual([]); }
    expect(manPage({ name: 'x', summary: 'a - b', usage: 'x', description: '.dot at line start', flags: [] }, '1.0.0', '1.2.0')).toContain('\\&.dot');
  });
});

describe('the releases page', () => {
  it('is the page that docs/releases.json produces (run pnpm docs:gen)', async () => { const m = await import('./releases-page.js'); expect(m.pageIsCurrent()).toBe(true); });
  it('lists the newest release first, the latest per channel, and refuses a bad list', async () => {
    const { renderReleases, releaseProblems } = await import('./releases-page.js');
    const page = renderReleases([{ version: '1.2.0', channel: 'stable', date: '2026-10-01', notes: ['Faster start.'] }, { version: '1.10.0', channel: 'stable', date: '2026-11-01', notes: ['Undo in the prompt.'], url: 'https://example.com/n' }, { version: '1.3.0-beta.1', channel: 'beta', date: '2026-11-05', notes: ['Try this.'] }]);
    expect(page.indexOf('### 1.10.0')).toBeLessThan(page.indexOf('### 1.2.0')); expect(page).toContain('| stable | **1.10.0** | 2026-11-01 |'); expect(page).toContain('| beta | **1.3.0-beta.1** | 2026-11-05 |'); expect(page).toContain('| nightly | none yet | – |'); expect(page).toContain('[Release notes](https://example.com/n)'); expect(page).toContain('1.3.0-beta.1 · 2026-11-05 · beta');
    expect(releaseProblems([{ version: 'x', channel: 'gamma', date: 'soon', notes: [] }, { version: '1.0.0', channel: 'stable', date: '2026-01-01', notes: ['a'] }, { version: '1.0.0', channel: 'stable', date: '2026-01-01', notes: ['a'] }, { version: '1.0.1', channel: 'stable', date: '2026-01-01', notes: ['a'], url: 'http://insecure' }].map((x) => x as never)).length).toBeGreaterThanOrEqual(6);
    expect(() => renderReleases([{ version: 'x' } as never])).toThrow(/docs\/releases\.json/);
  });
});
