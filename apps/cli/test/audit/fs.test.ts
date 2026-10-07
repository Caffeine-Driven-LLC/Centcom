import { mkdtempSync, readFileSync, statSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { nodeAuditFs } from '../../src/commands/audit/index.js';

describe('the real file writer', () => {
  it('creates the file with mode 0600, writes chunks, and abort removes it', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'cc-audit-')); const p = join(dir, 'a.csv'); expect(await nodeAuditFs.exists(p)).toBe(false);
    const w = await nodeAuditFs.createWriter(p, 0o600); await w.write(new TextEncoder().encode('a,')); await w.write(new TextEncoder().encode('b\n')); await w.close(); expect(readFileSync(p, 'utf8')).toBe('a,b\n'); expect(statSync(p).mode & 0o777).toBe(0o600); expect(await nodeAuditFs.exists(p)).toBe(true);
    const q = join(dir, 'b.csv'); const x = await nodeAuditFs.createWriter(q, 0o600); await x.write(new TextEncoder().encode('partial')); await x.abort(); expect(existsSync(q)).toBe(false);
  });
});
