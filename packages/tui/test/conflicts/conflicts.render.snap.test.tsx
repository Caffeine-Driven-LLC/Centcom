import React from 'react';
import { createTheme } from '@centcom/theme';
import { describe, expect, it } from 'vitest';
import { expectScreen, renderInk, type ColorTier } from '../../../testkit/src/index.js';
import { ConflictBanner, ConflictStack, LockChip, LockInspector, type ConflictView, type LockView } from '../../src/conflicts/index.js';
import { ThemeCtx } from '../../src/components/ui.js';

const H = 'ab12cdef'.repeat(5); const T = Date.UTC(2026, 9, 7, 12);
const lock = (o: Partial<LockView> = {}): LockView => ({ pathHmac: H, holder: 'm1', agent: 'a1', expiresAt: T + 12_000, waiting: ['a2'], displayPath: 'src/app.ts', ...o });
const conflict = (id = 'c1', o: Partial<ConflictView> = {}): ConflictView => ({ id, agents: ['a1', 'a2'], pathHmacs: [H], displayPaths: ['src/app.ts'], at: '', seq: 1, ...o });
const who = (id: string) => (id === 'm1' ? { name: 'Ada', slot: 1 } : undefined); const agentName = (id: string) => (id === 'a2' ? 'review-bot' : undefined);
const wrap = (el: React.ReactElement, tier: ColorTier) => <ThemeCtx.Provider value={createTheme('dark', tier)}>{el}</ThemeCtx.Provider>;
const shot = async (el: React.ReactElement, cols: number, rows: number, tier: ColorTier = 'none') => { const r = await renderInk(wrap(el, tier), { cols, rows, colorTier: tier }); const s = r.screen().filter((l, i, a) => l || i < a.findLastIndex((x) => x)); r.unmount(); return s; };

describe('lock chip and inspector (acceptance 1)', () => {
  for (const [cols, rows] of [[80, 24], [120, 40]] as const) it(`${cols}x${rows}: holder, countdown and the waiting agent, with the word and the glyph`, async () => {
    const s = await shot(<LockInspector locks={[lock(), lock({ pathHmac: 'zz99'.repeat(10), displayPath: undefined, expiresAt: undefined, waiting: [] })]} now={T} member={who} agentName={agentName} width={cols} />, cols, rows);
    expect(s[0]).toContain('! locked src/app.ts'); expect(s[0]).toContain('held by Ada'); expect(s[0]).toContain('12s left'); expect(s[0]).toContain('review-bot waiting'); expect(s[1]).toContain('file zz99…'); expect(s[1]).toContain('held'); expect(s[1]).not.toContain('left'); expectScreen(s).toMatchSnapshot();
  });
  it('the countdown follows now; an empty list says so; a chip is one line', async () => {
    expect((await shot(<LockChip lock={lock()} now={T + 11_001} member={who} />, 80, 5))[0]).toContain('1s left'); expect((await shot(<LockInspector locks={[]} now={T} />, 80, 5))[0]).toContain('No locks held.'); expect(await shot(<LockChip lock={lock()} now={T} member={who} />, 80, 5)).toHaveLength(1);
  });
  for (const tier of ['truecolor', '256', '16', 'none'] as const) it(`${tier}: the text is the same, colour is only extra`, async () => { expect((await shot(<LockChip lock={lock()} now={T} member={who} />, 100, 4, tier))[0]).toContain('! locked src/app.ts · held by Ada · 12s left'); });
});
describe('banner (acceptance 3, 7)', () => {
  it('lists both agent owners, the file, the four actions with their keys, at 80x24 and 120x40', async () => {
    for (const [cols, rows] of [[80, 24], [120, 40]] as const) { const s = await shot(<ConflictBanner conflict={conflict()} onResolve={() => undefined} ownerOf={(a) => (a === 'a1' ? "Ada's agent" : "Ben's agent")} width={cols} />, cols, rows); expect(s[0]).toContain('! conflict in src/app.ts'); expect(s[1]).toContain("between Ada's agent and Ben's agent"); expect(s[2]).toMatch(/w Wait\s+t Take turns\s+b Branch off\s+r Resolve with Cento/); expectScreen(s).toMatchSnapshot(); }
  });
  it('no path means the hmac label, an unknown agent means `an agent`', async () => { const s = await shot(<ConflictBanner conflict={conflict('c', { displayPaths: undefined })} onResolve={() => undefined} />, 80, 6); expect(s[0]).toContain('file ab12…'); expect(s[1]).toContain('between an agent'); });
  it('at most two banners; the rest fold into +N more', async () => {
    const s = await shot(<ConflictStack conflicts={[conflict('1'), conflict('2'), conflict('3'), conflict('4')]} onResolve={() => undefined} />, 80, 24); expect(s.filter((l) => l.includes('! conflict in'))).toHaveLength(2); expect(s.at(-1)).toContain('+2 more'); expectScreen(s).toMatchSnapshot();
  });
});
