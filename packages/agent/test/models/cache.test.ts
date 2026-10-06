import { describe, expect, it } from 'vitest';
import { rig } from './rig.js';

describe('model list and cache', () => {
  it('lists reported models plus aliases; /model marks the current one with * in at most 80 columns', async () => {
    const r = rig({ config: { aliases: { fast: 'the quick one' } } }); r.reg.onEvent('a1', { type: 'session.started', model: 'm-a' });
    const ids = (await r.reg.list('claude-code')).map((m) => m.id); expect(ids).toEqual(['m-a', 'm-b', 'fast']);
    const lines = await r.reg.describe('a1'); expect(lines[0]!.startsWith('*')).toBe(true); expect(lines.every((l) => l.length <= 80)).toBe(true); expect(lines.filter((l) => l.startsWith('*'))).toHaveLength(1);
  });
  it('without models.list: only the init model and aliases, and the capability note', async () => {
    const r = rig({ caps: [], config: { aliases: ['opus'] } }); r.reg.onEvent('a1', { type: 'session.started', model: 'm-a' });
    expect((await r.reg.list('claude-code')).map((m) => m.id)).toEqual(['m-a', 'opus']); expect(r.listCalls()).toBe(0); expect((await r.reg.describe('a1')).at(-1)).toBe('This engine did not report a model list.');
  });
  it('the cache survives a restart, is ignored after 24 h, and after a version change', async () => {
    const a = rig({ version: '1.0' }); await a.reg.list('claude-code'); expect(a.listCalls()).toBe(1); await a.reg.list('claude-code'); expect(a.listCalls()).toBe(1);
    const b = rig({ version: '1.0', files: a.files }); await b.reg.list('claude-code'); expect(b.listCalls()).toBe(0); // fresh process, same file
    b.advance(23 * 3_600_000); await b.reg.list('claude-code'); expect(b.listCalls()).toBe(0); b.advance(2 * 3_600_000); await b.reg.list('claude-code'); expect(b.listCalls()).toBe(1);
    const c = rig({ version: '1.0', files: a.files }); c.setVersion('2.0'); await c.reg.list('claude-code'); expect(c.listCalls()).toBe(1);
  });
  it('a damaged cache file is ignored', async () => { const r = rig({ files: new Map([['/data/models-cache.json', '{oops']]) }); expect((await r.reg.list('claude-code')).length).toBe(2); });
});
