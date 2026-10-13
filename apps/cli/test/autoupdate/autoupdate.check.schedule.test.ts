import { describe, expect, it } from 'vitest';
import { DEFAULT_INTERVAL_H, JITTER, intervalMs, readCheckCache, shouldCheck, writeCheckCache, type FsPort } from '../../src/autoupdate/index.js';

const H = 3_600_000; const memFs = (files: Record<string, string> = {}, failWrite = false): FsPort & { files: Record<string, string> } => ({ files, exists: async (p) => p in files, copyFile: async () => undefined, rename: async () => undefined, rm: async () => undefined, chmod: async () => undefined, readFile: async (p) => { if (!(p in files)) throw new Error('ENOENT'); return files[p]!; }, writeFile: async (p, d) => { if (failWrite) throw new Error('EROFS'); files[p] = d; } });
describe('when to check', () => {
  it('the interval is 6 hours give or take 20 %', () => {
    expect(DEFAULT_INTERVAL_H).toBe(6); expect(JITTER).toBe(0.2); expect(intervalMs(6, () => 0)).toBeCloseTo(6 * H * 0.8); expect(intervalMs(6, () => 0.5)).toBeCloseTo(6 * H); expect(intervalMs(6, () => 0.999999)).toBeLessThanOrEqual(6 * H * 1.2); expect(intervalMs(6, () => 1)).toBeCloseTo(6 * H * 1.2);
    for (let i = 0; i < 200; i++) { const v = intervalMs(6, Math.random); expect(v).toBeGreaterThanOrEqual(6 * H * 0.8 - 1); expect(v).toBeLessThanOrEqual(6 * H * 1.2 + 1); }
    expect(intervalMs(0, () => 0.5)).toBeCloseTo(6 * H); expect(intervalMs(NaN, () => 0.5)).toBeCloseTo(6 * H); expect(intervalMs(1, () => 0.5)).toBeCloseTo(H);
  });
  it('never checked, a damaged or future time: check; inside the window: not; after it: yes', () => {
    const now = 1_000 * H; expect(shouldCheck(now, null, () => 0.5)).toBe(true); expect(shouldCheck(now, NaN, () => 0.5)).toBe(true); expect(shouldCheck(now, now + 5, () => 0.5)).toBe(true);
    expect(shouldCheck(now, now - 4 * H, () => 0.5)).toBe(false); expect(shouldCheck(now, now - 6 * H, () => 0.5)).toBe(true); expect(shouldCheck(now, now - 5 * H, () => 0)).toBe(true); expect(shouldCheck(now, now - 5 * H, () => 1)).toBe(false); expect(shouldCheck(now, now - 7.3 * H, () => 1)).toBe(true);
    expect(shouldCheck(now, now - 2 * H, () => 0.5, 1)).toBe(true); expect(shouldCheck(now, now - 2 * H, () => 0.5, 12)).toBe(false);
  });
  it('the last look is kept on disk; a missing, damaged or unwritable cache only means "check again"', async () => {
    const fs = memFs(); expect(await readCheckCache(fs, '/c')).toBeNull(); await writeCheckCache(fs, '/c', { at: 5, channel: 'stable', version: '1.4.3' }); expect(await readCheckCache(fs, '/c')).toEqual({ at: 5, channel: 'stable', version: '1.4.3' });
    fs.files['/c'] = '{"at":"x"}'; expect(await readCheckCache(fs, '/c')).toBeNull(); fs.files['/c'] = 'not json'; expect(await readCheckCache(fs, '/c')).toBeNull(); await expect(writeCheckCache(memFs({}, true), '/c', { at: 1 })).resolves.toBeUndefined();
  });
});
