/** `centcom skills status|install|update|remove [--scope project|user] [--engine claude|codex] [--yes]`: the bundled skills pack as plain files. The diff is always printed first; nothing is written without a yes. */
import { homedir } from 'node:os';
import { createInterface } from 'node:readline';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createSkillsInstaller, nodeSkillFs, type EngineId } from '@centcom/agent';

const BUNDLED = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', '..', '..', 'packages', 'agent', 'skills');
export interface SkillsIo { out(l: string): void; err(l: string): void; ask(q: string): Promise<string>; cwd: string; home?: string; bundledDir?: string }
export const ttyAsk = (q: string): Promise<string> => new Promise((res) => { const rl = createInterface({ input: process.stdin, output: process.stdout }); rl.question(q, (a) => { rl.close(); res(a); }); });
const ENGINE: Record<string, EngineId> = { claude: 'claude-code', 'claude-code': 'claude-code', codex: 'codex' };

export async function runSkills(argv: string[], io: SkillsIo): Promise<number> {
  const [cmd, ...rest] = argv; const val = (f: string) => { const i = rest.indexOf(f); return i >= 0 ? rest[i + 1] : undefined; };
  if (!cmd || !['status', 'install', 'update', 'remove'].includes(cmd)) { io.err('Usage: centcom skills status|install|update|remove [--scope project|user] [--engine claude|codex] [--yes]'); return 2; }
  const scope = (val('--scope') ?? 'project') as 'project' | 'user'; if (scope !== 'project' && scope !== 'user') { io.err('--scope must be project or user'); return 2; }
  const eng = val('--engine'); if (eng && !ENGINE[eng]) { io.err('--engine must be claude or codex'); return 2; } const engines: EngineId[] = eng ? [ENGINE[eng]!] : ['claude-code', 'codex']; const home = io.home ?? homedir();
  const inst = createSkillsInstaller({ fs: nodeSkillFs(), bundledDir: io.bundledDir ?? BUNDLED, engines: { targetDirs: (e, sc, r) => { const base = sc === 'project' ? r ?? io.cwd : home; return e === 'claude-code' ? { skillsDir: join(base, '.claude', 'skills') } : { agentsMd: join(base, 'AGENTS.md') }; } }, recordPath: (sc, r) => join(sc === 'project' ? r ?? io.cwd : home, '.centcom', 'skills-installed.json'), boundary: (sc, r) => (sc === 'project' ? r ?? io.cwd : home) });
  try {
    if (cmd === 'status') { const s = await inst.status(scope, io.cwd, engines); io.out(`Skills pack ${s.pack_version}`); for (const p of s.per) io.out(`  ${p.engine.padEnd(12)} ${p.skill.padEnd(16)} ${p.state}`); return 0; }
    const plan = await inst.plan({ kind: cmd as 'install' | 'update' | 'remove', engines, scope, root: io.cwd });
    if (!plan.changes.length) { io.out('Nothing to do.'); return 0; }
    io.out(plan.diff); /* the diff is shown even with --yes */
    if (scope === 'user' && !(await io.ask('This writes to your user folder, outside this project. Type "user folder" to continue: ')).trim().toLowerCase().startsWith('user folder')) { io.out('Cancelled.'); return 1; }
    if (!rest.includes('--yes') && !/^y(es)?$/i.test((await io.ask('Apply these changes? [y/N] ')).trim())) { io.out('Cancelled. Nothing was written.'); return 1; }
    const rep = await inst.apply(plan, { accepted: true, planHash: plan.planHash }); io.out(`Written ${rep.written.length}, removed ${rep.deleted.length}${rep.skipped.length ? `, left alone ${rep.skipped.length} you edited` : ''}.`); for (const s of rep.skipped) io.out(`  left alone: ${s}`); return 0;
  } catch (e) { io.err(String((e as Error).message ?? e)); return 1; }
}
