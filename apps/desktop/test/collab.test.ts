import { describe, expect, it } from 'vitest';
import type { Account } from '@centcom/tui';
import { CollabService } from '../src/local/collab.js';
import { isSafeSignInUrl } from '../src/security.js';
import { sanitise } from '../src/local/service.js';
import type { ServerMsg } from '../src/local/protocol.js';

const ME = { id: 'usr_1', name: 'Alice Example', email: 'alice@example.test', plan: 'team' };
function fakeAccount(o: { approve?: boolean; deny?: boolean } = {}) {
  let signedIn = false; const calls: string[] = []; let release: (() => void) | undefined;
  const status = async () => ({ signedIn, persisted: true, api: 'http://localhost:3000', ...(signedIn ? { me: ME } : {}) });
  const account = {
    baseUrl: 'http://localhost:3000', status,
    beginLogin: async () => ({ userCode: 'ABCD-EFGH', verificationUri: 'http://localhost:3000/device', verificationUriComplete: 'http://localhost:3000/device?user_code=ABCD-EFGH', expiresInS: 900,
      wait: (signal?: AbortSignal) => new Promise((resolve, reject) => { signal?.addEventListener('abort', () => reject(new Error('aborted'))); release = () => { if (o.deny) { const e = new Error('denied'); e.name = 'DeviceFlowDeniedError'; reject(e); } else { signedIn = true; resolve(status()); } }; if (o.approve) release(); }) }),
    logout: async () => { signedIn = false; calls.push('logout'); },
  } as unknown as Account;
  return { account, calls, approve: () => release?.() };
}
const rig = (f: ReturnType<typeof fakeAccount>, open = (_u: string, _b: string) => true) => { const all: ServerMsg[] = []; const svc = new CollabService({ version: '0', broadcast: (m) => all.push(m), openExternal: open, makeAccount: async () => f.account }); return { svc, all, send: (m: ServerMsg) => all.push(m) }; };
const tick = () => new Promise((r) => setTimeout(r, 20));

describe('signing in from the desktop app', () => {
  it('reports signed out first, shows the code and opens the browser, then reports who signed in', async () => {
    const f = fakeAccount(); const opened: string[] = []; const r = rig(f, (u) => { opened.push(u); return true; });
    await r.svc.handle({ t: 'account' }, r.send); expect(r.all[0]).toMatchObject({ t: 'account', account: { signedIn: false } });
    const run = r.svc.handle({ t: 'login' }, r.send); await tick();
    expect(r.all.find((m) => m.t === 'login')).toMatchObject({ phase: 'code', userCode: 'ABCD-EFGH', opened: true }); expect(opened).toEqual(['http://localhost:3000/device?user_code=ABCD-EFGH']);
    f.approve(); await run; await tick();
    expect(r.all.some((m) => m.t === 'account' && m.account.signedIn && m.account.me?.email === 'alice@example.test')).toBe(true); expect(r.all.at(-1)).toEqual({ t: 'login', phase: 'done' });
    await r.svc.handle({ t: 'logout' }, r.send); expect(f.calls).toEqual(['logout']); expect(r.all.at(-1)).toMatchObject({ t: 'account', account: { signedIn: false } });
  });
  it('a second login request while one is open shows the same code, and cancel ends it', async () => {
    const f = fakeAccount(); const r = rig(f); const run = r.svc.handle({ t: 'login' }, r.send); await tick(); const n = r.all.filter((m) => m.t === 'login').length;
    await r.svc.handle({ t: 'login' }, r.send); expect(r.all.filter((m) => m.t === 'login').length).toBe(n + 1); expect(r.all.at(-1)).toMatchObject({ phase: 'code', userCode: 'ABCD-EFGH' });
    await r.svc.handle({ t: 'cancelLogin' }, r.send); await run; await tick(); expect(r.all.at(-1)).toEqual({ t: 'login', phase: 'cancelled' });
  });
  it('a declined sign-in says so, and an address that may not be opened is shown for the person to open', async () => {
    const f = fakeAccount({ deny: true }); const r = rig(f, () => false); const run = r.svc.handle({ t: 'login' }, r.send); await tick(); expect(r.all.find((m) => m.t === 'login')).toMatchObject({ phase: 'code', opened: false }); f.approve(); await run; await tick();
    expect(r.all.at(-1)).toMatchObject({ t: 'login', phase: 'failed', error: expect.stringMatching(/declined/) });
  });
  it('only https pages, or the configured local API on loopback, may be opened', () => {
    expect(isSafeSignInUrl('https://centcom.dev/device', 'http://localhost:3000')).toBe(true); expect(isSafeSignInUrl('http://localhost:3000/device?user_code=A', 'http://localhost:3000')).toBe(true);
    expect(isSafeSignInUrl('http://localhost:4000/device', 'http://localhost:3000')).toBe(false); expect(isSafeSignInUrl('http://evil.test/device', 'http://localhost:3000')).toBe(false); expect(isSafeSignInUrl('http://localhost:3000/x', 'https://api.centcom.dev')).toBe(false);
    expect(isSafeSignInUrl('file:///etc/passwd', 'http://localhost:3000')).toBe(false);
  });
  it('the screens may send the account messages and nothing else is let through with them', () => {
    for (const t of ['account', 'login', 'cancelLogin', 'logout']) expect(sanitise({ t, extra: 'x' })).toEqual({ t });
  });
});
