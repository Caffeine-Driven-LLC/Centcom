/**
 * Records real Codex sessions for the adapter's tests. Run it on a machine where `codex` is installed and signed in:
 *
 *   pnpm exec tsx tools/codex/record.ts                 # every scenario, into packages/agent/test/fixtures/providers/codex/
 *   pnpm exec tsx tools/codex/record.ts --only hello    # one scenario
 *   pnpm exec tsx tools/codex/record.ts --bin <path> --out <dir>
 *
 * For each scenario it writes the raw JSON-RPC lines both ways (`*.frames.jsonl`, `->` = Centcom to Codex, `<-` = Codex to Centcom), the normalised events the adapter made of
 * them (`*.events.json`), and one `report.md` listing every method Codex used and whether the adapter understood it. Home folder, user name and the temporary project path are
 * replaced by placeholders, and a file that still matches a secret pattern is not written at all. Nothing here reads Codex's own files or credentials.
 */
import { spawn as nodeSpawn, execFileSync, type ChildProcess } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { homedir, tmpdir, userInfo } from 'node:os';
import { join, resolve } from 'node:path';
import { looksLikeSecret } from '../../packages/protocol/src/index.js';
import { CodexEngine, type ApprovalDecision, type ApprovalRequest, type NormalisedEvent } from '../../packages/agent/src/index.js';

type Frame = { dir: '->' | '<-'; ms: number; line: string };
interface Scenario { name: string; what: string; steps: (s: Driver) => Promise<void>; gate?: (r: ApprovalRequest) => ApprovalDecision; resumeFrom?: string }
interface Driver { send(text: string): Promise<void>; interrupt(afterMs: number): Promise<void>; waitTurn(ms?: number): Promise<void> }

const arg = (n: string) => { const i = process.argv.indexOf(n); return i >= 0 ? process.argv[i + 1] : undefined; };
const BIN = ((b) => (b.includes('/') || b.includes('\\') ? resolve(b) : b))(arg('--bin') ?? 'codex'); const OUT = resolve(arg('--out') ?? 'packages/agent/test/fixtures/providers/codex'); const ONLY = arg('--only'); const TURN_MS = Number(arg('--turn-ms') ?? 180_000);
const KNOWN = new Set(['thread/started', 'turn/started', 'turn/completed', 'item/started', 'item/completed', 'item/agentMessage/delta', 'item/reasoning/summaryTextDelta', 'item/reasoning/textDelta', 'item/commandExecution/outputDelta', 'thread/tokenUsage/updated', 'account/rateLimits/updated', 'error', 'turn/diff/updated', 'turn/plan/updated', 'item/fileChange/outputDelta', 'thread/compacted', 'item/commandExecution/requestApproval', 'item/fileChange/requestApproval']);

const scenarios: Scenario[] = [
  { name: 'hello', what: 'a plain answer, no tools', steps: async (s) => { await s.send('Reply with exactly: Hello from Codex. Do not run any command or edit any file.'); await s.waitTurn(); } },
  { name: 'read', what: 'reads a file (a tool without approval in workspace-write)', steps: async (s) => { await s.send('What is the value of the constant in src/a.ts? Answer in one short sentence.'); await s.waitTurn(); } },
  { name: 'edit-approve', what: 'asks to change a file; Centcom approves', gate: () => ({ decision: 'approve', scope: 'once' }), steps: async (s) => { await s.send('Change the constant in src/a.ts from 1 to 2. Edit only that line.'); await s.waitTurn(); } },
  { name: 'run-deny', what: 'asks to run a command; Centcom denies', gate: () => ({ decision: 'deny', scope: 'once', reason: 'not now' }), steps: async (s) => { await s.send('Run `npm test` in this folder and tell me the result.'); await s.waitTurn(); } },
  { name: 'interrupt', what: 'a long task interrupted after 4 s', steps: async (s) => { await s.send('Count slowly from 1 to 400, one number per line, thinking about each number before writing it.'); await s.interrupt(4000); await s.waitTurn(60_000); } },
  { name: 'resume', what: 'a second session that resumes the thread of `hello`', resumeFrom: 'hello', steps: async (s) => { await s.send('What exact words did I ask you to reply with earlier? Answer with just those words.'); await s.waitTurn(); } },
];

function project(): string {
  const dir = mkdtempSync(join(tmpdir(), 'centcom-codex-rec-')); mkdirSync(join(dir, 'src'));
  writeFileSync(join(dir, 'src/a.ts'), 'export const a = 1;\n'); writeFileSync(join(dir, 'package.json'), JSON.stringify({ name: 'demo', private: true, scripts: { test: 'node -e "console.log(\'1 test passed\')"' } }, null, 2) + '\n');
  try { execFileSync('git', ['init', '-q'], { cwd: dir }); execFileSync('git', ['add', '-A'], { cwd: dir }); execFileSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@t', 'commit', '-q', '-m', 'init'], { cwd: dir }); } catch { /* git is optional here */ }
  return dir;
}
function scrub(text: string, work: string): string {
  let t = text.split(work).join('$WORK'); const home = homedir(); if (home) t = t.split(home).join('$HOME'); const user = userInfo().username; if (user && user.length > 2) t = t.replace(new RegExp(`\\b${user.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'g'), '$USER'); return t;
}
async function record(sc: Scenario, threads: Map<string, string>, report: string[]) {
  const work = project(); const frames: Frame[] = []; const t0 = Date.now(); const events: NormalisedEvent[] = [];
  const spawn = ((cmd: string, args: readonly string[], opts: object) => {
    const child = nodeSpawn(cmd, args as string[], opts as never) as ChildProcess; let buf = '';
    child.stdout?.on('data', (c: Buffer) => { buf += c.toString('utf8'); let i; while ((i = buf.indexOf('\n')) >= 0) { frames.push({ dir: '<-', ms: Date.now() - t0, line: buf.slice(0, i) }); buf = buf.slice(i + 1); } });
    const w = child.stdin!.write.bind(child.stdin); (child.stdin as unknown as { write: (...a: unknown[]) => boolean }).write = (data: unknown, ...rest: unknown[]) => { for (const l of String(data).split('\n').filter(Boolean)) frames.push({ dir: '->', ms: Date.now() - t0, line: l }); return (w as (...a: unknown[]) => boolean)(data, ...rest); };
    return child;
  }) as unknown as typeof nodeSpawn;
  const engine = new CodexEngine({ bin: BIN, spawn }); const approvals: string[] = [];
  const resume = sc.resumeFrom ? threads.get(sc.resumeFrom) : undefined; if (sc.resumeFrom && !resume) { report.push(`- **${sc.name}**: skipped, \`${sc.resumeFrom}\` gave no thread id`); return; }
  const session = await engine.start({ agentId: 'agt_01JREC0000000000000000000' + String(scenarios.indexOf(sc) % 10), cwd: work, permissionMode: 'default', ...(resume ? { resume: { engine_session_id: resume } } : {}), approvalGate: { decide: async (r) => { approvals.push(`${r.tool}: ${r.summary}`); return sc.gate?.(r) ?? { decision: 'deny', scope: 'once' }; } } });
  let turnDone: (() => void) | undefined; const pump = (async () => { for await (const e of session.events) { events.push(e); if (e.type === 'turn.done') turnDone?.(); } })();
  const d: Driver = {
    send: async (text) => { await session.send(text); },
    waitTurn: (ms = TURN_MS) => new Promise<void>((res, rej) => { if (events.some((e) => e.type === 'turn.done' && !(e as { _seen?: boolean })._seen)) { for (const e of events) if (e.type === 'turn.done') (e as { _seen?: boolean })._seen = true; return res(); } const t = setTimeout(() => rej(new Error(`no turn.done within ${ms} ms`)), ms); turnDone = () => { clearTimeout(t); for (const e of events) if (e.type === 'turn.done') (e as { _seen?: boolean })._seen = true; res(); }; }),
    interrupt: async (after) => { await new Promise((r) => setTimeout(r, after)); await session.interrupt(); },
  };
  let error = '';
  try { const t1 = Date.now(); while (!events.some((e) => e.type === 'session.started' || e.type === 'error') && Date.now() - t1 < 30_000) await new Promise((r) => setTimeout(r, 100)); /* the session is up, or has said why not */ await sc.steps(d); } catch (e) { error = String((e as Error).message ?? e); }
  const tid = session.resumeToken(); if (tid) threads.set(sc.name, tid); await session.stop(); await Promise.race([pump, new Promise((r) => setTimeout(r, 3000))]);
  const methods = new Map<string, number>(); for (const f of frames) { try { const j = JSON.parse(f.line) as { method?: string }; if (j.method) methods.set(`${f.dir} ${j.method}`, (methods.get(`${f.dir} ${j.method}`) ?? 0) + 1); } catch { methods.set(`${f.dir} (not JSON)`, (methods.get(`${f.dir} (not JSON)`) ?? 0) + 1); } }
  const framesText = frames.map((f) => JSON.stringify({ ...f, line: scrub(f.line, work) })).join('\n') + '\n'; const eventsText = scrub(JSON.stringify(events.map(({ _seen, ...e }: NormalisedEvent & { _seen?: boolean }) => e), null, 1), work) + '\n';
  const hits = [...framesText.split('\n'), ...eventsText.split('\n')].map((l, i) => (looksLikeSecret(l) ? i + 1 : 0)).filter(Boolean);
  if (hits.length) report.push(`- **${sc.name}**: NOT WRITTEN, ${hits.length} line(s) look like a secret (lines ${hits.slice(0, 5).join(', ')}). Look at them by hand, never commit them.`);
  else { writeFileSync(join(OUT, `real-${sc.name}.frames.jsonl`), framesText); writeFileSync(join(OUT, `real-${sc.name}.events.json`), eventsText); }
  const unknown = [...methods.keys()].filter((k) => k.startsWith('<-') && !KNOWN.has(k.slice(3)) && !/^<- (account|model|config|session|mcpServer|thread\/name|codex\/event)/.test(k));
  report.push(`- **${sc.name}** (${sc.what}): ${frames.length} frames, ${events.length} events, types: ${[...new Set(events.map((e) => e.type))].join(', ')}${approvals.length ? `; approvals asked: ${approvals.length}` : ''}${error ? `; **error: ${scrub(error, work)}**` : ''}`);
  report.push(`  - methods: ${[...methods].map(([k, n]) => `\`${k}\`×${n}`).join(', ')}`); if (unknown.length) report.push(`  - **methods the adapter does not know**: ${unknown.map((k) => `\`${k.slice(3)}\``).join(', ')}`);
  const warn = events.filter((e) => e.type === 'engine.warning' || e.type === 'error').map((e) => scrub(JSON.stringify(e), work)); if (warn.length) report.push(`  - warnings and errors: ${warn.join(' | ')}`);
  rmSync(work, { recursive: true, force: true });
}
async function main() {
  mkdirSync(OUT, { recursive: true }); const report: string[] = [`# Codex recording`, '', `- codex: \`${(() => { try { return execFileSync(BIN, ['--version'], { encoding: 'utf8' }).trim(); } catch { return 'not found'; } })()}\``, `- recorded: ${new Date().toISOString()}`, `- node: ${process.version}, platform: ${process.platform}`, ''];
  const threads = new Map<string, string>();
  for (const sc of scenarios) { if (ONLY && sc.name !== ONLY && !(sc.name === 'resume' && ONLY === 'hello')) continue; process.stderr.write(`recording ${sc.name}...\n`); try { await record(sc, threads, report); } catch (e) { report.push(`- **${sc.name}**: failed to run: ${String((e as Error).message ?? e)}`); } }
  writeFileSync(join(OUT, 'report.md'), report.join('\n') + '\n'); process.stdout.write(report.join('\n') + '\n');
}
void main();
