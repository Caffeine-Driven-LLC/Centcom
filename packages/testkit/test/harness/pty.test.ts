import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';
import { PtyHarness, livePtys } from '../../src/index.js';

const fx = (n: string) => fileURLToPath(new URL(`../../src/harness/__fixtures__/${n}`, import.meta.url)); const opened: PtyHarness[] = [];
const spawnFx = async (n: string, o: Parameters<typeof PtyHarness.spawn>[2] = {}) => { const p = await PtyHarness.spawn(process.execPath, [fx(n)], o); opened.push(p); return p; };
afterEach(async () => { await Promise.all(opened.splice(0).map((p) => p.kill())); });

describe('PtyHarness (acceptance 3, 4)', () => {
  it('types at a program and waits for its answer in under 2 s', async () => {
    const t0 = Date.now(); const p = await spawnFx('echo.js'); await p.waitForText('ready'); p.send('hello\r'); await p.waitForText('echo: hello'); expect(Date.now() - t0).toBeLessThan(2000);
    p.send('quit\r'); expect(await p.waitForExit()).toBe(7); expect(p.exitCode).toBe(7);
  });
  it('waitForText rejects after the given time with the screen in the message, environment values removed', async () => {
    const p = await spawnFx('env.js', { env: { TEST_SECRET_VALUE: 'sup3r-secret-token' } }); await p.waitForText('secret='); const t0 = Date.now(); let msg = ''; await p.waitForText('never', 300).catch((e: Error) => { msg = e.message; }); const dt = Date.now() - t0;
    expect(dt).toBeGreaterThanOrEqual(295); expect(dt).toBeLessThan(600); expect(msg).toContain('timed out after 300 ms'); expect(msg).toContain('secret='); expect(msg).not.toContain('sup3r-secret-token'); expect(msg).toContain('[env]');
  });
  it('screen() has plain text rows, 100x30 by default, and cells() report exact colours and attributes', async () => {
    const p = await spawnFx('color.js'); await p.waitForText('size'); const rows = p.screen(); expect(rows).toHaveLength(30); expect(rows[0]).toBe('TRUE RED256 BOLD GREENBG'); expect(rows[1]).toBe('size 100x30 term=xterm-256color color=truecolor');
    const cells = p.cells(); expect(cells).toHaveLength(30); expect(cells.every((r) => r.length === 100)).toBe(true); expect(cells[0]![0]).toMatchObject({ ch: 'T', fg: '#123456' }); expect(cells[0]![5]).toMatchObject({ ch: 'R', fg: '#ff0000' }); expect(cells[0]![12]).toMatchObject({ ch: 'B', bold: true }); expect(cells[0]![17]).toMatchObject({ ch: 'G', bg: '#008000' }); expect(cells[0]![0]!.bold).toBe(false);
  });
  it('resize changes the size the program sees and the emulator', async () => { const p = await spawnFx('color.js', { cols: 60, rows: 12 }); await p.waitForText('size 60x12'); expect(p.screen()).toHaveLength(12); p.resize(80, 20); await p.waitForText('resized 80x20'); expect(p.screen()).toHaveLength(20); });
  it('keys are sent as the terminal would send them', async () => { const p = await PtyHarness.spawn('cat', []); opened.push(p); p.send('abc'); p.press('enter'); await p.waitForText('abc'); p.press('ctrl-c'); expect(await p.waitForExit()).not.toBe(0); });
  it('each run gets its own home, config and state folders, removed when the program ends', async () => {
    const p = await spawnFx('env.js'); await p.waitForText('state='); const t = p.screen().join('\n'); const [home, config, state] = ['home', 'config', 'state'].map((k) => new RegExp(`${k}=(\\S+)`).exec(t)![1]!) as [string, string, string]; expect(home).not.toBe(process.env.HOME); for (const d of [home, config, state]) { expect(d).toContain('centcom-pty-'); expect(existsSync(d)).toBe(true); }
    await p.kill(); for (const d of [home, config, state]) expect(existsSync(d)).toBe(false);
  });
  it('a program that cannot start exits 127; leaves no child processes behind (leak check)', async () => { const p = await PtyHarness.spawn('/no/such/program', []); expect(await p.waitForExit()).toBe(127); expect(livePtys()).toBe(0); const q = await spawnFx('echo.js'); expect(livePtys()).toBe(1); await q.kill(); expect(livePtys()).toBe(0); });
});
