import { rmSync, writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { createSessionStore, newId } from '../../src/index.js';
import { rig, tmp } from './rig.js';

describe('index and retention', () => {
  it('a deleted index is rebuilt from 500 sessions of 1,000 records in under 2 s', () => {
    const dir = tmp(); const root = join(dir, 'sessions'); const rec = (n: number, type: string, data: unknown) => JSON.stringify({ n, at: new Date(Date.UTC(2026, 9, 1) + n).toISOString(), type, data }) + '\n';
    const ids: string[] = []; for (let s = 0; s < 500; s++) { const id = newId('ses', Date.UTC(2026, 0, 1) + s); ids.push(id); mkdirSync(join(root, id), { recursive: true }); let t = '{"fmt":"centcom.localsession","v":2}\n' + rec(1, 'session.meta', { cwd: s % 2 ? '/a' : '/b' }) + rec(2, 'user.message', { text: `task ${s}` }); for (let i = 3; i <= 1000; i++) t += rec(i, i % 3 ? 'text.delta' : 'text.done', { message_id: 'm', text: 'some streamed words' }); writeFileSync(join(root, id, 'log.jsonl'), t); }
    const st = createSessionStore({ dataDir: dir }); const t0 = performance.now(); const all = st.sync.list({ limit: 1000 }); const ms = performance.now() - t0;
    expect(all).toHaveLength(500); expect(ms).toBeLessThan(2000); expect(st.sync.list({ cwd: '/a', limit: 1000 })).toHaveLength(250); expect(all.find((x) => x.id === ids[7])).toMatchObject({ title: 'task 7', cwd: '/a', message_count: 1 + 333 });
  });
  it('list drops rows whose session is gone, newest first, and --continue picks the newest in the folder', async () => {
    const { store, clock } = rig(); const a = store.sync.create({ cwd: '/w' }); a.note('user.message', { text: 'old' }); await a.close(); await clock.advance(5000);
    const b = store.sync.create({ cwd: '/w' }); b.note('user.message', { text: 'new' }); await b.close();
    expect(store.sync.list({ cwd: '/w' }).map((s) => s.title)).toEqual(['new', 'old']); rmSync(join(store.dir, b.id), { recursive: true }); expect(store.sync.list({ cwd: '/w' }).map((s) => s.title)).toEqual(['old']);
  });
  it('prune removes sessions older than the retention, never a locked one', async () => {
    const { store, clock } = rig({ retentionDays: 30 }); const old = store.sync.create({ cwd: '/w' }); old.note('user.message', { text: 'old' }); await old.close();
    const busy = store.sync.create({ cwd: '/w' }); busy.note('user.message', { text: 'busy' }); await busy.flush();
    const { spawn } = await import('node:child_process'); const live = spawn(process.execPath, ['-e', 'setTimeout(() => {}, 30000)']); writeFileSync(join(store.dir, busy.id, 'lock'), String(live.pid));
    await clock.advance(1000); expect(await store.prune(new Date(Date.UTC(2026, 9, 6) + 31 * 86_400_000))).toEqual({ removed: 1 }); live.kill();
    expect(store.sync.list({}).map((s) => s.title)).toEqual(['busy']);
  });
});
