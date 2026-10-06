import { afterEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_SID, type MockBackend } from '../src/index.js';
import { Peer, start } from './helpers.js';
import { ulid } from './ulid.js';

let m: MockBackend; const peers: Peer[] = [];
afterEach(async () => { vi.restoreAllMocks(); peers.splice(0).forEach((p) => p.close()); await m?.stop(); });
const CT = 'CIPHERTEXTxyzzy123'; const NONCE = 'NonceNonceNonceNonceNonceNonce12'; const SECRET = 'my-secret-prompt-text';

describe('privacy: the mock never keeps or logs content', () => {
  it('frame log, control-plane frames and server logs contain no ct values and no p text of encrypted kinds', async () => {
    const logged: string[] = []; const err = vi.spyOn(process.stderr, 'write').mockImplementation((s: string | Uint8Array) => { logged.push(String(s)); return true; });
    m = await start({ log: (e) => logged.push(JSON.stringify(e)), scenario: 'busy-session' });
    const a = await Peer.open(m, { sid: DEFAULT_SID, name: 'A' }); peers.push(a); await a.until((p) => p.has('sys.welcome'));
    const b = await Peer.open(m, { sid: DEFAULT_SID, name: 'B' }); peers.push(b); await b.until((p) => p.has('sys.welcome'));
    /* sealed kinds, one of them wrongly carrying plaintext in p as well: neither may leak */
    a.send({ v: 1, t: 'event', id: `msg_${ulid(1)}`, k: 'message.user', ct: { alg: 'xchacha20poly1305', kid: 'k1', n: NONCE, c: CT }, sig: 'S'.repeat(86) });
    a.send({ v: 1, t: 'event', id: `msg_${ulid(2)}`, k: 'comment.add', p: { text: SECRET }, ct: { alg: 'xchacha20poly1305', kid: 'k1', n: NONCE, c: CT }, sig: 'S'.repeat(86) });
    a.send({ v: 1, t: 'presence', k: 'presence.cursor', ct: { alg: 'xchacha20poly1305', kid: 'k1', n: NONCE, c: CT }, sig: 'S'.repeat(86) });
    a.ws.send(JSON.stringify({ v: 1, t: 'event', k: 'message.user', p: { text: SECRET }, ct: 'not-an-object' })); /* invalid: its content must not echo into logs either */
    await b.until((p) => p.has('event', 'comment.add')); await m.advance(1000);
    expect(b.of('event', 'message.user').some((f) => f.ct?.c === CT)).toBe(true); /* delivered intact to members */
    const viaHttp = await (await fetch(`${m.httpUrl}/__mock/frames?sid=${DEFAULT_SID}`)).text();
    err.mockRestore();
    const haystacks = { frames: JSON.stringify(m.frames(DEFAULT_SID)), http: viaHttp, logs: logged.join('\n') };
    for (const [where, text] of Object.entries(haystacks)) for (const needle of [CT, NONCE, SECRET, '"ct"', '"p"', '"text"']) expect(text.includes(needle), `${needle} in ${where}`).toBe(false);
    expect(logged.some((l) => l.includes('"event":"frame"'))).toBe(true); /* the logger did run */
    for (const e of m.frames(DEFAULT_SID)) expect(Object.keys(e).sort()).toEqual(expect.arrayContaining(['bytes', 'from', 't', 'ts']));
    for (const e of m.frames(DEFAULT_SID)) for (const k of Object.keys(e)) expect(['seq', 'ts', 't', 'k', 'id', 'from', 'bytes']).toContain(k);
  });
});
