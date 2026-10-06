/** The checks `centcom doctor` runs. Each reports pass, warn or fail with one next step, and never prints a path, token or name. */
import type { CheckResult, DoctorCheck, DoctorContext } from './types.js';

export const NETWORK_TIMEOUT_MS = 3000;
const ok = (summary: string): CheckResult => ({ status: 'pass', summary });
const warn = (summary: string, next_step: string): CheckResult => ({ status: 'warn', summary, next_step });
const fail = (summary: string, next_step: string): CheckResult => ({ status: 'fail', summary, next_step });
const ver = (s: string): number[] => (/(\d+)\.(\d+)(?:\.(\d+))?/.exec(s)?.slice(1).map((x) => Number(x ?? 0)) ?? [0, 0, 0]);
const cmp = (a: number[], b: number[]): number => { for (let i = 0; i < 3; i++) if ((a[i] ?? 0) !== (b[i] ?? 0)) return (a[i] ?? 0) - (b[i] ?? 0); return 0; };

export const node: DoctorCheck = { id: 'node', async run(c) { const v = ver(c.node); return v[0]! >= 22 ? ok(`Node ${c.node.replace(/^v/, '')}`) : fail(`Node ${c.node.replace(/^v/, '')} is too old (needs 22 or newer)`, 'install Node 22 or newer from nodejs.org'); } };
export const os: DoctorCheck = { id: 'os', async run(c) { return ok(`${c.platform} ${c.arch}`); } };
export const terminal: DoctorCheck = { id: 'terminal', async run(c) {
  if (!c.term.isTTY) return { status: 'skip', summary: 'not a terminal (output is piped)' };
  if (c.term.cols < 80 || c.term.rows < 24) return warn(`${c.term.cols}x${c.term.rows} is smaller than 80x24`, 'make the terminal window at least 80 columns by 24 rows');
  if (c.term.tier === 'none' || c.term.tier === '16') return warn(`colour: ${c.term.tier === 'none' ? 'off' : '16 colours'}${c.term.unicode ? '' : ', no unicode'}`, c.term.tier === 'none' ? 'unset NO_COLOR if you want colour' : 'use a terminal that supports 256 colours or truecolor');
  return ok(`${c.term.tier} colour, ${c.term.cols}x${c.term.rows}${c.term.unicode ? '' : ', no unicode'}`);
} };
export const keychain: DoctorCheck = { id: 'keychain', async run(c) {
  const acct = `doctor-${c.now().toString(36)}`;
  try { await c.keychain.set(acct, 'x'); const back = await c.keychain.get(acct); await c.keychain.delete(acct); return back === 'x' ? ok('the OS keychain works') : fail('the OS keychain did not return what was stored', 'unlock your keychain, then run doctor again'); }
  catch { try { await c.keychain.delete(acct); } catch { /* nothing to clean */ } return fail('the OS keychain is not available', c.platform === 'linux' ? 'install a Secret Service provider (for example gnome-keyring or KeePassXC) and start it' : 'unlock your keychain, then run doctor again'); }
} };
export const git: DoctorCheck = { id: 'git', async run(c) { const v = await c.git(); if (!v) return warn('git was not found', 'install git 2.30 or newer'); return cmp(ver(v), [2, 30, 0]) >= 0 ? ok(`git ${ver(v).join('.')}`) : warn(`git ${ver(v).join('.')} is older than 2.30`, 'update git to 2.30 or newer'); } };
export const config: DoctorCheck = { id: 'config', async run(c) {
  const f = `${c.home}/.centcom/config.json`; const r = c.readFile(f); if (!r) return ok('no settings file (defaults are used)');
  try { JSON.parse(r.text); } catch { return fail('the settings file is not valid JSON', 'fix or remove ~/.centcom/config.json'); }
  if (process.platform !== 'win32' && (r.mode & 0o077) !== 0) return warn('the settings file can be read by other users', 'run: chmod 600 ~/.centcom/config.json'); return ok('settings file is valid');
} };
export const healthz: DoctorCheck = { id: 'network', network: true, async run(c) { try { const r = await c.get(`${c.apiBase}/healthz`, { timeoutMs: NETWORK_TIMEOUT_MS }); return r.status >= 200 && r.status < 300 ? ok('the Centcom service answers') : fail(`the Centcom service answered ${r.status}`, 'check status.centcom.dev, then try again'); } catch { return fail('could not reach the Centcom service', 'check your internet connection or proxy (local and LAN use still work)'); } } };
async function status(c: DoctorContext) { return c.get(`${c.apiBase}/v1/status`, { timeoutMs: NETWORK_TIMEOUT_MS }); }
export const versionCheck: DoctorCheck = { id: 'version', network: true, async run(c) {
  try { const r = await status(c); const j = (r.json ?? {}) as { min_client_version?: string; contract_version?: string }; if (r.status !== 200) return { status: 'skip', summary: 'the status endpoint did not answer' };
    if (j.min_client_version && cmp(ver(c.version), ver(j.min_client_version)) < 0) return fail(`this Centcom (${c.version}) is older than the minimum the service accepts (${j.min_client_version})`, 'update Centcom');
    if (j.contract_version && ver(j.contract_version)[0] !== ver(c.contract)[0]) return fail(`this Centcom speaks contract ${c.contract}; the service speaks ${j.contract_version}`, 'update Centcom');
    return ok(`Centcom ${c.version} is accepted (contract ${c.contract})`); } catch { return { status: 'skip', summary: 'could not ask the service (offline)' }; }
} };
export const clock: DoctorCheck = { id: 'clock', network: true, async run(c) {
  try { const t0 = c.now(); const r = await status(c); const d = r.headers.date; const server = d ? Date.parse(d) : NaN; if (!Number.isFinite(server)) return { status: 'skip', summary: 'the service sent no time' };
    const skew = Math.abs(server - (t0 + (c.now() - t0) / 2)) / 1000; if (skew > 60) return fail(`your clock is ${Math.round(skew)} s off`, 'turn on automatic time in your system settings'); if (skew > 30) return warn(`your clock is ${Math.round(skew)} s off`, 'turn on automatic time in your system settings'); return ok(`clock within ${Math.max(1, Math.round(skew))} s of the service`); }
  catch { return { status: 'skip', summary: 'could not ask the service (offline)' }; }
} };
export const ALL_CHECKS: DoctorCheck[] = [node, os, terminal, keychain, git, config, healthz, versionCheck, clock];
