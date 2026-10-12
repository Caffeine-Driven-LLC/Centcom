import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { startMockBackend, type MockBackend } from '../../../packages/testkit/src/index.js';
import { Account } from '@centcom/tui';
import { CollabService } from '../src/local/collab.js';
import { sanitise } from '../src/local/service.js';
import type { JoinedView, ServerMsg } from '../src/local/protocol.js';

let m: MockBackend | undefined; const cleanup: (() => unknown)[] = []; afterEach(async () => { for (const c of cleanup.splice(0).reverse()) await c(); await m?.stop(); m = undefined; });
const instant = { now: () => Date.now(), setTimeout: (f: () => void) => setImmediate(f) as never, clearTimeout: (h: never) => clearImmediate(h as never) } as never;
const until = async (f: () => boolean, ms = 8000) => { const t0 = Date.now(); while (!f()) { if (Date.now() - t0 > ms) throw new Error('timed out waiting'); await new Promise((r) => setTimeout(r, 15)); } };

describe('joining from the desktop app', () => {
  it('refuses what is not a link or id before anything is asked of the server, and says so in words', async () => {
    m = await startMockBackend({ seed: 11 }); const account = await Account.create({ app: 'centcom-desktop', version: '0', baseUrl: m.url, keychain: 'memory', clock: instant, stateDir: mkdtempSync(join(tmpdir(), 'jn-')) });
    const got: ServerMsg[] = []; const svc = new CollabService({ version: '0', broadcast: (x) => got.push(x), openExternal: () => false, makeAccount: async () => account }); cleanup.push(() => svc.leaveJoined());
    await svc.handleJoin({ t: 'join', input: 'hello there' }, (x) => got.push(x)); const last = [...got].reverse().find((x) => x.t === 'joined'); expect(last).toMatchObject({ joined: { state: 'failed', error: expect.stringMatching(/session id or an invite link/) } });
    await svc.handleJoin({ t: 'join', input: 'ses_01KDVDNA00DEVSEED000000001' }, (x) => got.push(x)); const l2 = [...got].reverse().find((x) => x.t === 'joined') as { joined: JoinedView }; expect(l2.joined).toMatchObject({ state: 'failed', error: expect.stringMatching(/Sign in first/) });
    await svc.handleJoin({ t: 'joinedLeave' }, (x) => got.push(x)); expect(got.at(-1)).toEqual({ t: 'joined', joined: null });
  });
  it('the screens may only send a bounded join, ask and leave', () => {
    expect(sanitise({ t: 'join', input: '  ses_x  ', extra: 1 })).toEqual({ t: 'join', input: 'ses_x' }); expect(sanitise({ t: 'join', input: '   ' })).toBeUndefined(); expect(sanitise({ t: 'join', input: 'x'.repeat(3000) })).toBeUndefined();
    expect(sanitise({ t: 'joinedAsk', text: 'add tests' })).toEqual({ t: 'joinedAsk', text: 'add tests' }); expect(sanitise({ t: 'joinedLeave', x: 1 })).toEqual({ t: 'joinedLeave' });
  });
});
