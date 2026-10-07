import { mkdirSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { LocalService, listDir, sanitise } from '../src/local/service.js';

describe('messages from a screen are checked', () => {
  it('drops junk and caps text', () => {
    for (const bad of [null, 5, 'x', {}, { t: 5 }, { t: 'nope' }, { t: 'browse' }, { t: 'open', dir: 5 }, { t: 'setMode', mode: 'yolo' }, { t: 'setModel' }]) expect(sanitise(bad), JSON.stringify(bad)).toBeUndefined();
    expect((sanitise({ t: 'submit', text: 'a'.repeat(150_000) }) as { text: string }).text).toHaveLength(100_000); expect(sanitise({ t: 'submit', text: 'a'.repeat(250_000) })).toBeUndefined();
    expect(sanitise({ t: 'approve', decision: 'maybe', scope: 'forever', extra: 1 })).toEqual({ t: 'approve', decision: 'deny' }); expect(sanitise({ t: 'open', dir: '/x', engine: 'evil', demo: 'yes' })).toEqual({ t: 'open', dir: '/x', demo: false, engine: 'claude-code' });
    expect(sanitise({ t: 'pref', theme: 'neon', side: 'no' })).toEqual({ t: 'pref' }); expect(sanitise({ t: 'setMode', mode: 'plan' })).toEqual({ t: 'setMode', mode: 'plan' });
  });
});
describe('the folder picker', () => {
  it('lists folders only, git first, without hidden ones or node_modules', () => {
    const d = mkdtempSync(join(tmpdir(), 'cc-ls-')); for (const n of ['b', 'a', '.hid', 'node_modules', 'g/.git']) mkdirSync(join(d, n), { recursive: true });
    const r = listDir(d, d); expect(r.entries.map((e) => e.name)).toEqual(['g', 'a', 'b']); expect(r.git).toBe(false); expect(listDir(join(d, 'nope'), d).error).toBe('Cannot read this folder.');
  });
});
describe('the service', () => {
  it('opening a missing folder is an error notice; a window that detaches is forgotten', async () => {
    const home = mkdtempSync(join(tmpdir(), 'cc-home-')); const svc = new LocalService({ home, cwd: home }); const got: { t: string; text?: string }[] = [];
    const w = svc.attach('w1', (m) => got.push(m as never)); await w.handle({ t: 'open', dir: join(home, 'missing') }); await w.handle('junk');
    expect(got).toEqual([{ t: 'notice', level: 'error', text: 'That folder does not exist.' }]); await w.handle({ t: 'browse', path: home }); expect(got.at(-1)).toMatchObject({ t: 'dir', path: home }); w.detach(); svc.shutdown();
  });
});
