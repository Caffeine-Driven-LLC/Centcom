import { chmod, mkdtemp, mkdir, writeFile, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { makeWhich, runProbe } from '../../src/index.js';

describe('the real process boundary', () => {
  it('runs without a shell: shell characters in arguments are plain text', async () => { const r = await runProbe(process.execPath, ['-e', 'console.log(process.argv[1])', '$(echo pwned); `x`'], { timeoutMs: 5000, maxBytes: 65536 }); expect(r.out.trim()).toBe('$(echo pwned); `x`'); expect(r.code).toBe(0); });
  it('a probe that hangs is killed at its timeout', async () => { const t = Date.now(); const r = await runProbe(process.execPath, ['-e', 'setInterval(()=>{},1000)'], { timeoutMs: 300, maxBytes: 65536 }); expect(r.timedOut).toBe(true); expect(Date.now() - t).toBeLessThan(3000); });
  it('output over the limit is killed, and only the first 4 KiB is kept', async () => { const r = await runProbe(process.execPath, ['-e', 'process.stdout.write("y".repeat(500000)); setInterval(()=>{},1000)'], { timeoutMs: 5000, maxBytes: 64 * 1024 }); expect(r.tooLong).toBe(true); expect(r.out.length).toBeLessThanOrEqual(4096); });
  it('a command that does not exist is reported as missing, not thrown', async () => { const r = await runProbe('/nonexistent/centcom-tool', [], { timeoutMs: 2000, maxBytes: 1024 }); expect(r.missing).toBe(true); });
  it('stderr is read too (codex prints some status there)', async () => { const r = await runProbe(process.execPath, ['-e', 'console.error("Logged in using ChatGPT")'], { timeoutMs: 5000, maxBytes: 65536 }); expect(r.out).toContain('ChatGPT'); });
  it('which: finds an executable in an absolute PATH directory, skips relative entries, directories and missing ones', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'bin-')); await writeFile(join(dir, 'fake-tool'), '#!/bin/sh\n'); await chmod(join(dir, 'fake-tool'), 0o755); await mkdir(join(dir, 'a-directory'));
    const which = makeWhich({ PATH: ['relative/dir', '/definitely/missing', dir].join(':') }, 'linux'); expect(which('fake-tool')).toBe(join(dir, 'fake-tool')); expect(which('a-directory')).toBeUndefined(); expect(which('nope')).toBeUndefined(); expect(makeWhich({ PATH: 'bin' }, 'linux')('fake-tool')).toBeUndefined();
  });
  it('no source file of the provider module or the CLI commands touches a vendor credential or config location', async () => {
    const { readdirSync } = await import('node:fs'); const roots = ['../../src/provider/', '../../../../apps/cli/src/commands/provider/']; const bad = /(^|[\s'"`/~])\.(claude|codex)\b|auth\.json|keychain|Keychain|credentials\.json|CLAUDE_API_KEY|ANTHROPIC_API_KEY|OPENAI_API_KEY/; const hits: string[] = [];
    const walk = (d: string): string[] => readdirSync(d, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(join(d, e.name)) : e.name.endsWith('.ts') ? [join(d, e.name)] : []));
    for (const r of roots) for (const f of walk(fileURLToPath(new URL(r, import.meta.url)))) { const t = await readFile(f, 'utf8'); t.split('\n').forEach((l, i) => { if (bad.test(l)) hits.push(`${f}:${i + 1}`); }); } expect(hits).toEqual([]);
  });
});
