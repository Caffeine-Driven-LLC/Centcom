import React from 'react';
import { mkdtempSync, readFileSync, rmSync, statSync, writeFileSync, mkdirSync, chmodSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { renderToString } from 'ink';
import { afterAll, describe, expect, it } from 'vitest';
import { EmptyState, FIRST_RUN, FirstRun, NOT_GIT, SAVE_FAILED, appendExclude, emptyText, isFirstRun, markFirstRunDone, runInit, wordCount, type InitDeps } from '../src/index.js';

const dirs: string[] = []; afterAll(() => { for (const d of dirs) { try { chmodSync(d, 0o700); } catch { /* fine */ } rmSync(d, { recursive: true, force: true }); } });
const tmp = () => { const d = mkdtempSync(join(tmpdir(), 'centcom-onb-')); dirs.push(d); return d; };
const strip = (s: string) => s.replace(/\x1b\[[0-9;]*m/g, '');

describe('first-run state (acceptance 1)', () => {
  it('shows once, not again, and again after the file is deleted', async () => { const d = tmp(); const f = join(d, 'state.json'); expect(await isFirstRun({ stateFile: f })).toBe(true); expect(await markFirstRunDone({ stateFile: f })).toEqual({ ok: true }); expect(await isFirstRun({ stateFile: f })).toBe(false); expect(statSync(f).mode & 0o777).toBe(0o600); rmSync(f); expect(await isFirstRun({ stateFile: f })).toBe(true); });
  it('keeps other keys, treats a damaged file as not done, and reports an unwritable folder once without throwing', async () => { const d = tmp(); const f = join(d, 'state.json'); writeFileSync(f, '{"other":1}'); await markFirstRunDone({ stateFile: f }); expect(JSON.parse(readFileSync(f, 'utf8')).other).toBe(1); writeFileSync(f, '{oops'); expect(await isFirstRun({ stateFile: f })).toBe(true); const ro = tmp(); chmodSync(ro, 0o500); if (process.getuid?.() !== 0) expect(await markFirstRunDone({ stateFile: join(ro, 'sub', 'state.json') })).toEqual({ ok: false, message: SAVE_FAILED }); });
});
describe('first-run screen (acceptance 2)', () => {
  const screen = (w: number, h: number, o: { tier?: 'truecolor' | 'none'; mascot?: boolean } = {}) => strip(renderToString(<FirstRun onDone={() => undefined} width={w} height={h} tier={o.tier ?? 'truecolor'} mascotAllowed={o.mascot ?? true} reducedMotion />, { columns: w }));
  it('one sentence under 20 words and exactly one command line', () => { expect(wordCount(FIRST_RUN.sentence)).toBeLessThan(20); const out = screen(80, 24); expect(out).toContain(FIRST_RUN.sentence); expect(out.split('\n').filter((l) => l.includes('centcom init'))).toHaveLength(1); expect(out).toContain('https://centcom.dev/docs'); });
  it('80x24: the ASCII Cento; 100x40: the half-block one', () => { const small = screen(80, 24); expect(small).toContain('(•_•)'); const big = screen(100, 40); expect(big).not.toContain('(•_•)'); expect(big).toMatch(/[▀▄█]/); });
  it('NO_COLOR keeps the ASCII form; no mascot when it is off', () => { expect(screen(100, 40, { tier: 'none' })).toContain('(•_•)'); expect(screen(80, 24, { mascot: false })).not.toContain('(•_•)'); });
  it('plain mode is plain text', () => { const out = strip(renderToString(<FirstRun onDone={() => undefined} width={80} height={24} tier="truecolor" mascotAllowed plain />, { columns: 80 })); expect(out).not.toMatch(/[▀▄█]/); expect(out).toContain('Try: centcom init'); });
});
describe('empty states (acceptance 7)', () => {
  it('exact copy', () => { expect(strip(renderToString(<EmptyState kind="no-results" query="relay timeout" mascotAllowed={false} />, { columns: 100 })).trim()).toBe('Nothing matches "relay timeout". Try fewer words or check the spelling.'); expect(emptyText('no-sessions')).toBe('No missions yet. Start one and Cento will keep the log.'); expect(emptyText('no-team')).toBe("It's just you in here. Invite someone and Cento will make room."); });
  it('the mascot only when allowed', () => { expect(strip(renderToString(<EmptyState kind="no-sessions" />, { columns: 80 }))).toContain('(•_•)'); expect(strip(renderToString(<EmptyState kind="no-sessions" mascotAllowed={false} />, { columns: 80 }))).not.toContain('(•_•)'); });
});
describe('exclude file', () => {
  it('appends once and keeps what was there', async () => { const d = tmp(); const f = join(d, 'exclude'); writeFileSync(f, '# mine\n*.log'); expect(await appendExclude(f, ['/.centcom/*', '!/.centcom/config.json'])).toHaveLength(2); expect(await appendExclude(f, ['/.centcom/*', '!/.centcom/config.json'])).toEqual([]); expect(readFileSync(f, 'utf8')).toBe('# mine\n*.log\n/.centcom/*\n!/.centcom/config.json\n'); });
});
describe('runInit (acceptance 3 to 6, 8)', () => {
  function rig(o: { git?: boolean; tty?: boolean; confirm?: boolean; memFails?: boolean } = {}) {
    const d = tmp(); if (o.git !== false) { execFileSync('git', ['init', '-q'], { cwd: d }); } const out: string[] = []; const err: string[] = []; const writes: string[] = [];
    const deps: InitDeps = { cwd: d, io: { out: (l) => out.push(l), err: (l) => err.push(l), isTTY: o.tty ?? false, confirm: async () => o.confirm ?? true },
      gitRoot: async () => (o.git === false ? undefined : d), excludePath: async (r) => join(r, '.git', 'info', 'exclude'),
      config: { exists: async (p) => { try { statSync(p); return true; } catch { return false; } }, write: async (p, t) => { writes.push(p); mkdirSync(join(p, '..'), { recursive: true }); writeFileSync(p, t); }, copy: async (a, b) => { writes.push(b); writeFileSync(b, readFileSync(a)); } },
      memory: { find: async (r) => { try { statSync(join(r, 'CLAUDE.md')); return join(r, 'CLAUDE.md'); } catch { return undefined; } }, create: async (r) => { if (o.memFails) throw new Error('disk full'); writes.push(join(r, 'CLAUDE.md')); writeFileSync(join(r, 'CLAUDE.md'), '# notes\n'); return join(r, 'CLAUDE.md'); } } };
    return { d, deps, out, err, writes };
  }
  it('creates the config and memory file, excludes the local folder once, prints every path; the second run changes nothing', async () => {
    const r = rig(); const res = await runInit(r.deps, { yes: true }); expect(res.code).toBe(0); expect(res.created).toEqual([join(r.d, '.centcom/config.json'), join(r.d, 'CLAUDE.md'), join(r.d, '.git/info/exclude')]); for (const c of res.created) expect(r.out.join('\n')).toContain(c);
    const m = statSync(join(r.d, '.centcom/config.json')).mtimeMs; r.out.length = 0; r.writes.length = 0; const again = await runInit(r.deps, { yes: true }); expect(again).toMatchObject({ alreadySetUp: true, code: 0, created: [] }); expect(r.out).toEqual(['Already set up.']); expect(r.writes).toEqual([]); expect(statSync(join(r.d, '.centcom/config.json')).mtimeMs).toBe(m);
    expect(readFileSync(join(r.d, '.git/info/exclude'), 'utf8').split('\n').filter((l) => l === '/.centcom/*')).toHaveLength(1);
  });
  it('--dry-run writes nothing and lists the plan', async () => { const r = rig(); const res = await runInit(r.deps, { dryRun: true }); expect(res.code).toBe(0); expect(r.writes).toEqual([]); expect(r.out[0]).toBe('This would:'); expect(r.out.length).toBe(4); });
  it('outside git: config in the folder, and says what needs git', async () => { const r = rig({ git: false }); const res = await runInit(r.deps, { yes: true }); expect(r.out[0]).toBe(NOT_GIT); expect(res.created).toContain(join(r.d, '.centcom/config.json')); expect(res.created.some((c) => c.includes('exclude'))).toBe(false); });
  it('no terminal and no --yes: exit 2 with the message; with a terminal it asks', async () => { const r = rig(); expect((await runInit(r.deps)).code).toBe(2); expect(r.err).toEqual(['Run with --yes to proceed without a prompt.']); expect(r.writes).toEqual([]); const no = rig({ tty: true, confirm: false }); expect((await runInit(no.deps)).code).toBe(0); expect(no.out.at(-1)).toBe('Nothing changed.'); expect(no.writes).toEqual([]); });
  it('an existing config is kept unless --force, which keeps a .bak first', async () => { const r = rig(); mkdirSync(join(r.d, '.centcom')); writeFileSync(join(r.d, '.centcom/config.json'), '{"mine":true}'); await runInit(r.deps, { yes: true }); expect(readFileSync(join(r.d, '.centcom/config.json'), 'utf8')).toBe('{"mine":true}'); await runInit(r.deps, { yes: true, force: true }); expect(readFileSync(join(r.d, '.centcom/config.json.bak'), 'utf8')).toBe('{"mine":true}'); expect(readFileSync(join(r.d, '.centcom/config.json'), 'utf8')).toBe('{}\n'); });
  it('a memory file that cannot be made: the other steps still happen, exit 1', async () => { const r = rig({ memFails: true }); const res = await runInit(r.deps, { yes: true }); expect(res.code).toBe(1); expect(r.err.join(' ')).toMatch(/memory file/); expect(res.created).toContain(join(r.d, '.centcom/config.json')); });
});
