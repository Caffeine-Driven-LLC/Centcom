import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { allowConsole, loadFixtures } from '../../packages/testkit/src/index.js';
import { conformance } from './run.js';
import { SUITES } from './suites.js';

describe('consumed contracts (the client only reads them)', () => {
  it('CT-API-RELEASES, CT-ENTITLEMENTS and CT-NOTIF-PAYLOAD run in the default run, and the releases suite checks both manifest spellings, versions, a good file, a changed byte, a foreign key and an empty trust list', async () => {
    const lines: string[] = []; const out = join(mkdtempSync(join(tmpdir(), 'cc-conf-')), 'r.json'); allowConsole();
    expect(await conformance(['--out', out], new Date(Date.UTC(2026, 9, 13)), (l) => lines.push(l))).toBe(0);
    for (const id of ['CT-API-RELEASES', 'CT-ENTITLEMENTS', 'CT-NOTIF-PAYLOAD']) expect(lines.some((l) => l.startsWith('pass') && l.includes(id)), id).toBe(true);
    const dir = join(__dirname, '../../contracts'); const suite = SUITES.find((s) => s.contract === 'CT-API-RELEASES')!; const r = await suite.run({ fixtures: loadFixtures(dir), contractsDir: dir }); const names = r.cases.map((c) => c.name);
    for (const n of ['JSON-schema spelling', 'REST (OpenAPI) spelling', 'versions:', 'verify: a good file verifies', 'verify: one changed byte', 'verify: a signature from another key', 'verify: no trusted key']) expect(names.some((x) => x.includes(n)), n).toBe(true);
    expect(r.cases.filter((c) => !c.ok)).toEqual([]);
  });
  it('--contract limits the run to the named consumed contract', async () => {
    const lines: string[] = []; allowConsole(); expect(await conformance(['--contract', 'CT-API-RELEASES'], new Date(Date.UTC(2026, 9, 13)), (l) => lines.push(l))).toBe(0); expect(lines.filter((l) => /^(pass|fail|waived|skipped)/.test(l))).toHaveLength(1);
  });
});
