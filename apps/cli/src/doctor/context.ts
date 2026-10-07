/** The real world for `centcom doctor`: the process, the network, the OS keychain, git and the file system. */
import { execFile } from 'node:child_process';
import { existsSync, readFileSync, statSync } from 'node:fs';
import { arch, homedir, platform } from 'node:os';
import { osKeychain } from '@centcom/net';
import { detectColorTier } from '@centcom/theme';
import type { DoctorContext, Reply } from './types.js';

export function realDoctorContext(o: { version: string; contract: string; apiBase: string; stateDir: string }): DoctorContext {
  const env = process.env; const tier = detectColorTier({ env, isTTY: !!process.stdout.isTTY });
  return {
    ...o, env, platform: platform(), arch: arch(), node: process.version, home: homedir(),
    term: { tier, unicode: /utf-?8/i.test(env.LC_ALL || env.LC_CTYPE || env.LANG || '') && env.TERM !== 'linux', cols: process.stdout.columns ?? 80, rows: process.stdout.rows ?? 24, isTTY: !!process.stdout.isTTY },
    now: () => Date.now(),
    async get(url, { timeoutMs }): Promise<Reply> { const ac = new AbortController(); const t = setTimeout(() => ac.abort(), timeoutMs); try { const r = await fetch(url, { signal: ac.signal, headers: { 'user-agent': `centcom/${o.version} doctor` } }); const headers: Record<string, string> = {}; r.headers.forEach((v, k) => { headers[k] = v; }); let json: unknown; try { json = await r.json(); } catch { /* not JSON */ } return { status: r.status, headers, json }; } finally { clearTimeout(t); } },
    keychain: osKeychain('dev.centcom.doctor'),
    git: () => new Promise((res) => { execFile('git', ['--version'], { timeout: 3000 }, (e, out) => res(e ? undefined : out.trim())); }),
    readFile: (p) => { try { return { text: readFileSync(p, 'utf8'), mode: statSync(p).mode & 0o777 }; } catch { return undefined; } },
    exists: existsSync,
  };
}
