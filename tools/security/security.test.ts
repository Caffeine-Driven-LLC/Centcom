import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { redactString } from '../../packages/net/src/index.js';
import { checkAudit } from './audit.js';
import { scanDirsForMarkers } from './keystore.js';
import { checkLicences, expressionAllowed } from './licences.js';
import { checkLockfile, parseLock } from './lockfile.js';
import { checkInstallScripts, checkPinning } from './packages.js';
import { buildSbom, closure, purl, sbomProblems, validateSbom } from './sbom.js';
import { runChecks } from './run.js';
import { SYNTHETIC_MARKER, scanFiles, scanText } from './secrets.js';
import { applyWaivers, validateWaivers } from './waivers.js';
import { lintWorkflow } from './workflows.js';

const NOW = Date.UTC(2026, 9, 7, 12); const DAY = 86_400_000; const ymd = (t: number) => new Date(t).toISOString().slice(0, 10);
const PEM_LINE = ['-----BEGIN', 'PRIVATE KEY-----'].join(' '); const LIVE = 'cen_' + 'live_' + 'A1b2C3d4E5f6G7h8'; const TESTK = 'cen_' + 'test_' + 'Z9y8X7w6V5u4T3s2';
const JWT = ['eyJhbGciOiJIUzI1NiJ9', 'eyJzdWIiOiJ1c3JfMSJ9', 'c2lnbmF0dXJlLXRlc3Q'].join('.');
const tmp = () => mkdtempSync(join(tmpdir(), 'cc-sec-'));

describe('secret scan', () => {
  it('finds a planted Centcom live key, a JWT and a private key (3 of 3) and also a test key; a clean tree passes', () => {
    const root = tmp(); writeFileSync(join(root, 'a.ts'), `const k = '${LIVE}';\n`); writeFileSync(join(root, 'b.ts'), `const t = '${JWT}';\n`); writeFileSync(join(root, 'c.pem'), `${PEM_LINE}\nMIIE...\n`); writeFileSync(join(root, 'd.ts'), `x = '${TESTK}'\n`); writeFileSync(join(root, 'clean.ts'), 'export const a = 1; // cen_live_ is the prefix of live keys\n');
    const f = scanFiles(root, ['a.ts', 'b.ts', 'c.pem', 'd.ts', 'clean.ts']); expect(f.map((x) => x.location.split(':')[0]).sort()).toEqual(['a.ts', 'b.ts', 'c.pem', 'd.ts']); expect(f.every((x) => x.severity === 'high')).toBe(true);
    expect(f.find((x) => x.location.startsWith('a.ts'))!.message).toContain('live'); expect(scanFiles(root, ['clean.ts'])).toEqual([]);
  });
  it('a labelled synthetic value and an allowed path are skipped; findings never repeat the secret itself', () => {
    expect(scanText('x', `k = '${LIVE}' // ${SYNTHETIC_MARKER}`)).toEqual([]); const root = tmp(); writeFileSync(join(root, 'a.ts'), `${LIVE}\n`); expect(scanFiles(root, ['a.ts'], { allow: [{ path: 'a.ts', reason: 'test' }] })).toEqual([]);
    expect(JSON.stringify(scanText('x', `${LIVE} ${JWT} ${PEM_LINE}`))).not.toContain('A1b2C3d4'); expect(scanText('x', 'cen_live_short')).toEqual([]);
  });
  it('the real repository has no secret outside the listed test files', () => { const r = runChecks({ fast: true, now: new Date(NOW) }); expect(r.checks.find((c) => c.id === 'secrets')!.status).toBe('pass'); });
});

describe('install scripts and pinning', () => {
  const m = (json: Record<string, unknown>) => [{ path: 'packages/x/package.json', json }];
  it('install, preinstall and postinstall scripts fail; other scripts pass', () => { for (const k of ['install', 'preinstall', 'postinstall']) expect(checkInstallScripts(m({ scripts: { [k]: 'node x.js' } })).status).toBe('fail'); expect(checkInstallScripts(m({ scripts: { test: 'vitest', build: 'tsc' } })).status).toBe('pass'); expect(checkInstallScripts(m({})).status).toBe('pass'); });
  it('^, ~, latest, ranges and tags fail; exact versions, workspace links and aliases to exact versions pass', () => {
    for (const v of ['^1.2.3', '~1.2.3', 'latest', '*', '>=1.0.0', '1.x', 'next', 'github:a/b', '1.2']) expect(checkPinning(m({ dependencies: { a: v } })).status).toBe('fail');
    expect(checkPinning(m({ dependencies: { a: '1.2.3', b: 'workspace:*', c: '2.0.0-rc.1', d: 'npm:real@3.4.5' }, devDependencies: { e: '0.0.1' } })).status).toBe('pass'); expect(checkPinning(m({ devDependencies: { z: '^1.0.0' } })).findings[0]!.message).toContain('z@^1.0.0');
  });
});

describe('licences', () => {
  const policy = { allow: ['MIT', 'Apache-2.0', 'BSD-2-Clause', 'BSD-3-Clause', 'ISC'], exceptions: [{ package: 'argparse', licence: 'Python-2.0', reason: 'tooling' }] };
  it('the allow-list passes; a planted GPL-3.0 package, a missing licence and an unknown one fail closed; an exception covers only its own package', () => {
    const p = (name: string, licence?: string) => ({ name, version: '1.0.0', licence });
    expect(checkLicences([p('a', 'MIT'), p('b', 'Apache-2.0'), p('c', 'BSD-3-Clause'), p('d', 'ISC'), p('e', '(MIT OR CC0-1.0)'), p('f', '(MPL-2.0 OR Apache-2.0)')], policy).status).toBe('pass');
    for (const l of ['GPL-3.0', 'GPL-3.0-only', 'AGPL-3.0', 'SEE LICENSE IN LICENSE.md', 'MIT AND GPL-3.0', undefined]) expect(checkLicences([p('x', l)], policy).status).toBe('fail');
    expect(checkLicences([p('argparse', 'Python-2.0')], policy).status).toBe('pass'); expect(checkLicences([p('other', 'Python-2.0')], policy).status).toBe('fail');
    expect(expressionAllowed('(MIT OR GPL-3.0) AND ISC', new Set(policy.allow))).toBe(true); expect(expressionAllowed('MIT OR', new Set(policy.allow))).toBe(false); expect(expressionAllowed('((MIT', new Set(policy.allow))).toBe(false);
  });
  it('the real installed tree passes the policy', () => { const r = runChecks({ now: new Date(NOW), audit: () => ({ status: 0, stdout: '{"metadata":{}}', stderr: '' }) }); expect(r.checks.find((c) => c.id === 'licences')!.status).toBe('pass'); });
});

describe('lockfile and audit', () => {
  const lock = (pk: string) => parseLock(`---\nfoo: 1\n---\nlockfileVersion: '9.0'\nimporters:\n  .: {}\npackages:\n${pk}\nsnapshots: {}\n`);
  it('missing integrity, git and plain http resolutions fail; a normal one passes; the first YAML document is ignored', () => {
    expect(checkLockfile(lock("  a@1.0.0:\n    resolution: {integrity: sha512-AAAA}")).status).toBe('pass'); expect(checkLockfile(lock("  a@1.0.0:\n    resolution: {}")).status).toBe('fail'); expect(checkLockfile(lock("  a@1.0.0:\n    resolution: {tarball: 'http://x/a.tgz', integrity: sha512-AAAA}")).status).toBe('fail');
    expect(checkLockfile(lock("  a@1.0.0:\n    resolution: {type: git, repo: 'https://x/a.git', commit: abc}")).status).toBe('fail'); expect(checkLockfile(lock("  a@1.0.0:\n    resolution: {integrity: md5-zzz}")).status).toBe('fail'); expect(checkLockfile(lock('  {}')).status).toBe('fail');
  });
  it('audit: high findings fail, a clean answer passes, an unreachable service is retried three times and then fails as tool_unavailable', () => {
    const ok = () => ({ status: 0, stdout: JSON.stringify({ advisories: {}, metadata: {} }), stderr: '' }); expect(checkAudit(ok).status).toBe('pass');
    const bad = () => ({ status: 1, stdout: JSON.stringify({ advisories: { 1: { severity: 'high', module_name: 'evil', title: 'Prototype pollution' }, 2: { severity: 'low', module_name: 'meh', title: 'x' } }, metadata: {} }), stderr: '' }); const r = checkAudit(bad); expect(r.status).toBe('fail'); expect(r.findings).toHaveLength(1);
    let calls = 0; const down = () => { calls++; return { status: 1, stdout: '', stderr: 'getaddrinfo ENOTFOUND registry.npmjs.org' }; }; const d = checkAudit(down); expect(calls).toBe(3); expect(d.status).toBe('fail'); expect(d.findings[0]!.message).toContain('tool_unavailable');
    let n = 0; const flaky = () => (++n < 3 ? { status: 1, stdout: '', stderr: 'timeout' } : ok()); expect(checkAudit(flaky).status).toBe('pass'); expect(checkAudit(() => ({ status: null, stdout: '', stderr: '', error: new Error('spawn pnpm ENOENT') })).findings[0]!.message).toContain('tool_unavailable');
  });
});

describe('workflow lint', () => {
  const policy = { allowOwners: ['actions'], allowActions: [] }; const SHA = 'a'.repeat(40);
  const wf = (body: string, perms = 'permissions:\n  contents: read\n') => `name: x\non: push\n${perms}jobs:\n  a:\n    runs-on: ubuntu-latest\n    steps:\n${body}`;
  it('an action referenced by tag fails; by full SHA passes; a branch or short SHA fails', () => {
    expect(lintWorkflow('w.yml', wf('      - uses: actions/checkout@v4\n'), policy)[0]!.message).toContain('tag or branch'); expect(lintWorkflow('w.yml', wf(`      - uses: actions/checkout@${SHA} # v4\n`), policy)).toEqual([]); expect(lintWorkflow('w.yml', wf('      - uses: actions/checkout@main\n'), policy)).toHaveLength(1); expect(lintWorkflow('w.yml', wf('      - uses: actions/checkout@abc1234\n'), policy)).toHaveLength(1);
  });
  it('a workflow without permissions, a third-party action off the allow-list, pull_request_target with the PR checked out, and an echoed secret are all flagged', () => {
    expect(lintWorkflow('w.yml', wf(`      - uses: actions/checkout@${SHA}\n`, ''), policy)[0]!.message).toContain('permissions'); expect(lintWorkflow('w.yml', wf(`      - uses: evil/action@${SHA}\n`), policy)[0]!.message).toContain('allow-list'); expect(lintWorkflow('w.yml', wf(`      - uses: evil/action@${SHA}\n`), { allowOwners: ['actions'], allowActions: ['evil/action'] })).toEqual([]);
    const prt = wf(`      - uses: actions/checkout@${SHA}\n        with:\n          ref: \${{ github.event.pull_request.head.sha }}\n`).replace('on: push', 'on:\n  pull_request_target:'); expect(lintWorkflow('w.yml', prt, policy).some((f) => f.message.includes('pull_request_target'))).toBe(true);
    expect(lintWorkflow('w.yml', wf('      - run: echo ${{ secrets.TOKEN }}\n'), policy)[0]!.message).toContain('echoed'); expect(lintWorkflow('w.yml', wf('      - uses: ./local-action\n      - uses: docker://alpine:3\n'), policy)).toHaveLength(1);
  });
  it('the repository workflows pass the lint', () => { expect(runChecks({ fast: true, now: new Date(NOW) }).checks.find((c) => c.id === 'workflows')!.status).toBe('pass'); });
});

describe('waivers', () => {
  const w = (o: object) => ({ id: 'pinning', issue: 'https://github.com/o/r/issues/1', expires: ymd(NOW + 30 * DAY), ...o });
  it('needs an issue URL and an expiry within 90 days; an expired waiver is a failure; a live one marks the check waived', () => {
    expect(validateWaivers([w({})], NOW).valid).toHaveLength(1); expect(validateWaivers([w({ issue: 'ticket 4' })], NOW).problems).toHaveLength(1); expect(validateWaivers([w({ issue: undefined })], NOW).problems).toHaveLength(1); expect(validateWaivers([w({ expires: ymd(NOW + 91 * DAY) })], NOW).problems[0]).toMatch(/90 days/); expect(validateWaivers([w({ expires: ymd(NOW - 2 * DAY) })], NOW).problems[0]).toMatch(/expired/); expect(validateWaivers([w({ expires: 'later' })], NOW).problems).toHaveLength(1);
    const checks = [{ id: 'pinning', status: 'fail' as const, findings: [] }, { id: 'secrets', status: 'fail' as const, findings: [] }]; expect(applyWaivers(checks, validateWaivers([w({})], NOW).valid).map((c) => c.status)).toEqual(['waived', 'fail']);
  });
  it('an expired waiver in waivers.json fails the whole run', () => {
    const r = runChecks({ fast: true, now: new Date(NOW), waivers: [w({ expires: ymd(NOW - 5 * DAY) })] }); expect(r.checks.some((c) => c.id === 'waivers' && c.status === 'fail')).toBe(true); expect(r.checks.find((c) => c.id === 'pinning')!.status).toBe('fail');
    const ok = runChecks({ fast: true, now: new Date(NOW) }); expect(ok.checks.every((c) => c.status !== 'fail')).toBe(true); expect(ok.waivers.map((x) => x.id)).toContain('pinning');
  });
});

describe('SBOM', () => {
  const lock = parseLock(`---\nx: 1\n---\nlockfileVersion: '9.0'\nimporters:\n  apps/cli:\n    dependencies:\n      ink: {specifier: 1.0.0, version: 1.0.0}\n      '@centcom/net': {specifier: 'workspace:*', version: 'link:../../packages/net'}\n  packages/net:\n    dependencies:\n      '@scope/lib': {specifier: 2.0.0, version: 2.0.0(peer@1.0.0)}\npackages:\n  ink@1.0.0:\n    resolution: {integrity: sha512-${Buffer.alloc(64, 1).toString('base64')}}\n  '@scope/lib@2.0.0':\n    resolution: {integrity: sha512-${Buffer.alloc(64, 2).toString('base64')}}\n  dep@3.0.0:\n    resolution: {integrity: sha512-${Buffer.alloc(64, 3).toString('base64')}}\nsnapshots:\n  ink@1.0.0:\n    dependencies:\n      dep: 3.0.0\n  '@scope/lib@2.0.0(peer@1.0.0)':\n    dependencies:\n      dep: 3.0.0\n  dep@3.0.0: {}\n`);
  it('lists every production dependency reached through the importer and its workspace links, once, with purl and SHA-512 hash', () => {
    const c = closure(lock, 'apps/cli'); expect(c.map((x) => `${x.name}@${x.version}`)).toEqual(['@scope/lib@2.0.0', 'dep@3.0.0', 'ink@1.0.0']); expect(c[0]!.purl).toBe('pkg:npm/%40scope/lib@2.0.0'); expect(c[2]!.hashes![0]).toEqual({ alg: 'SHA-512', content: '01'.repeat(64) }); expect(purl('a', '1.0.0')).toBe('pkg:npm/a@1.0.0'); expect(() => closure(lock, 'nope')).toThrow();
  });
  it('validates against the CycloneDX 1.5 subset, names the exact Node version, and the checks catch what is missing', () => {
    const bom = buildSbom({ lock, importer: 'apps/cli', name: 'centcom-linux-x64', version: '0.1.0', nodeVersion: '22.23.3', artifactSha256: 'ab'.repeat(32), now: new Date(NOW) }) as { components: { name: string; version: string }[] }; expect(validateSbom(bom)).toEqual({ ok: true, errors: [] }); expect(bom.components[0]).toMatchObject({ name: 'node', version: '22.23.3' }); expect(sbomProblems(bom as never, '22.23.3')).toEqual([]);
    expect(sbomProblems(bom as never, '22.0.0')[0]).toContain('no node 22.0.0'); const noHash = { ...bom, components: [...bom.components.slice(0, 1), { type: 'library', name: 'x', version: '1', purl: 'pkg:npm/x@1' }] }; expect(sbomProblems(noHash as never, '22.23.3')[0]).toContain('hash');
    for (const bad of [{ ...bom, specVersion: '1.4' }, { ...bom, serialNumber: 'abc' }, { ...bom, components: [] }, { ...bom, bomFormat: 'SPDX' }, { ...bom, components: [{ type: 'weird', name: 'x' }] }, { ...bom, metadata: undefined }]) expect(validateSbom(bad).ok).toBe(false);
  });
  it('the real lockfile gives an SBOM for each of the five release artifacts', () => {
    const real = parseLock(require('node:fs').readFileSync(join(import.meta.dirname, '../../pnpm-lock.yaml'), 'utf8')); for (const a of ['linux-x64', 'linux-arm64', 'darwin-x64', 'darwin-arm64', 'win32-x64']) { const bom = buildSbom({ lock: real, importer: 'apps/cli', name: `centcom-${a}`, version: '0.1.0', nodeVersion: process.versions.node }); expect(validateSbom(bom).ok).toBe(true); expect(sbomProblems(bom as never, process.versions.node)).toEqual([]); expect((bom.components as unknown[]).length).toBeGreaterThan(20); }
  });
});

describe('keystore scan', () => {
  it('finds a marker in plain text and base64 in the config folders; a clean folder gives 0 matches', () => {
    const marker = 'REFRESH-TOKEN-MARKER-7f3a9c'; const clean = tmp(); mkdirSync(join(clean, 'sub')); writeFileSync(join(clean, 'sub', 'config.json'), '{"theme":"graphite"}'); expect(scanDirsForMarkers([clean, join(clean, 'missing')], [marker])).toEqual([]);
    const dirty = tmp(); writeFileSync(join(dirty, 'a.json'), `{"t":"${marker}"}`); writeFileSync(join(dirty, 'b.bin'), Buffer.from(`xx${marker}yy`).toString('base64')); const f = scanDirsForMarkers([dirty], [marker, 'short']); expect(f).toHaveLength(2); expect(JSON.stringify(f)).not.toContain(marker);
  });
});

describe('log redaction fuzz', () => {
  it('10 000 random strings seeded with token, key and path patterns leave no secret in the redacted output', () => {
    const secrets = [() => LIVE, () => TESTK, () => JWT, () => `${PEM_LINE}\nMIIEvQIBADANBgkqhkiG9w0BAQEFAASC\n-----END PRIVATE KEY-----`, () => 'Authorization: Bearer ' + 'abcDEF0123456789abcDEF0123456789', () => '/home/alex/secret-project/src/key.ts'];
    fc.assert(fc.property(fc.string({ maxLength: 40 }), fc.string({ maxLength: 40 }), fc.integer({ min: 0, max: secrets.length - 1 }), (a, b, i) => { const s = secrets[i]!(); const out = redactString(`${a} ${s} ${b}`, '/home/alex'); return !out.includes(s) && !/cen_(live|test)_[A-Za-z0-9]{8,}/.test(out) && !out.includes('MIIEvQIBADANBgkq') && !out.includes('abcDEF0123456789') && !out.includes('/home/alex'); }), { numRuns: 10_000, seed: 20261007 });
  }, 60_000);
});
