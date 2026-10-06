import { describe, expect, it } from 'vitest';
import { VirtualClock } from '@centcom/testkit';
import { createHooksManager, type HooksFs } from '@centcom/agent';
import { runHooks, type HooksIO } from '../src/commands/hooks/index.js';

function io(files: Record<string, string> = {}, o: Partial<HooksIO> & { yes?: boolean } = {}) {
  const m = new Map(Object.entries(files)); const writes: string[] = []; const fs: HooksFs = { read: async (p) => m.get(p), writeAtomic: async (p, t) => { writes.push(p); m.set(p, t); }, list: async (d) => [...m.keys()].filter((k) => k.startsWith(d + '/')).map((k) => k.slice(d.length + 1)), remove: async (p) => { m.delete(p); } };
  const out: string[] = []; const err: string[] = []; const asked: string[] = [];
  const mgr = createHooksManager({ fs, clock: new VirtualClock(), which: (c) => (c === 'missing' ? undefined : `/bin/${c}`), engines: { capabilities: () => undefined, settingsPaths: (e, s, r) => (e === 'claude-code' ? (s === 'user' ? '/home/u/.claude/settings.json' : `${r}/.claude/settings${s === 'local' ? '.local' : ''}.json`) : undefined) } });
  const base: HooksIO = { mgr, root: '/proj', out: (l) => out.push(l), err: (l) => err.push(l), isTTY: true, confirm: async (q) => { asked.push(q); return o.yes ?? true; }, ...o };
  return { io: base, out, err, asked, m, writes };
}
describe('centcom hooks', () => {
  it('add --template shows the full command, asks, writes, and lists it', async () => {
    const t = io({ '/proj/.claude/settings.json': '{"env":{"A":"1"}}' }); expect(await runHooks(['add', '--template', 'run-formatter-after-edit', '--choice', 'formatter=gofmt -w'], t.io)).toBe(0); expect(t.out.join('\n')).toContain('xargs gofmt -w'); expect(t.asked).toHaveLength(1);
    expect(JSON.parse(t.m.get('/proj/.claude/settings.json')!).hooks.PostToolUse[0].hooks[0].command).toContain('gofmt -w'); expect(JSON.parse(t.m.get('/proj/.claude/settings.json')!).env).toEqual({ A: '1' }); t.out.length = 0; await runHooks(['list'], t.io); expect(t.out.join('\n')).toContain('PostToolUse#0 (Edit|Write)');
  });
  it('a no, or no terminal without --yes, writes nothing; user scope asks twice', async () => { const no = io({}, { yes: false }); expect(await runHooks(['add', '--event', 'Stop', '--cmd', 'echo hi'], no.io)).toBe(1); expect(no.writes).toEqual([]); const nt = io({}, { isTTY: false }); expect(await runHooks(['add', '--event', 'Stop', '--cmd', 'echo hi'], nt.io)).toBe(1); expect(nt.writes).toEqual([]); expect(await runHooks(['add', '--event', 'Stop', '--cmd', 'echo hi', '--yes'], nt.io)).toBe(0); const u = io(); expect(await runHooks(['add', '--event', 'Stop', '--cmd', 'echo hi', '--scope', 'user'], u.io)).toBe(0); expect(u.asked).toHaveLength(2); });
  it('refuses a template choice outside the fixed list, a bad timeout and a ninth hook, with exit 2', async () => { const t = io(); expect(await runHooks(['add', '--template', 'run-formatter-after-edit', '--choice', 'formatter=rm -rf /'], t.io)).toBe(2); expect(await runHooks(['add', '--event', 'Stop', '--cmd', 'x', '--timeout', '0'], t.io)).toBe(2); expect(t.writes).toEqual([]); });
  it('refuses a secret in a command without printing it', async () => { const t = io(); const k = 'ghp_' + 'B'.repeat(36); expect(await runHooks(['add', '--event', 'Stop', '--cmd', `echo ${k}`, '--yes'], t.io)).toBe(1); expect(t.out.concat(t.err).join('\n')).not.toContain(k); expect(t.writes).toEqual([]); });
  it('validate exits 1 when something is wrong, and warns about a missing program', async () => { const t = io({ '/proj/.claude/settings.json': '{"hooks":{"Frobnicate":[{"hooks":[{"type":"command","command":"missing --x"}]}]}}' }); expect(await runHooks(['validate'], t.io)).toBe(1); expect(t.out.join('\n')).toMatch(/unknown_event[\s\S]*command_not_found/); });
  it('remove, codex line, templates, usage', async () => { const t = io({ '/proj/.claude/settings.json': '{"hooks":{"Stop":[{"hooks":[{"type":"command","command":"echo a"}]}]}}' }); expect(await runHooks(['remove', '--event', 'Stop', '--index', '0', '--yes'], t.io)).toBe(0); expect(JSON.parse(t.m.get('/proj/.claude/settings.json')!).hooks).toEqual({}); t.out.length = 0; await runHooks(['list'], t.io); expect(t.out.join('\n')).toContain('Codex: The installed Codex does not document'); t.out.length = 0; await runHooks(['templates'], t.io); expect(t.out).toHaveLength(4); expect(await runHooks(['bogus'], t.io)).toBe(2); expect(await runHooks([], t.io)).toBe(0); expect(await runHooks(['list', '--scope', 'x'], t.io)).toBe(2); });
});
