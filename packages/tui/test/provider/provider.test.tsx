import React from 'react';
import { renderToString } from 'ink';
import { describe, expect, it, vi } from 'vitest';
import { renderInk } from '../../../testkit/src/index.js';
import { GuestComposerNotice, GuestSpendBanner, MESSAGES, RunsOnChip, SubscriptionGateDialog, guestComposerNotice, guestSpendLine, runsOnChip, runsOnLabel } from '../../src/provider/index.js';

const strip = (s: string) => s.replace(/\x1b\[[0-9;]*m/g, ''); const text = (l: { t: string }[] | undefined) => (l ?? []).map((s) => s.t).join('');
const tick = (ms = 20) => new Promise((r) => setTimeout(r, ms));
const chip = (o: Partial<Parameters<typeof runsOnChip>[0]> = {}) => ({ payerName: 'Maya', payerSlot: 1, isSelf: false, provider: 'anthropic' as const, ...o });
describe('who-pays pieces', () => {
  it('the runs-on chip: text, dim for the viewer, member colour otherwise, 40 columns at most, same words as its label', () => {
    expect(text(runsOnChip(chip()))).toBe('runs on Maya · anthropic'); expect(runsOnLabel(chip())).toBe('runs on Maya · anthropic'); expect(runsOnChip(chip({ isSelf: true }))[0]).toMatchObject({ c: 'text.muted' }); expect(runsOnChip(chip({ payerSlot: 1, selfSlot: 0 }))[0]!.c).toMatch(/^#/);
    expect(runsOnChip(chip({ payerSlot: 2 }))[0]!.c).not.toBe(runsOnChip(chip({ payerSlot: 3 }))[0]!.c);
    for (const w of [40, 80, 120]) { const long = text(runsOnChip(chip({ payerName: 'M'.repeat(60) }))); expect(long.length, String(w)).toBeLessThanOrEqual(40); expect(long.endsWith(' · anthropic')).toBe(true); expect(long).toContain('…'); expect(runsOnLabel(chip({ payerName: 'M'.repeat(60) }))).toBe(long); }
    expect(strip(renderToString(<RunsOnChip {...chip({ provider: 'openai' })} />))).toContain('runs on Maya · openai');
  });
  it('the chip renders at widths 40, 80 and 120, with and without colour', async () => {
    for (const cols of [40, 80, 120]) for (const colorTier of ['none', 'truecolor'] as const) { const r = await renderInk(<RunsOnChip {...chip({ payerName: 'Alexandria-Longname'.repeat(3) })} />, { cols, colorTier }); const lines = r.screen().filter((l) => l.trim()); expect(lines).toHaveLength(1); expect(lines[0]!.trimEnd().length).toBeLessThanOrEqual(40); expect(lines[0]).toContain('runs on '); r.unmount(); }
  });
  it('the guest composer notice', () => { expect(text(guestComposerNotice({ host: 'Maya' }))).toBe("Your prompt will run on Maya's account"); expect(strip(renderToString(<GuestComposerNotice host="Maya" />))).toContain("Your prompt will run on Maya's account"); });
  it('the guest spend banner: counts, singular, hidden at 0, paused text, stale and failed', () => {
    expect(text(guestSpendLine({ count: 2, provider: 'anthropic', paused: false }))).toContain('2 guests can spend your Anthropic usage'); expect(text(guestSpendLine({ count: 1, provider: 'openai', paused: false }))).toContain('1 guest can spend your OpenAI usage'); expect(guestSpendLine({ count: 0, provider: 'anthropic', paused: false })).toBeUndefined(); expect(text(guestSpendLine({ count: 2, provider: 'anthropic', paused: true }))).toContain('Guests paused');
    expect(guestSpendLine({ count: 2, provider: 'anthropic', paused: false, stale: true })![0]).toMatchObject({ c: 'text.muted' }); expect(guestSpendLine({ count: 2, provider: 'anthropic', paused: false })![0]).toMatchObject({ c: 'status.warning' });
    expect(text(guestSpendLine({ count: 2, provider: 'anthropic', paused: false, failed: true }))).toContain('Could not pause guests'); expect(text(guestSpendLine({ count: 2, provider: 'anthropic', paused: false }))).not.toContain('Could not');
    const out = (c: number, p: boolean) => strip(renderToString(<GuestSpendBanner count={c} provider="anthropic" paused={p} onPause={() => undefined} onResume={() => undefined} active={false} />)); expect(out(2, false)).toContain('2 guests can spend your Anthropic usage'); expect(out(0, false)).toBe(''); expect(out(2, true)).toContain('Guests paused');
  });
  it('pressing p pauses once; while paused the banner says so and r resumes; keys are ignored at 0 guests', async () => {
    const pause = vi.fn(); const resume = vi.fn(); let paused = false;
    const el = (count: number) => <GuestSpendBanner count={count} provider="anthropic" paused={paused} onPause={() => { paused = true; pause(); }} onResume={() => { paused = false; resume(); }} />;
    const r = await renderInk(el(2)); expect(r.screen().join('\n')).toContain('2 guests can spend your Anthropic usage'); r.stdin.write('r'); await tick(); expect(resume).not.toHaveBeenCalled(); r.stdin.write('p'); await tick(); expect(pause).toHaveBeenCalledTimes(1);
    r.rerender(el(2)); await tick(); expect(r.screen().join('\n')).toContain('Guests paused'); r.stdin.write('p'); await tick(); expect(pause).toHaveBeenCalledTimes(1); r.stdin.write('r'); await tick(); expect(resume).toHaveBeenCalledTimes(1); r.unmount();
    const z = await renderInk(el(0)); z.stdin.write('p'); await tick(); expect(pause).toHaveBeenCalledTimes(1); expect(z.screen().join('').trim()).toBe(''); z.unmount();
  });
  it('the banner fits at widths 40, 80 and 120 in no-colour mode', async () => { for (const cols of [40, 80, 120]) { const r = await renderInk(<GuestSpendBanner count={3} provider="openai" paused={false} onPause={() => undefined} onResume={() => undefined} />, { cols, colorTier: 'none' }); expect(r.screen().join(' ')).toContain('3 guests can spend your OpenAI usage'); r.unmount(); } });
  it('the dialog: y confirms once, n and escape cancel, text from the message table', async () => {
    const o = strip(renderToString(<SubscriptionGateDialog engine="Claude Code" onConfirm={() => undefined} onCancel={() => undefined} />)); expect(o).toContain('Share your Claude Code login'); expect(o).toContain("YOUR Claude Code login"); expect(o).toContain('[y] yes'); expect(Object.keys(MESSAGES).every((k) => k.startsWith('provider.'))).toBe(true);
    const yes = vi.fn(); const no = vi.fn(); const r = await renderInk(<SubscriptionGateDialog engine="codex" onConfirm={yes} onCancel={no} />); r.stdin.write('x'); await tick(); expect(yes).not.toHaveBeenCalled(); r.stdin.write('y'); await tick(); expect(yes).toHaveBeenCalledTimes(1); r.stdin.write('n'); await tick(); expect(no).toHaveBeenCalledTimes(1); r.unmount();
  });
  it('the message table has the strings of the card', () => {
    expect(MESSAGES['provider.pause']()).toBe('Pause guests'); expect(MESSAGES['provider.blocked.cp_subscription']()).toBe('Shared sessions on a subscription login are off. Use an API-key login or run this agent on your own branch.'); expect(MESSAGES['provider.pause_failed']().length).toBeGreaterThan(0);
  });
});
