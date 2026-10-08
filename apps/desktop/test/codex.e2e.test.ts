import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

/** The app's local session service driving the mock Codex, the way a window would (messages in, messages out). */
const BIN = resolve(__dirname, '../../../tools/codex/bin/codex');
let svc: import('../src/local/service.js').LocalService; const got: any[] = []; let win: { handle(m: unknown): Promise<void>; detach(): void }; let proj: string;
const until = async (f: () => boolean, ms = 15000) => { const t0 = Date.now(); while (!f()) { if (Date.now() - t0 > ms) throw new Error('timeout; items: ' + JSON.stringify(items().slice(-4)).slice(0, 900)); await new Promise((r) => setTimeout(r, 20)); } };
const lastState = (): any => [...got].reverse().find((m) => m.t === 'state');
const items = (): any[] => lastState()?.order.map((id: string) => got.flatMap((m) => (m.t === 'state' ? m.changed : [])).reverse().find((i: any) => i.id === id)).filter(Boolean) ?? [];
beforeAll(async () => {
  const home = mkdtempSync(join(tmpdir(), 'cc-e2e-home-')); process.env.HOME = home; process.env.USERPROFILE = home; process.env.CENTCOM_CODEX_BIN = BIN; process.env.MOCK_CODEX_HOME = join(home, 'mock'); proj = mkdtempSync(join(tmpdir(), 'cc-e2e-proj-'));
  const { LocalService } = await import('../src/local/service.js'); svc = new LocalService({ home, cwd: proj }); win = svc.attach('w', (m) => got.push(m));
});
afterAll(() => { win?.detach(); svc?.shutdown(); });
describe('Codex in the app, end to end on the mock', () => {
  it('the launcher sees Codex as installed and signed in', async () => { await win.handle({ t: 'hello' }); await until(() => got.some((m) => m.t === 'launcher')); expect(got.find((m) => m.t === 'launcher').codex).toMatchObject({ installed: true, signedIn: 'yes' }); });
  it('open a folder with Codex, chat, then run a command through an approval', async () => {
    await win.handle({ t: 'open', dir: proj, engine: 'codex' }); await until(() => got.some((m) => m.t === 'opened'));
    await win.handle({ t: 'submit', text: 'hello codex' }); await until(() => items().some((i) => i.kind === 'assistant' && i.done && i.text.includes('You said: hello codex')));
    await win.handle({ t: 'submit', text: 'run: echo from-the-app' }); await until(() => (lastState()?.state.approvals.length ?? 0) > 0);
    expect(lastState().state.approvals[0]).toMatchObject({ tool: 'Bash', command: 'echo from-the-app', risk: 'low' });
    await win.handle({ t: 'approve', decision: 'approve' }); await until(() => items().some((i) => i.kind === 'tool' && i.status === 'ok')); expect(items().find((i) => i.kind === 'tool')).toMatchObject({ name: 'Bash', result: 'from-the-app' });
    await until(() => lastState().state.busy === false);
  }, 30_000);
  it('lists the account\'s models with their efforts, sets an effort, compacts', async () => {
    await win.handle({ t: 'models' }); await until(() => got.some((m) => m.t === 'models')); const ms = got.find((m) => m.t === 'models').models; expect(ms.map((x: any) => x.id)).toEqual(['mock-sol', 'mock-luna']); expect(ms[0]).toMatchObject({ efforts: ['low', 'medium', 'high'], isDefault: true });
    await win.handle({ t: 'setEffort', effort: 'high' }); await until(() => lastState().state.toasts.some((t: any) => /effort: high/i.test(t.text)));
    await win.handle({ t: 'compact' }); await until(() => items().some((i) => i.kind === 'notice' && /compact/i.test(i.text)), 15000); await until(() => lastState().state.busy === false);
  }, 30_000);
  it('Stop ends a long command for real, and the next message works', async () => {
    await win.handle({ t: 'setMode', mode: 'bypassPermissions' }); await win.handle({ t: 'submit', text: 'sleep 40' }); await until(() => lastState().state.busy === true && items().some((i) => i.kind === 'tool' && i.status === 'running'));
    await win.handle({ t: 'interrupt' }); await until(() => lastState().state.busy === false, 20000);
    await win.handle({ t: 'submit', text: 'still there?' }); await until(() => items().some((i) => i.kind === 'assistant' && i.done && i.text.includes('You said: still there?')));
  }, 60_000);
  it('closing the project ends the session', async () => { await win.handle({ t: 'close' }); await until(() => got.some((m) => m.t === 'closed')); });
});
