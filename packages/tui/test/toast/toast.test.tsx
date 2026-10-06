import React from 'react';
import { renderToString } from 'ink';
import { describe, expect, it } from 'vitest';
import { actions } from '../../src/keys/actions.js';
import { NOTICES, clean, createToastController, noticeToToast, toastText, ToastView, type Toast } from '../../src/toast/index.js';

/** A clock that only moves when told. */
function clock() {
  let t = 0; const timers: { at: number; f: () => void; id: number }[] = []; let n = 0;
  return { now: () => t, setTimeout: (f: () => void, ms: number) => { const id = ++n; timers.push({ at: t + ms, f, id }); return id; }, clearTimeout: (h: unknown) => { const i = timers.findIndex((x) => x.id === h); if (i >= 0) timers.splice(i, 1); },
    advance(ms: number) { const end = t + ms; for (;;) { timers.sort((a, b) => a.at - b.at); const x = timers[0]; if (!x || x.at > end) break; timers.shift(); t = x.at; x.f(); } t = end; } };
}
const make = (max?: number) => { const c = clock(); const dismissed: { id: string; by: string }[] = []; const ctl = createToastController({ clock: c, max, onDismissed: (t, by) => dismissed.push({ id: t.id, by }) }); const seen: (string | null)[] = []; ctl.subscribe((t) => seen.push(t ? t.text : null)); return { c, ctl, dismissed, seen }; };
const ctx = { now: new Date('2026-10-06T12:00:00Z'), locale: 'en-US' };

describe('toast controller', () => {
  it('a toast stays 4 s then goes; two in a row show one after the other', () => {
    const { c, ctl } = make(); ctl.show({ level: 'success', text: 'one' }); c.advance(50); ctl.show({ level: 'success', text: 'two' }); expect(ctl.current()!.text).toBe('one');
    c.advance(3949); expect(ctl.current()!.text).toBe('one'); c.advance(2); expect(ctl.current()!.text).toBe('two'); c.advance(4000); expect(ctl.current()).toBeNull();
  });
  it('an error replaces a visible info at once; the info comes back if its time has not run out', () => {
    const { c, ctl } = make(); ctl.show({ level: 'info', text: 'fyi' }); c.advance(1000); ctl.show({ level: 'warn', text: 'careful' }); expect(ctl.current()!.text).toBe('careful');
    ctl.show({ level: 'error', text: 'broken' }); expect(ctl.current()!.text).toBe('broken'); c.advance(10_000); expect(ctl.current()!.text).toBe('broken'); ctl.dismiss(); expect(ctl.current()!.text).toBe('careful');
    const b = make(); b.ctl.show({ level: 'info', text: 'fyi' }); b.c.advance(1000); b.ctl.show({ level: 'error', text: 'broken', ttlMs: 500 }); b.ctl.dismiss(); expect(b.ctl.current()!.text).toBe('fyi'); b.c.advance(3000); expect(b.ctl.current()).toBeNull();
  });
  it('anything with an action never expires; dismissing it says so', () => {
    const { c, ctl, dismissed } = make(); const id = ctl.show({ level: 'warn', text: 'upgrade?', actions: [{ key: 'u', label: 'upgrade', id: 'billing.upgrade' }] }); c.advance(60_000); expect(ctl.current()!.id).toBe(id); ctl.dismiss(); expect(ctl.current()).toBeNull(); expect(dismissed).toEqual([{ id, by: 'user' }]);
    ctl.show({ level: 'error', text: 'bad' }); c.advance(60_000); expect(ctl.current()!.text).toBe('bad');
  });
  it('the same key three times in 10 s is one toast (x3)', () => {
    const { c, ctl } = make(); for (let i = 0; i < 3; i++) { ctl.show({ level: 'info', text: 'Reconnecting', key: 'net' }); c.advance(3000); } expect(toastText(ctl.current()!)).toBe('Reconnecting (x3)'); expect(ctl.pending()).toHaveLength(0);
  });
  it('25 rapid infos keep 20 queued (the newest); warnings and errors are never dropped', () => {
    const { ctl } = make(); for (let i = 0; i < 25; i++) ctl.show({ level: 'info', text: `i${i}` }); expect(ctl.pending().map((t) => t.text)).toEqual(Array.from({ length: 20 }, (_, i) => `i${i + 5}`));
    const b = make(); b.ctl.show({ level: 'info', text: 'first' }); for (let i = 0; i < 5; i++) b.ctl.show({ level: 'warn', text: `w${i}` }); for (let i = 0; i < 30; i++) b.ctl.show({ level: 'info', text: `i${i}` });
    expect(b.ctl.pending().filter((t) => t.level === 'warn' || t.level === 'error')).toHaveLength(4); /* w0 took the screen; the other four wait */ expect(b.ctl.current()!.text).toBe('w0');
  });
  it('unsubscribe stops updates', () => { const { ctl, seen } = make(); const n = seen.length; const off = ctl.subscribe(() => undefined); off(); ctl.show({ level: 'info', text: 'x' }); expect(seen.length).toBeGreaterThan(n); });
});

describe('notices', () => {
  it('usage_warning and quota_reached', () => {
    expect(noticeToToast({ code: 'usage_warning', level: 'warn', params: { pct: 82, resets_at: '2026-11-01T00:00:00.000Z' } }, ctx)).toMatchObject({ level: 'warn', text: "Usage is at 82% of this month's quota. Agents pause at 100%." });
    const q = noticeToToast({ code: 'quota_reached', level: 'error', params: { resets_at: '2026-11-01T12:00:00.000Z' } }, { ...ctx, locale: 'en-US' }); expect(q.level).toBe('error'); expect(q.text).toMatch(/Nov 1, 2026/); expect(q.actions?.length).toBe(1);
    const c = make(); c.ctl.show(q); c.c.advance(60_000); expect(c.ctl.current()).not.toBeNull();
  });
  it('all 7 codes have their own message; an unknown code or hostile params give the generic one or clean text', () => {
    for (const code of ['usage_warning', 'quota_reached', 'plan_changed', 'member_limit_near', 'maintenance_soon', 'client_update_available', 'history_retention_changed']) { expect(Object.keys(NOTICES)).toContain(code); const t = noticeToToast({ code, level: 'info', params: { pct: 5, plan: 'Pro', members: 4, limit: 5, minutes: 10, version: '1.2.3', days: 30 } }, ctx); expect(t.text).not.toBe('Notice received.'); }
    expect(noticeToToast({ code: 'nope', level: 'warn', params: { text: 'evil' } }, ctx).text).toBe('Notice received.'); expect(noticeToToast({ code: '__proto__', level: 'info', params: {} }, ctx).text).toBe('Notice received.');
    expect(noticeToToast({ code: 'client_update_available', level: 'info', params: { version: '1.0\u001b[31m evil' } }, ctx).text).not.toMatch(/\u001b| /); expect(clean('a\nb\u0007c')).toBe('abc');
  });
});

describe('rendering', () => {
  const toast = (level: Toast['level'], text: string): Toast => ({ id: 't', level, text, count: 1, expiresAt: null });
  const strip = (s: string) => s.replace(/\u001b\[[0-9;]*m/g, '');
  it('the glyph carries the level, in ASCII too; no ANSI without colour', () => {
    const o = (l: Toast['level'], u = true) => strip(renderToString(<ToastView toast={toast(l, 'hello')} width={40} unicode={u} />, { columns: 40 }));
    expect([o('success'), o('warn'), o('error'), o('info')].map((s) => s.trim()[0])).toEqual(['✓', '!', '✗', 'i']); expect(o('success', false).trim()[0]).toBe('+'); expect(o('error', false).trim()[0]).toBe('x');
  });
  it('a long toast is cut with … and never wraps; actions show their keys', () => {
    const out = strip(renderToString(<ToastView toast={{ ...toast('info', 'x'.repeat(200)), actions: [{ key: 'u', label: 'update', id: 'update.show' }] }} width={40} />, { columns: 40 })).split('\n').filter(Boolean); expect(out).toHaveLength(1); expect(out[0]).toContain('…'); expect(out[0]).toContain('[u] update');
  });
  it('esc dismisses in the toast context and ctrl+y anywhere', () => { const a = actions().find((x) => x.id === 'toast.dismiss')!; expect(a.defaults).toEqual([{ key: 'esc', context: 'toast' }, { key: 'ctrl+y', context: 'global' }]); });
});
