import { describe, expect, it } from 'vitest';
import { paletteFor } from '../../src/mascot/catalog.js';
import { stateToAnimation } from '../../src/mascot/statemap.js';
import { all, fakeCatalog, idx } from './helpers.js';
import { gzipSync } from 'node:zlib';

describe('lazy categories (acceptance 6)', () => {
  it('nothing is fetched until a mascot asks; then the small index, then only that category, each once', async () => { const c = fakeCatalog(); expect(c.urls).toEqual([]); const idle = stateToAnimation('idle').name; const a = await c.sprite(idle); expect(a!.frames.length).toBeGreaterThan(0); expect(c.urls).toEqual(['/mascot/index.json', `/mascot/${idx.index[idle]}.json`]); await c.sprite(idle); await c.sprite(idle); expect(c.urls).toHaveLength(2); const other = all.animations.find((x) => x.cat !== idx.index[idle])!; await c.sprite(other.name); expect(c.urls).toHaveLength(3); expect(c.urls.at(-1)).toBe(`/mascot/${other.cat}.json`); expect(await c.sprite('not_an_animation')).toBeUndefined(); expect(c.urls).toHaveLength(3); });
  it('a failed fetch is tried again next time', async () => { let fail = true; const { Catalog } = await import('../../src/mascot/catalog.js'); const { sprites, idx: ix } = await import('./helpers.js'); const c = new Catalog(async (u) => ({ ok: !(fail && u.endsWith('agent.json')), json: async () => (u.endsWith('index.json') ? ix : sprites('agent')) })); const name = all.animations.find((a) => a.cat === 'agent')!.name; await expect(c.sprite(name)).rejects.toThrow(); fail = false; expect((await c.sprite(name))!.frames.length).toBeGreaterThan(0); });
  it('the agent category is under 40 KB gzip and the colour swap uses the palmap', () => { const agent = JSON.stringify(Object.fromEntries(all.animations.filter((a) => a.cat === 'agent').map((a) => [a.name, { w: a.w, h: a.h, frames: a.frames }]))); expect(gzipSync(agent).length).toBeLessThanOrEqual(40 * 1024); const violet = paletteFor(idx, 'violet'); const red = paletteFor(idx, 'red'); expect(violet.B).toBeTruthy(); expect(red.B).not.toBe(violet.B); expect(paletteFor(idx, 'nonsense').B).toBe(violet.B); });
});
