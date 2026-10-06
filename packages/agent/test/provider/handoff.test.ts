import { EventEmitter } from 'node:events';
import { describe, expect, it } from 'vitest';
import { loginHandoff, logoutHandoff, type HandoffDeps, type SpawnFn } from '../../src/index.js';
import { CLAUDE_OK, CODEX_OK, res, rig } from './helpers.js';

function spawner(exit: { code: number | null; signal?: string | null } = { code: 0 }, onSpawn?: () => void) {
  const calls: { file: string; args: string[]; o: unknown }[] = []; const spawn: SpawnFn = (file, args, o) => { calls.push({ file, args, o }); onSpawn?.(); const e = new EventEmitter(); setImmediate(() => e.emit('close', exit.code, exit.signal ?? null)); return e as never; }; return { spawn, calls };
}
const deps = (table: Parameters<typeof rig>[0], sp: ReturnType<typeof spawner>, o: Partial<HandoffDeps> = {}) => { const r = rig(table); const said: string[] = []; return { r, said, d: { spawn: sp.spawn, detector: r.detector, isTTY: true, say: (l: string) => said.push(l), ...o } as HandoffDeps }; };

describe('loginHandoff', () => {
  it('Codex: spawns the vendor login exactly once, inherited streams, no shell, then checks again', async () => {
    let table: Record<string, any> = { ...CODEX_OK, 'login status': res('Not logged in\n', 1) }; const sp = spawner({ code: 0 }, () => { Object.assign(table, { 'login status': res('Logged in using ChatGPT\n') }); });
    const { d, r } = deps(table, sp); const before = r.calls.length; const out = await loginHandoff('codex', d);
    expect(sp.calls).toHaveLength(1); expect(sp.calls[0]).toMatchObject({ file: '/usr/bin/codex', args: ['login'], o: { stdio: 'inherit', shell: false } }); expect(r.calls.length).toBeGreaterThan(before); expect(out.status.signed_in).toBe('yes'); expect(out.exit_code).toBe(0);
  });
  it('Claude with the auth subcommand uses `auth login`, and --console for API billing', async () => {
    const sp = spawner(); const { d } = deps(CLAUDE_OK, sp); await loginHandoff('claude-code', d); await loginHandoff('claude-code', d, { console: true }); expect(sp.calls.map((c) => c.args)).toEqual([['auth', 'login'], ['auth', 'login', '--console']]);
  });
  it('Claude without it opens the interactive tool with a one-line hint', async () => { const sp = spawner(); const { d, said } = deps({ '--version': res('2.0.1'), 'auth --help': res('', 1) }, sp); await loginHandoff('claude-code', d); expect(sp.calls[0]!.args).toEqual([]); expect(said.join(' ')).toContain('/login'); });
  it('without a terminal nothing is spawned and the manual command is returned', async () => { const sp = spawner(); const { d } = deps(CODEX_OK, sp, { isTTY: false }); const out = await loginHandoff('codex', d); expect(sp.calls).toHaveLength(0); expect(out.refused).toEqual({ reason: 'no_tty', manual: 'codex login' }); });
  it('a missing tool is refused before anything is spawned', async () => { const sp = spawner(); const r = rig(CODEX_OK, { installed: [] }); const out = await loginHandoff('codex', { spawn: sp.spawn, detector: r.detector, isTTY: true, say: () => undefined }); expect(sp.calls).toHaveLength(0); expect(out.refused?.reason).toBe('not_installed'); });
  it('Ctrl-C ends the child with a signal and the exit code is 130', async () => { const sp = spawner({ code: null, signal: 'SIGINT' }); const { d } = deps(CODEX_OK, sp); expect((await loginHandoff('codex', d)).exit_code).toBe(130); });
  it('a login that exits 0 but still reports signed out says so and does not loop', async () => { const sp = spawner(); const { d, said } = deps({ ...CODEX_OK, 'login status': res('Not logged in\n', 1) }, sp); const out = await loginHandoff('codex', d); expect(out.still_signed_out).toBe(true); expect(sp.calls).toHaveLength(1); expect(said.join(' ')).toContain('codex login'); });
  it('a child that cannot start gives a null exit code instead of throwing', async () => { const spawn: SpawnFn = () => { const e = new EventEmitter(); setImmediate(() => e.emit('error', new Error('boom'))); return e as never; }; const r = rig(CODEX_OK); expect((await loginHandoff('codex', { spawn, detector: r.detector, isTTY: true, say: () => undefined })).exit_code).toBeNull(); });
});

describe('logoutHandoff', () => {
  it('--yes spawns the vendor logout once and re-checks', async () => { const sp = spawner(); const { d, r } = deps(CLAUDE_OK, sp); const n = r.calls.length; await logoutHandoff('claude-code', d, { yes: true }); expect(sp.calls).toHaveLength(1); expect(sp.calls[0]!.args).toEqual(['auth', 'logout']); expect(r.calls.length).toBeGreaterThan(n); });
  it('Codex logout runs `codex logout`', async () => { const sp = spawner(); const { d } = deps(CODEX_OK, sp); await logoutHandoff('codex', d, { yes: true }); expect(sp.calls[0]!.args).toEqual(['logout']); });
  it('without --yes and without a terminal nothing is spawned', async () => { const sp = spawner(); const { d } = deps(CLAUDE_OK, sp, { isTTY: false }); expect((await logoutHandoff('claude-code', d)).refused?.reason).toBe('no_tty'); expect(sp.calls).toHaveLength(0); });
  it('with a terminal it asks; "no" spawns nothing, "yes" spawns once', async () => {
    const sp = spawner(); const no = deps(CLAUDE_OK, sp, { confirm: async () => false }); expect((await logoutHandoff('claude-code', no.d)).refused?.reason).toBe('declined'); expect(sp.calls).toHaveLength(0);
    const yes = deps(CLAUDE_OK, sp, { confirm: async () => true }); await logoutHandoff('claude-code', yes.d); expect(sp.calls).toHaveLength(1);
  });
  it('Claude without the auth subcommand is refused with the in-tool instruction', async () => { const sp = spawner(); const { d } = deps({ '--version': res('2.0.1'), 'auth --help': res('', 1) }, sp); const out = await logoutHandoff('claude-code', d, { yes: true }); expect(out.refused).toMatchObject({ reason: 'unsupported' }); expect(sp.calls).toHaveLength(0); });
});
