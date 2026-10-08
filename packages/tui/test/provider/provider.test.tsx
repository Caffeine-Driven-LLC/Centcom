import React from 'react';
import { renderToString } from 'ink';
import { describe, expect, it } from 'vitest';
import { GuestComposerNotice, GuestSpendBanner, MESSAGES, RunsOnChip, SubscriptionGateDialog, guestComposerNotice, guestSpendLine, runsOnChip } from '../../src/provider/index.js';

const strip = (s: string) => s.replace(/\x1b\[[0-9;]*m/g, ''); const text = (l: { t: string }[] | undefined) => (l ?? []).map((s) => s.t).join('');
describe('who-pays pieces', () => {
  it('the runs-on chip: text, dim for the viewer, 40 columns at most', () => {
    expect(text(runsOnChip({ owner: 'Maya', provider: 'anthropic' }))).toBe('runs on Maya · anthropic'); expect(runsOnChip({ owner: 'Maya', provider: 'anthropic', viewerPays: true })[0]).toMatchObject({ c: 'text.muted' }); expect(runsOnChip({ owner: 'Maya', provider: 'anthropic', color: 'accent.primary' as never })[0]!.c).toBe('accent.primary');
    const long = text(runsOnChip({ owner: 'M'.repeat(60), provider: 'anthropic' })); expect(long.length).toBeLessThanOrEqual(40); expect(long.endsWith(' · anthropic')).toBe(true); expect(strip(renderToString(<RunsOnChip owner="Maya" provider="openai" />))).toContain('runs on Maya · openai');
  });
  it('the guest composer notice', () => { expect(text(guestComposerNotice({ host: 'Maya' }))).toBe("Your prompt will run on Maya's account"); expect(strip(renderToString(<GuestComposerNotice host="Maya" />))).toContain("Your prompt will run on Maya's account"); });
  it('the guest spend banner: counts, singular, hidden at 0, paused text', () => {
    expect(text(guestSpendLine({ count: 2, provider: 'anthropic', paused: false }))).toContain('2 guests can spend your Anthropic usage'); expect(text(guestSpendLine({ count: 1, provider: 'openai', paused: false }))).toContain('1 guest can spend your OpenAI usage'); expect(guestSpendLine({ count: 0, provider: 'anthropic', paused: false })).toBeUndefined(); expect(text(guestSpendLine({ count: 2, provider: 'anthropic', paused: true }))).toContain('Guests paused');
    const out = (c: number, p: boolean) => strip(renderToString(<GuestSpendBanner count={c} provider="anthropic" paused={p} onPause={() => undefined} onResume={() => undefined} active={false} />)); expect(out(2, false)).toContain('2 guests can spend your Anthropic usage'); expect(out(0, false)).toBe(''); expect(out(2, true)).toContain('Guests paused');
  });
  it('the dialog text comes from the message table', () => { const o = strip(renderToString(<SubscriptionGateDialog engine="Claude Code" onConfirm={() => undefined} onCancel={() => undefined} />)); expect(o).toContain('Share your Claude Code login'); expect(o).toContain("YOUR Claude Code login"); expect(o).toContain('[y] yes'); expect(Object.keys(MESSAGES).every((k) => k.startsWith('provider.'))).toBe(true); });
});
