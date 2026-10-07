// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest';
import { allowConsole } from '../../../../packages/testkit/src/vitest/guards.js';
import { acceptInvite, previewInvite } from '../../src/invite/flow.js';
import { takeFragmentKey } from '../../src/invite/fragment.js';
import { fakeHttp } from '../workspace/helpers.js';

const T = 'AbCdEfGhIjKlMnOpQrStUvWxYz0'; const K = 'QUJDREVGR0hJSktMTU5PUFFSU1RVVldYWVo'; /* "ABCDEFGHIJKLMNOPQRSTUVWXYZ" */
describe('the key never leaves memory (acceptance 1; guardrails)', () => {
  it('not in a request, a log line, the address, storage or the server calls, through the whole flow', async () => {
    const logs: string[] = []; allowConsole(); const spies = (['log', 'info', 'warn', 'error', 'debug'] as const).map((m) => vi.spyOn(console, m).mockImplementation((...a: unknown[]) => void logs.push(a.map(String).join(' '))));
    window.history.replaceState(null, '', `/j/${T}#k=${K}`); const key = takeFragmentKey(window.location, window.history); const http = fakeHttp((c) => (c.op === 'getInviteKeyBundle' ? { bundle: 'x' } : { workspace_name: 'A', inviter_name: 'B', role: 'editor', expires_at: 'x' })); await previewInvite(http, T); await acceptInvite(http, T, { key, open: async () => undefined, sleep: async () => undefined, signedIn: true });
    const everything = JSON.stringify(http.calls) + logs.join('\n') + window.location.href + JSON.stringify({ ...localStorage }) + JSON.stringify({ ...sessionStorage }) + document.cookie; expect(everything).not.toContain(K); expect(everything).not.toContain('ABCDEFGH'); expect(http.calls.every((c) => !JSON.stringify(c).includes('k='))).toBe(true); for (const s of spies) s.mockRestore();
  });
  it('the source has no place that sends, stores or logs the key', async () => { const { readFileSync } = await import('node:fs'); const { join } = await import('node:path'); for (const f of ['flow.ts', 'fragment.ts', 'routes.tsx']) { const s = readFileSync(join(process.cwd(), 'apps/web/src/invite', f), 'utf8'); expect(s, f).not.toMatch(/console\.|localStorage|sessionStorage|document\.cookie|fetch\(/); } });
  it('outbound links carry rel noopener noreferrer, and the Referrer-Policy header is no-referrer', async () => { const { readFileSync } = await import('node:fs'); const { join } = await import('node:path'); expect(readFileSync(join(process.cwd(), 'apps/web/public/_headers'), 'utf8')).toContain('Referrer-Policy: no-referrer'); expect(readFileSync(join(process.cwd(), 'apps/web/index.html'), 'utf8')).toContain('name="referrer" content="no-referrer"'); const s = readFileSync(join(process.cwd(), 'apps/web/src/invite/routes.tsx'), 'utf8'); expect(s).not.toMatch(/target="_blank"(?![^>]*noopener)/); });
});
