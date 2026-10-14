import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';
import { PtyHarness } from '@centcom/testkit';

/** Lane C049, in the real program on a real (pseudo) terminal: `centcom --screen-reader` is plain lines. Not one escape sequence (no colour, no cursor movement, no alternate screen, no mouse mode), no mascot, no box-drawing borders, and a permission question is one line that waits for y, n or a. */
const MAIN = fileURLToPath(new URL('../src/main.tsx', import.meta.url)); const ROOT = fileURLToPath(new URL('../../..', import.meta.url));
const open: PtyHarness[] = []; afterEach(async () => { await Promise.all(open.splice(0).map((p) => p.kill())); });
const ENV = { CENTCOM_NO_UPDATE_CHECK: '1', CENTCOM_NO_REMOTE_FLAGS: '1', CENTCOM_KEYCHAIN: 'memory' };
const start = async (args: string[], env: Record<string, string> = {}) => { const p = await PtyHarness.spawn(process.execPath, ['--import', 'tsx', MAIN, '--demo', ...args], { cwd: ROOT, env: { ...ENV, ...env } }); open.push(p); return p; };

describe('--screen-reader', () => {
  it('prints a scripted session as plain lines: states as sentences, the permission question as a line that waits for an answer, and not one escape sequence', async () => {
    const p = await start(['--screen-reader']); await p.waitForText('Centcom, in screen-reader mode', 30_000); p.send('hello there\r');
    await p.waitForText(/Allow Cento to use Edit: .+\? \[y\/n\/a\]/, 30_000);
    p.send('maybe\r'); await new Promise((r) => setTimeout(r, 400)); expect(p.rawOutput()).not.toMatch(/Tool: Edit[\s\S]*Result: .*edit/i); // nothing is decided by an answer that is not y, n or a
    p.send('n\r'); await p.waitForText(/denied|declined|not allowed|Result:/i, 30_000);
    p.send('\x04'); await p.waitForExit(15_000).catch(() => undefined);
    const raw = p.rawOutput(); expect(raw).not.toContain('\x1b'); expect(raw).toMatch(/^Status: Cento /m); expect(raw).toMatch(/^Tool: Read /m); expect(raw).toMatch(/^Result: /m);
    expect(raw).not.toMatch(/[─-╿▀-▟]/); // no borders, no half blocks (the mascot)
    for (const line of raw.split('\n')) expect(line.length).toBeLessThan(400);
  }, 120_000);
  it('the environment variable does the same, and CENTO_REDUCE_MOTION alone keeps the full screen', async () => {
    const a = await start([], { CENTO_SCREEN_READER: '1' }); await a.waitForText('Centcom, in screen-reader mode', 30_000); a.send('\x04'); await a.waitForExit(15_000).catch(() => undefined); expect(a.rawOutput()).not.toContain('\x1b');
    const b = await start([], { CENTO_REDUCE_MOTION: '1' }); await b.waitForText(/What should we build\?|Ready when you are/, 30_000); expect(b.rawOutput()).toContain('\x1b[?1049h'); // the full-screen interface, motion off
  }, 120_000);
});
