/** `pnpm audit --prod --audit-level=high`, retried three times; an unreachable service is a `tool_unavailable` failure, never a pass. */
import { spawnSync } from 'node:child_process';
import { result, unavailable, type CheckResult, type Finding } from './types.js';
export type AuditRunner = () => { status: number | null; stdout: string; stderr: string; error?: Error };
export const defaultAudit = (root: string): AuditRunner => () => { const r = spawnSync('pnpm', ['audit', '--prod', '--audit-level=high', '--json'], { cwd: root, encoding: 'utf8', timeout: 120_000, maxBuffer: 32 * 1024 * 1024 }); return { status: r.status, stdout: r.stdout ?? '', stderr: r.stderr ?? '', error: r.error }; };
export function checkAudit(run: AuditRunner, o: { attempts?: number } = {}): CheckResult {
  const attempts = o.attempts ?? 3; let why = 'no attempt was made';
  for (let i = 0; i < attempts; i++) {
    const r = run(); if (r.error) { why = r.error.message; continue; }
    let j: { advisories?: Record<string, { severity: string; module_name: string; title: string; findings?: { version: string }[] }>; metadata?: unknown; error?: unknown } | undefined; try { j = JSON.parse(r.stdout); } catch { j = undefined; }
    if (!j || j.error || (!j.advisories && !j.metadata)) { why = (r.stderr || 'the audit service did not answer').split('\n')[0]!.slice(0, 160); continue; }
    const f: Finding[] = Object.values(j.advisories ?? {}).filter((a) => ['high', 'critical'].includes(a.severity)).map((a) => ({ severity: a.severity as 'high' | 'critical', location: a.module_name, message: a.title })); return result('audit', f);
  }
  return unavailable('audit', `${why} (after ${attempts} attempts)`);
}
