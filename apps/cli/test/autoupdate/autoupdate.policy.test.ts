import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { b64, initCrypto, sodium } from '@centcom/net';
import { KEY_SLOTS, channelSwitch, downgradeDecision, mayAutoUpdate, toastForNotice, toastForNotification, trustedKeys, updateToast } from '../../src/autoupdate/index.js';

describe('policy', () => {
  it('a lower version is refused unless --allow-downgrade; equal is "same"', () => {
    expect(downgradeDecision('1.4.2', '1.4.3', false)).toBe('newer'); expect(downgradeDecision('1.4.2', '1.4.2', false)).toBe('same'); expect(downgradeDecision('1.4.2', '1.4.1', false)).toBe('downgrade_refused'); expect(downgradeDecision('1.4.2', '1.4.1', true)).toBe('downgrade_allowed'); expect(downgradeDecision('1.4.3', '1.4.3-nightly.9', false)).toBe('downgrade_refused');
  });
  it('switching to nightly needs a yes and warns; beta only a note; the same channel nothing', () => {
    expect(channelSwitch({ from: 'stable', to: 'nightly', yes: false })).toMatchObject({ needsConfirm: true, warning: expect.stringContaining('can break') }); expect(channelSwitch({ from: 'stable', to: 'nightly', yes: true })).toMatchObject({ needsConfirm: false, warning: expect.any(String) });
    expect(channelSwitch({ from: 'stable', to: 'beta', yes: false })).toMatchObject({ needsConfirm: false, warning: expect.any(String) }); expect(channelSwitch({ from: 'nightly', to: 'stable', yes: false })).toEqual({ needsConfirm: false }); expect(channelSwitch({ from: 'nightly', to: 'nightly', yes: false })).toEqual({ needsConfirm: false });
  });
  it('auto-update: standalone only, off under CI or update.auto=false, beta and nightly only when chosen', () => {
    const base = { auto: true, method: 'standalone', channel: 'stable', channelChosen: false } as const;
    expect(mayAutoUpdate(base)).toBe(true); expect(mayAutoUpdate({ ...base, auto: false })).toBe(false); expect(mayAutoUpdate({ ...base, ci: true })).toBe(false);
    for (const method of ['npm', 'brew', 'unknown'] as const) expect(mayAutoUpdate({ ...base, method })).toBe(false);
    for (const channel of ['beta', 'nightly'] as const) { expect(mayAutoUpdate({ ...base, channel })).toBe(false); expect(mayAutoUpdate({ ...base, channel, channelChosen: true })).toBe(true); }
  });
});
describe('notices', () => {
  it('"Update available: 1.4.3" from our own check, a sys.notice and a notification; only a valid version and channel are shown', () => {
    expect(updateToast('1.4.3')).toEqual({ level: 'info', text: 'Update available: 1.4.3', detail: 'Run: centcom update' }); expect(updateToast('1.4.3', 'beta').detail).toContain('beta');
    expect(toastForNotice({ code: 'client_update_available', level: 'info', params: { version: '1.4.3', channel: 'stable' } })).toMatchObject({ text: 'Update available: 1.4.3', detail: expect.stringContaining('stable') });
    expect(toastForNotification({ category: 'update_available', params: { version: '1.5.0-beta.2', channel: 'beta' }, action: { type: 'open_update' } })).toMatchObject({ text: 'Update available: 1.5.0-beta.2' });
    expect(toastForNotice({ code: 'client_update_available', params: { version: '1.4.3', channel: '../etc' } })?.detail).toBe('Run: centcom update');
    for (const bad of [{ code: 'client_update_available', params: { version: 'x; rm -rf /' } }, { code: 'client_update_available', params: {} }, { code: 'client_update_available' }, { code: 'usage_warning', params: { version: '1.4.3' } }, null, 'x', 5]) expect(toastForNotice(bad)).toBeUndefined();
    for (const bad of [{ category: 'mention', params: { version: '1.4.3' } }, { category: 'update_available', params: { version: '<b>1</b>' } }, null, 3]) expect(toastForNotification(bad)).toBeUndefined();
  });
  it('a notice only shows a toast: the module has no way to download (it imports nothing but a type)', () => {
    const src = readFileSync(join(__dirname, '../../src/autoupdate/notices.ts'), 'utf8'); expect(src.match(/^import .*$/gm)).toEqual(["import type { Channel } from '@centcom/net';"]);
  });
});
describe('the trusted keys', () => {
  it('there are two slots in one file; empty or malformed slots trust nothing (fail closed)', async () => {
    expect(KEY_SLOTS).toHaveLength(2); expect(KEY_SLOTS.map((k) => k.slot)).toEqual(['primary', 'next']); expect(new Set(KEY_SLOTS.map((k) => k.id)).size).toBe(2);
    expect(trustedKeys().keys.length).toBe(KEY_SLOTS.filter((k) => k.publicKey).length); expect(trustedKeys([{ slot: 'primary', id: 'a', publicKey: '' }, { slot: 'next', id: 'b', publicKey: 'AAAA' }]).keys).toEqual([]);
    await initCrypto(); const k = b64(sodium().crypto_sign_keypair().publicKey); expect(trustedKeys([{ slot: 'primary', id: 'a', publicKey: k }, { slot: 'next', id: 'b', publicKey: '' }]).keys).toEqual([{ id: 'a', publicKey: k }]);
  });
  it('trusted keys are listed only in keys.ts; nothing reads them from a server, the environment or a file', () => {
    const dir = join(__dirname, '../../src/autoupdate'); for (const f of ['startup.ts', 'apply.ts', 'policy.ts', 'schedule.ts']) expect(readFileSync(join(dir, f), 'utf8'), f).not.toMatch(/publicKey|KEY_SLOTS/);
    const main = readFileSync(join(__dirname, '../../src/main.tsx'), 'utf8'); expect(main).toContain('keys: trustedKeys()'); expect(main).not.toContain('PRODUCTION_KEYS'); expect(main).not.toMatch(/CENTCOM_[A-Z_]*KEY/);
  });
});
