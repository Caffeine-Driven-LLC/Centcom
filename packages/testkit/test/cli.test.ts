import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const bin = fileURLToPath(new URL('../bin/mock-backend.ts', import.meta.url));
const run = (args: string[]) => spawn(process.execPath, ['--import', 'tsx', bin, ...args], { cwd: fileURLToPath(new URL('..', import.meta.url)), stdio: ['ignore', 'pipe', 'pipe'] });

describe('centcom-mock-backend CLI', () => {
  it('--port 0 prints one JSON line with the real port, serves requests, and stops on SIGTERM', { timeout: 30_000 }, async () => {
    const child = run(['--port', '0', '--seed', '3', '--scenario', 'flaky-start']); let out = ''; child.stdout!.on('data', (d) => { out += d; });
    const line = await new Promise<string>((res, rej) => { const t = setTimeout(() => rej(new Error('no ready line: ' + out)), 20_000); child.stdout!.on('data', () => { if (out.includes('\n')) { clearTimeout(t); res(out.split('\n')[0]!); } }); });
    const info = JSON.parse(line); expect(info.port).toBeGreaterThan(0); expect(info.url).toBe(`http://127.0.0.1:${info.port}`); expect(info.seed).toBe(3); expect(out.trim().split('\n')).toHaveLength(1);
    expect((await fetch(info.url + '/healthz')).status).toBe(503); // the scenario made the first two calls fail
    expect((await fetch(info.url + '/healthz')).status).toBe(503); expect((await fetch(info.url + '/healthz')).status).toBe(200);
    const exit = new Promise<number | null>((r) => child.on('exit', (c) => r(c))); child.kill('SIGTERM'); const code = await exit; if (process.platform === 'win32') expect([0, null]).toContain(code); else expect(code).toBe(0); // Windows has no SIGTERM handler: the exit code is null
  });
  it('--help explains itself and exits 0', async () => {
    const child = run(['--help']); let out = ''; child.stdout!.on('data', (d) => { out += d; }); const code = await new Promise((r) => child.on('exit', r)); expect(code).toBe(0); expect(out).toContain('--port');
  });
});
