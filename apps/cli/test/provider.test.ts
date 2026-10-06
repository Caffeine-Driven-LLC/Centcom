import { EventEmitter } from 'node:events';
import { describe, expect, it } from 'vitest';
import { registerStatusSection } from '@centcom/agent';
import { runProvider, type ProviderIO } from '../src/commands/provider/index.js';
import { CLAUDE_OK, CODEX_OK, res, rig } from '../../../packages/agent/test/provider/helpers.js';

function io(table: Parameters<typeof rig>[0], o: Partial<ProviderIO> & { installed?: string[]; exit?: number | null } = {}) {
  const r = rig(table, { installed: o.installed }); const out: string[] = []; const err: string[] = []; const spawned: { file: string; args: string[]; o: unknown }[] = [];
  const spawn = (file: string, args: string[], so: unknown) => { spawned.push({ file, args, o: so }); const e = new EventEmitter(); setImmediate(() => e.emit('close', o.exit ?? 0, null)); return e as never; };
  const base: ProviderIO = { detector: r.detector, spawn, isTTY: true, out: (l) => out.push(l), err: (l) => err.push(l), now: () => Date.parse('2026-10-06T00:00:00Z'), os: 'linux', policyCheckedAt: '2026-09-01T00:00:00Z', ...o };
  return { r, out, err, spawned, io: base };
}
const BOTH = { ...CLAUDE_OK, ...CODEX_OK };

describe('centcom provider status', () => {
  it('one short line per engine, in the shape the card shows, exit 0 when all is well', async () => {
    const t = io(BOTH); expect(await runProvider(['status'], t.io)).toBe(0); expect(t.out).toEqual(['claude-code  installed 2.1.0 (supported)  signed in (subscription)', 'codex  installed 0.55.0 (supported)  signed in (subscription)']);
  });
  it('--json prints schema_version 1 and the providers; a below-range version exits 1 with a next step', async () => {
    const t = io({ ...BOTH, 'claude:--version': res('1.9.0') }); expect(await runProvider(['status', '--json'], t.io)).toBe(1); const j = JSON.parse(t.out.join('\n')); expect(j.schema_version).toBe(1); expect(j.providers).toHaveLength(2); expect(j.providers[0]).toMatchObject({ engine: 'claude-code', installed: true, version: '1.9.0', supported: 'below', effective_kind: 'subscription' }); expect(j.policy).toBeUndefined();
    const h = io({ ...BOTH, 'claude:--version': res('1.9.0') }); await runProvider(['status'], h.io); expect(h.out.join('\n')).toContain('Supported versions: >=2.0.0 <3.0.0');
  });
  it('a named engine that is missing exits 2; an unnamed missing one is only a warning (1)', async () => {
    const t = io(BOTH, { installed: ['claude'] }); expect(await runProvider(['status', 'codex'], t.io)).toBe(2); expect(t.out[0]).toBe('codex  not installed'); const u = io(BOTH, { installed: ['claude'] }); expect(await runProvider(['status'], u.io)).toBe(1);
  });
  it('not signed in is a warning with the login command', async () => { const t = io({ ...CODEX_OK, 'codex:login status': res('Not logged in', 1) }, { installed: ['codex'] }); expect(await runProvider(['status', 'codex'], t.io)).toBe(1); expect(t.out.join('\n')).toContain('centcom provider login codex'); });
  it('--refresh asks the tools again; without it a second call within 30 s does not', async () => { const t = io(BOTH); await runProvider(['status'], t.io); const n = t.r.calls.length; await runProvider(['status'], t.io); expect(t.r.calls.length).toBe(n); await runProvider(['status', '--refresh'], t.io); expect(t.r.calls.length).toBe(n * 2); });
  it('--policy prints sections registered by other lanes, and puts them in the JSON', async () => {
    registerStatusSection({ id: 'who-pays', render: () => ['subscription: you pay'], json: () => ({ ok: true }) }); const t = io(BOTH); await runProvider(['status', '--policy'], t.io); expect(t.out.join('\n')).toContain('who-pays:'); expect(t.out.join('\n')).toContain('  subscription: you pay');
    const j = io(BOTH); await runProvider(['status', '--json', '--policy'], j.io); expect(JSON.parse(j.out.join('\n')).policy['who-pays']).toEqual({ ok: true });
  });
  it('a login line with a full API key never reaches the output', async () => { const key = 'sk-proj-' + 'A'.repeat(40); const t = io({ ...CODEX_OK, 'codex:login status': res(`Logged in using an API key - ${key}`) }, { installed: ['codex'] }); await runProvider(['status', '--json'], t.io); await runProvider(['status'], t.io); expect(t.out.join('\n') + t.err.join('\n')).not.toContain(key); });
  it('an unknown provider name and an unknown subcommand are usage errors (2) and print help', async () => { const t = io(BOTH); expect(await runProvider(['status', 'gemini'], t.io)).toBe(2); expect(await runProvider(['frobnicate'], t.io)).toBe(2); expect(t.err.join('\n')).toContain('centcom provider login'); expect(await runProvider([], t.io)).toBe(0); });
});

describe('centcom provider login / logout', () => {
  it('login codex spawns the vendor login once with inherited streams and no shell, then checks again', async () => {
    const t = io(BOTH); const before = t.r.calls.length; const code = await runProvider(['login', 'codex'], t.io); expect(t.spawned).toHaveLength(1); expect(t.spawned[0]).toMatchObject({ args: ['login'], o: { stdio: 'inherit', shell: false } }); expect(t.r.calls.length).toBeGreaterThan(before); expect(code).toBe(0);
  });
  it('without a terminal it spawns nothing, exits 1 and prints the manual command', async () => { const t = io(BOTH, { isTTY: false }); expect(await runProvider(['login', 'codex'], t.io)).toBe(1); expect(t.spawned).toHaveLength(0); expect(t.err.join('\n')).toContain('codex login'); });
  it('login for a missing tool exits 2 with the install hint', async () => { const t = io(BOTH, { installed: [] }); expect(await runProvider(['login', 'claude'], t.io)).toBe(2); expect(t.err.join('\n')).toContain('npm install'); expect(t.spawned).toHaveLength(0); });
  it('Ctrl-C during login exits 130', async () => { const t = io(BOTH, { exit: 130 }); expect(await runProvider(['login', 'claude'], t.io)).toBe(130); });
  it('login without a provider name is a usage error', async () => { const t = io(BOTH); expect(await runProvider(['login'], t.io)).toBe(2); expect(t.spawned).toHaveLength(0); });
  it('logout claude --yes spawns the vendor logout once and re-checks; without --yes and without a terminal it exits 1 and spawns nothing', async () => {
    const t = io(BOTH); const n = t.r.calls.length; expect(await runProvider(['logout', 'claude', '--yes'], t.io)).toBe(0); expect(t.spawned).toHaveLength(1); expect(t.spawned[0]!.args).toEqual(['auth', 'logout']); expect(t.r.calls.length).toBeGreaterThan(n);
    const u = io(BOTH, { isTTY: false }); expect(await runProvider(['logout', 'claude'], u.io)).toBe(1); expect(u.spawned).toHaveLength(0);
  });
  it('logout asks first on a terminal, and "no" changes nothing', async () => { const t = io(BOTH, { confirm: async () => false }); expect(await runProvider(['logout', 'codex'], t.io)).toBe(1); expect(t.spawned).toHaveLength(0); expect(t.out).toContain('Nothing changed.'); });
});

describe('centcom provider doctor', () => {
  it('prints one line per check; exit 0 when all ok, 1 with warnings', async () => {
    const ok = io(BOTH); expect(await runProvider(['doctor'], ok.io)).toBe(0); expect(ok.out.some((l) => l.startsWith('ok    provider.claude.installed'))).toBe(true);
    const w = io(BOTH, { installed: ['claude'] }); expect(await runProvider(['doctor'], w.io)).toBe(1); expect(w.out.join('\n')).toMatch(/warn\s+provider\.codex\.installed/); expect(w.out.join('\n')).toContain('npm install -g @openai/codex');
  });
  it('--json lists the checks with schema_version 1', async () => { const t = io(BOTH); await runProvider(['doctor', '--json'], t.io); const j = JSON.parse(t.out.join('\n')); expect(j.schema_version).toBe(1); expect(j.checks.map((c: { id: string }) => c.id)).toContain('provider.leak_scan'); });
});
