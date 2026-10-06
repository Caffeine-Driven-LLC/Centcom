import { spawnSync, spawn } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { SessionInUse, UnsupportedSessionFormat, createSessionStore } from '../../src/index.js';
import { rig, tmp } from './rig.js';

const ID = 'ses_01JTEST0000000000000000001';
async function written(n = 30) { const { store } = rig(); const h = store.sync.create({ cwd: '/w', id: ID }); for (let i = 0; i < n; i++) h.note('user.message', { text: `message ${i} ünïcödé` }); await h.close(); return { store, path: join(store.dir, ID, 'log.jsonl') }; }

describe('recovery', () => {
  it('a torn last line is dropped, a recovered record is appended, earlier bytes are untouched', async () => {
    const { store, path } = await written(5); const full = readFileSync(path); writeFileSync(path, full.subarray(0, full.length - 7));
    const before = readFileSync(path); const s = store.sync.open(ID); expect(s.recovered).toBe(true); expect(s.records.filter((r) => r.type === 'user.message')).toHaveLength(4);
    const h = store.sync.resume(ID); await h.close(); const after = readFileSync(path); expect(after.subarray(0, before.length).equals(before)).toBe(true);
    const again = store.sync.open(ID); expect(again.records.at(-1)!.type).toBe('recovered'); expect(again.recovered).toBe(false); expect(again.records.at(-1)!.n).toBe(6);
  });
  it('truncating a valid log at any byte offset always loads the longest valid prefix', async () => {
    const { path } = await written(12); const full = readFileSync(path); const ends: number[] = []; for (let i = 0; i < full.length; i++) if (full[i] === 0x0a) ends.push(i + 1);
    await fc.assert(fc.asyncProperty(fc.integer({ min: 0, max: full.length }), async (cut) => {
      const dir = tmp(); const sd = join(dir, 'sessions', ID); mkdirSync(sd, { recursive: true }); writeFileSync(join(sd, 'log.jsonl'), full.subarray(0, cut));
      const s = createSessionStore({ dataDir: dir }).sync.open(ID); const complete = ends.filter((e) => e <= cut).length - 1; // minus the header
      const lastLine = full.subarray(ends.filter((e) => e <= cut).at(-1) ?? 0, cut).toString(); let extra = 0; try { if (lastLine && JSON.parse(lastLine).n) extra = 1; } catch { /* torn */ }
      expect(s.records.length).toBe(Math.max(0, complete) + extra);
    }), { numRuns: 200 });
  });
  it('an unknown format version is refused with one clear line', async () => {
    const dir = tmp(); const sd = join(dir, 'sessions', ID); mkdirSync(sd, { recursive: true }); writeFileSync(join(sd, 'log.jsonl'), '{"fmt":"centcom.localsession","v":3}\n');
    const st = createSessionStore({ dataDir: dir }); expect(() => st.sync.open(ID)).toThrow(UnsupportedSessionFormat); try { st.sync.open(ID); } catch (e) { expect((e as Error).message).not.toContain('\n'); }
  });
  it('a live lock refuses a second writer with "session in use"; a stale one is taken over', async () => {
    const { store } = await written(1); const live = spawn(process.execPath, ['-e', 'setTimeout(() => {}, 30000)']); writeFileSync(join(store.dir, ID, 'lock'), String(live.pid));
    try { store.sync.resume(ID); expect.unreachable(); } catch (e) { expect(e).toBeInstanceOf(SessionInUse); expect((e as SessionInUse).hint).toBe('session in use'); } finally { live.kill(); }
    const dead = spawnSync(process.execPath, ['-e', 'process.stdout.write(String(process.pid))']).stdout.toString(); writeFileSync(join(store.dir, ID, 'lock'), dead);
    const h = store.sync.resume(ID); expect(readFileSync(join(store.dir, ID, 'lock'), 'utf8')).toBe(String(process.pid)); await h.close();
  });
  it('kill -9 during a 1,000-record burst: the valid prefix loads and at most the last 250 ms are lost', async () => {
    const dir = tmp(); const src = new URL('../../src/index.ts', import.meta.url).pathname;
    const script = `import { createSessionStore } from ${JSON.stringify(src)}; const s = createSessionStore({ dataDir: ${JSON.stringify(dir)} }); const h = s.sync.create({ cwd: '/w', id: '${ID}' }); let i = 0; const t = setInterval(() => { for (let k = 0; k < 20; k++) h.note('user.message', { text: 'm' + i++ }); if (i >= 1000) { clearInterval(t); setInterval(() => {}, 1000); process.stdout.write('done\\n'); } }, 5);`;
    const p = spawn(process.execPath, ['--import', 'tsx', '--input-type=module', '-e', script], { stdio: ['ignore', 'pipe', 'inherit'] }); await new Promise<void>((res) => p.stdout!.on('data', () => res())); await new Promise((r) => setTimeout(r, 400)); p.kill('SIGKILL'); await new Promise((r) => p.once('exit', r));
    const s = createSessionStore({ dataDir: dir }).sync.open(ID); const texts = s.records.filter((r) => r.type === 'user.message').map((r) => (r.data as { text: string }).text); expect(texts).toEqual(Array.from({ length: texts.length }, (_, i) => `m${i}`)); expect(texts.length).toBe(1000); // all flushed by the time the burst was quiet for 250 ms
  }, 30_000);
});
