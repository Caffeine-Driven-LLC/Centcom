/** `centcom init`: set up a project once, safely, as often as you like. Writes only the project config, the memory file and `.git/info/exclude`. */
import { join } from 'node:path';
import { appendExclude, missingLines, nodeExcludeFs, type ExcludeFs } from './exclude.js';

export interface ConfigStore { exists(p: string): Promise<boolean>; write(p: string, text: string): Promise<void>; copy(from: string, to: string): Promise<void> }
/** Lane C023's memory files: which memory file the project has, and making one. */
export interface MemoryStore { find(root: string): Promise<string | undefined>; create(root: string): Promise<string> }
export interface CliIo { out(line: string): void; err(line: string): void; isTTY: boolean; confirm(q: string): Promise<boolean> }
export interface InitDeps { cwd: string; config: ConfigStore; memory: MemoryStore; io: CliIo; /** The repository's top folder, or undefined outside git. */ gitRoot(cwd: string): Promise<string | undefined>; /** Where this clone's exclude file is (worktrees have their own git folder). */ excludePath(root: string): Promise<string | undefined>; exclude?: ExcludeFs }
export interface InitOptions { yes?: boolean; force?: boolean; dryRun?: boolean }
export interface InitResult { created: string[]; skipped: string[]; alreadySetUp: boolean; code: 0 | 1 | 2 }
export const EXCLUDE_LINES = ['/.centcom/*', '!/.centcom/config.json'];
export const NOT_GIT = 'Not a git repository. Checkpoints and worktrees need git.';
const DEFAULT_CONFIG = '{}\n';

export async function runInit(d: InitDeps, o: InitOptions = {}): Promise<InitResult> {
  const root = (await d.gitRoot(d.cwd).catch(() => undefined)) ?? d.cwd; const git = root !== d.cwd || (await d.gitRoot(d.cwd).catch(() => undefined)) !== undefined;
  const cfgPath = join(root, '.centcom', 'config.json'); const cfgExists = await d.config.exists(cfgPath); const mem = await d.memory.find(root).catch(() => undefined);
  const exPath = git ? await d.excludePath(root).catch(() => undefined) : undefined; const exMissing = exPath ? await missingLines(exPath, EXCLUDE_LINES, d.exclude ?? nodeExcludeFs).catch(() => EXCLUDE_LINES) : [];
  const plan: string[] = []; const skipped: string[] = [];
  if (!cfgExists) plan.push(`create ${cfgPath}`); else if (o.force) plan.push(`replace ${cfgPath} (the old one is kept as config.json.bak)`); else skipped.push(cfgPath);
  if (!mem) plan.push(`create the project memory file in ${root}`); else skipped.push(mem);
  if (exPath && exMissing.length) plan.push(`add ${exMissing.join(', ')} to ${exPath}`);
  if (!git) d.io.out(NOT_GIT);
  if (!plan.length) { d.io.out('Already set up.'); return { created: [], skipped, alreadySetUp: true, code: 0 }; }
  if (o.dryRun) { d.io.out('This would:'); for (const p of plan) d.io.out(`  ${p}`); return { created: [], skipped, alreadySetUp: false, code: 0 }; }
  if (!o.yes) {
    if (!d.io.isTTY) { d.io.err('Run with --yes to proceed without a prompt.'); return { created: [], skipped, alreadySetUp: false, code: 2 }; }
    d.io.out('Centcom will:'); for (const p of plan) d.io.out(`  ${p}`); if (!(await d.io.confirm('Go ahead?'))) { d.io.out('Nothing changed.'); return { created: [], skipped, alreadySetUp: false, code: 0 }; }
  }
  const created: string[] = []; let failed = false;
  try { if (!cfgExists) { await d.config.write(cfgPath, DEFAULT_CONFIG); created.push(cfgPath); } else if (o.force) { await d.config.copy(cfgPath, cfgPath + '.bak'); await d.config.write(cfgPath, DEFAULT_CONFIG); created.push(cfgPath); } }
  catch (e) { failed = true; d.io.err(`Could not write the project config: ${String((e as Error).message ?? e)}`); }
  if (!mem) { try { created.push(await d.memory.create(root)); } catch (e) { failed = true; d.io.err(`Could not create the memory file: ${String((e as Error).message ?? e)}`); } }
  if (exPath && exMissing.length) { try { await appendExclude(exPath, EXCLUDE_LINES, d.exclude ?? nodeExcludeFs); created.push(exPath); } catch { d.io.err(`Could not update ${exPath}; Centcom's local files may show up in git status.`); } }
  for (const c of created) d.io.out(`${c === exPath ? 'updated' : 'created'} ${c}`); return { created, skipped, alreadySetUp: false, code: failed ? 1 : 0 };
}
