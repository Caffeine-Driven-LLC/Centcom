/** Provider detection (lane C104, minimal): is `claude` installed, which version, and how is it signed in? Never reads credential files. */
import { spawn } from 'node:child_process';
import type { LoginKind } from './types.js';

export interface ClaudeDetection {
  engine: 'claude-code'; installed: boolean; version?: string; signedIn: 'yes' | 'no' | 'unknown'; loginKind: LoginKind; authMethod?: string;
}

function run(bin: string, args: string[], timeoutMs = 8000): Promise<{ code: number | null; out: string; missing: boolean }> {
  return new Promise((resolve) => {
    let out = ''; let done = false;
    const finish = (r: { code: number | null; out: string; missing: boolean }) => { if (!done) { done = true; resolve(r); } };
    try {
      const c = spawn(bin, args, { stdio: ['ignore', 'pipe', 'pipe'] }); // some CLIs (codex login status) print to stderr
      const t = setTimeout(() => { c.kill('SIGKILL'); finish({ code: null, out, missing: false }); }, timeoutMs); t.unref();
      c.stdout.setEncoding('utf8'); c.stdout.on('data', (d: string) => { out += d; });
      c.stderr.setEncoding('utf8'); c.stderr.on('data', (d: string) => { out += d; });
      c.on('error', (e: NodeJS.ErrnoException) => { clearTimeout(t); finish({ code: null, out, missing: e.code === 'ENOENT' }); });
      c.on('close', (code) => { clearTimeout(t); finish({ code, out, missing: false }); });
    } catch { finish({ code: null, out, missing: true }); }
  });
}

/** claude auth status JSON `authMethod`: claude.ai/oauth_token = subscription, api_key(_helper) = api key, third_party = cloud. */
export function classifyAuthMethod(m: string | undefined): LoginKind {
  if (m === 'claude.ai' || m === 'oauth_token') return 'subscription';
  if (m === 'api_key' || m === 'api_key_helper') return 'api_key';
  if (m === 'third_party') return 'cloud';
  return 'unknown';
}

export async function detectClaude(bin = 'claude'): Promise<ClaudeDetection> {
  const v = await run(bin, ['--version']);
  if (v.missing || (v.code !== 0 && !v.out)) return { engine: 'claude-code', installed: false, signedIn: 'unknown', loginKind: 'unknown' };
  const version = /\d+\.\d+\.\d+/.exec(v.out)?.[0];
  const a = await run(bin, ['auth', 'status']);
  try {
    const j = JSON.parse(a.out) as { loggedIn?: boolean; authMethod?: string };
    const signed = j.loggedIn === true && j.authMethod !== 'none';
    return { engine: 'claude-code', installed: true, version, signedIn: signed ? 'yes' : 'no', loginKind: signed ? classifyAuthMethod(j.authMethod) : 'unknown', authMethod: j.authMethod };
  } catch { return { engine: 'claude-code', installed: true, version, signedIn: 'unknown', loginKind: 'unknown' }; }
}

export interface CodexStatus { engine: 'codex'; installed: boolean; version?: string; signedIn: 'yes' | 'no' | 'unknown'; loginKind: LoginKind }
/** `codex login status` exits 0 when signed in; its text says whether that is ChatGPT or an API key. We never read auth files. */
export async function detectCodex(bin = process.env.CENTCOM_CODEX_BIN || 'codex'): Promise<CodexStatus> {
  const v = await run(bin, ['--version']);
  if (v.missing || (v.code !== 0 && !v.out)) return { engine: 'codex', installed: false, signedIn: 'unknown', loginKind: 'unknown' };
  const version = /\d+\.\d+\.\d+/.exec(v.out)?.[0];
  const a = await run(bin, ['login', 'status']);
  if (a.code === 0) return { engine: 'codex', installed: true, version, signedIn: 'yes', loginKind: /chatgpt/i.test(a.out) ? 'subscription' : /api key/i.test(a.out) ? 'api_key' : 'unknown' };
  return { engine: 'codex', installed: true, version, signedIn: a.code === null ? 'unknown' : 'no', loginKind: 'unknown' };
}
