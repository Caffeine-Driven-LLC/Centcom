/** Workflow lint (line based, no YAML parser needed): actions pinned by full SHA, an explicit permissions block, no pull_request_target that checks out PR code, no secrets echoed. */
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { result, unavailable, type CheckResult, type Finding } from './types.js';
export interface ActionPolicy { /** owners whose actions may be used without being listed one by one */ allowOwners: string[]; allowActions: string[] }
const SHA = /^[0-9a-f]{40}$/;
export function lintWorkflow(path: string, text: string, policy: ActionPolicy): Finding[] {
  const f: Finding[] = []; const lines = text.split('\n'); const at = (i: number) => `${path}:${i + 1}`;
  if (!lines.some((l) => /^permissions:/.test(l))) f.push({ severity: 'high', location: path, message: 'no top-level permissions: block (least privilege must be explicit)' });
  const prt = lines.some((l) => /^\s*pull_request_target\s*:?/.test(l)); let checksOutPr = false;
  lines.forEach((l, i) => {
    const m = /^\s*-?\s*uses:\s*([^\s#]+)/.exec(l);
    if (m) {
      const ref = m[1]!; if (ref.startsWith('./') || ref.startsWith('docker://')) { if (ref.startsWith('docker://') && !/@sha256:[0-9a-f]{64}$/.test(ref)) f.push({ severity: 'high', location: at(i), message: `${ref} is not pinned by digest` }); return; }
      const [name, version = ''] = ref.split('@'); if (!SHA.test(version)) f.push({ severity: 'high', location: at(i), message: `${ref} is referenced by tag or branch, not by full commit SHA` });
      const owner = name!.split('/')[0]!; if (!policy.allowOwners.includes(owner) && !policy.allowActions.includes(name!)) f.push({ severity: 'high', location: at(i), message: `${name} is not on the action allow-list` });
      if (/actions\/checkout/.test(name!)) { const block = lines.slice(i, i + 8).join('\n'); if (/ref:\s*\$\{\{\s*github\.event\.pull_request\.head/.test(block)) checksOutPr = true; }
    }
    if (/\becho\b[^\n]*\$\{\{\s*secrets\./.test(l)) f.push({ severity: 'high', location: at(i), message: 'a secret is echoed' });
  });
  if (prt && checksOutPr) f.push({ severity: 'high', location: path, message: 'pull_request_target checks out the pull request code' });
  return f;
}
export function checkWorkflows(root: string, policy: ActionPolicy): CheckResult {
  try { const dir = join(root, '.github', 'workflows'); const f: Finding[] = []; for (const n of readdirSync(dir).filter((x) => /\.ya?ml$/.test(x))) f.push(...lintWorkflow(`.github/workflows/${n}`, readFileSync(join(dir, n), 'utf8'), policy)); return result('workflows', f); } catch (e) { return unavailable('workflows', (e as Error).message); }
}
