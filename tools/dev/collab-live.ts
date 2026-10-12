/**
 * `pnpm dev:collab`: the account and sharing code of the apps (`@centcom/tui` collab) against the local backend, with two brand-new
 * accounts. Needs the backend repo's `pnpm dev:up`, `pnpm dev:api` and `pnpm dev:relay`. Exits 1 when a step fails.
 */
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Account } from '../../packages/tui/src/collab/index.js';
import { api, approveDevice, freshEmail } from './live-browser.js';

const step = (t: string): void => console.log(`\n== ${t}`);
const check = (ok: boolean, t: string): void => { console.log(`${ok ? 'ok  ' : 'FAIL'} ${t}`); if (!ok) process.exitCode = 1; };

export async function signUp(label: string): Promise<{ account: Account; email: string }> {
  const email = freshEmail(label);
  const account = await Account.create({ app: 'centcom-tui', version: '0.1.0', baseUrl: api, keychain: 'memory', stateDir: mkdtempSync(join(tmpdir(), `collab-${label}-`)), deviceName: `${label}-laptop` });
  const login = await account.beginLogin(); const done = login.wait();
  await approveDevice(login.userCode, email); await done;
  return { account, email };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  step('Alice signs up through the device sign-in');
  const alice = await signUp('alice'); const st = await alice.account.status();
  check(st.signedIn && st.me?.email === alice.email, `signed in as ${st.me?.email} (plan ${st.me?.plan}, ${st.me?.workspace?.name ?? 'no workspace'})`);
  const ws = await alice.account.workspaces(); check(ws.length === 1, `one personal workspace: ${ws[0]?.name}`);
  await alice.account.logout(); check(!(await alice.account.status()).signedIn, 'signed out again');
  console.log(process.exitCode === 1 ? '\nFAILED' : '\nOK');
}
