import React from 'react';
import { renderToString } from 'ink';
import { Text } from 'ink';
import { describe, expect, it } from 'vitest';
import { SettingsProvider, blockGap, createSettingsStore, registerSettingsCommands, useDensity, type SettingKey, type SettingsRegistry, type UiSettings } from '../../src/settings/index.js';

function rig(o: { stored?: Partial<UiSettings>; env?: NodeJS.ProcessEnv; failWrite?: boolean } = {}) {
  const written: [SettingKey, unknown][] = []; const toasts: { level: string; text: string }[] = []; const handlers = new Map<string, (a: string) => Promise<void>>();
  const store = createSettingsStore({ stored: o.stored ?? {}, env: o.env ?? {}, persist: async (k, v) => { if (o.failWrite) throw new Error('EROFS'); written.push([k, v]); } });
  const registry: SettingsRegistry = { register: (n, h) => { handlers.set(n, h); return () => handlers.delete(n); } };
  const off = registerSettingsCommands({ registry, store, toast: { show: (t) => toasts.push(t) } });
  return { store, written, toasts, run: (n: string, a = '') => handlers.get(n)!(a), handlers, off };
}

describe('commands', () => {
  it('registers the five commands and can unregister them', () => { const r = rig(); expect([...r.handlers.keys()]).toEqual(['theme', 'mascot', 'spinner', 'motion', 'density']); r.off(); expect(r.handlers.size).toBe(0); });
  it('no argument: value, source and options on one line of at most 80 columns', async () => {
    const r = rig({ stored: { theme: 'dark' } }); await r.run('theme'); expect(r.toasts[0]!.text).toBe('Theme: dark (user config). Options: dark, light, auto, hc.'); expect(r.toasts[0]!.text.length).toBeLessThanOrEqual(80);
    const d = rig(); await d.run('density'); expect(d.toasts[0]!.text).toBe('Density: comfortable (default). Options: comfortable, compact.');
    for (const c of ['mascot', 'spinner', 'motion']) { await d.run(c); expect(d.toasts.at(-1)!.text.length).toBeLessThanOrEqual(110); }
  });
  it('a valid value applies at once, is written to the user config and survives a restart', async () => {
    const r = rig(); const seen: string[] = []; r.store.subscribe((s) => seen.push(s.theme)); await r.run('theme', 'light'); expect(r.store.get().theme).toBe('light'); expect(seen).toEqual(['light']); expect(r.written).toEqual([['theme', 'light']]); expect(r.toasts[0]).toEqual({ level: 'success', text: 'Theme: light.' });
    const restart = createSettingsStore({ stored: { theme: 'light' }, env: {}, persist: async () => undefined }); expect(restart.get().theme).toBe('light');
  });
  it('an unknown value says what to try, changes nothing and writes nothing', async () => {
    const r = rig(); await r.run('theme', 'purple'); expect(r.toasts[0]).toEqual({ level: 'warn', text: 'Unknown theme "purple". Try dark, light, auto or hc.' }); expect(r.store.get().theme).toBe('dark'); expect(r.written).toEqual([]);
    await r.run('density', 'tiny'); expect(r.toasts[1]!.text).toBe('Unknown density "tiny". Try comfortable or compact.');
  });
  it('under CENTO_THEME=dark, /theme light stores light but the shown theme stays dark, and the person is told', async () => {
    const r = rig({ env: { CENTO_THEME: 'dark' } }); await r.run('theme', 'light'); expect(r.store.stored().theme).toBe('light'); expect(r.store.get().theme).toBe('dark'); expect(r.toasts[0]!.text).toBe('Overridden by CENTO_THEME for this session.'); expect(r.written).toEqual([['theme', 'light']]);
    await r.run('theme'); expect(r.toasts[1]!.text).toContain('(env CENTO_THEME)');
  });
  it('/mascot off hides it, /mascot red stores the colour, /motion and /spinner apply', async () => {
    const r = rig(); await r.run('mascot', 'off'); expect(r.store.get().mascot).toBe('off'); await r.run('mascot', 'red'); expect(r.store.get()).toMatchObject({ mascot: 'off', mascotColor: 'red' }); expect(r.written).toEqual([['mascot', 'off'], ['mascotColor', 'red']]);
    await r.run('motion', 'reduced'); await r.run('spinner', 'plain'); expect(r.store.get()).toMatchObject({ motion: 'reduced', spinner: 'plain' });
  });
  it('CENTO_REDUCE_MOTION=1 and CENTO_MASCOT=off override; garbage env values are ignored', () => {
    expect(rig({ env: { CENTO_REDUCE_MOTION: '1', CENTO_MASCOT: 'off' } }).store.get()).toMatchObject({ motion: 'reduced', mascot: 'off' }); expect(rig({ env: { CENTO_THEME: 'purple', CENTO_REDUCE_MOTION: 'x' } }).store.get()).toMatchObject({ theme: 'dark', motion: 'full' });
  });
  it('a failed write keeps the value for the session and says so', async () => {
    const r = rig({ failWrite: true }); await r.run('theme', 'light'); expect(r.store.get().theme).toBe('light'); expect(r.toasts[0]).toEqual({ level: 'warn', text: "Couldn't save this setting. It applies until you quit." });
  });
});

describe('live apply', () => {
  it('density compact removes the blank rows between three blocks (2 rows) in the very next render', async () => {
    const r = rig(); const Blocks = () => { const d = useDensity(); const gap = blockGap(d); return <>{['one', 'two', 'three'].map((t, i) => <Text key={t}>{(i && gap ? '\n'.repeat(gap) : '') + t}</Text>)}</>; };
    const frame = () => renderToString(<SettingsProvider store={r.store}><Blocks /></SettingsProvider>, { columns: 20 }).split('\n').length;
    const before = frame(); await r.run('density', 'compact'); expect(before - frame()).toBe(2); expect([blockGap('comfortable'), blockGap('compact')]).toEqual([1, 0]);
  });
});
