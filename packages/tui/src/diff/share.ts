/** `diff.share` payloads and local edit results to `DiffFile[]`; unknown shapes give what can be read, never an error. */
import type { DiffFile } from './model.js';
import { diffStrings } from './diffStrings.js';
import { parseUnifiedDiff } from './parse.js';

const str = (v: unknown, max = 4096): string | undefined => (typeof v === 'string' ? v.slice(0, max) : undefined);
const STATUS = new Set(['added', 'deleted', 'modified', 'renamed', 'binary']);
export function fromDiffShare(files: unknown[]): DiffFile[] {
  const out: DiffFile[] = []; if (!Array.isArray(files)) return out;
  for (const f of files.slice(0, 200)) {
    if (!f || typeof f !== 'object') continue; const o = f as Record<string, unknown>; const path = str(o.path) ?? str(o.new_path) ?? str(o.newPath); if (!path) continue;
    if (typeof o.patch === 'string') { const parsed = parseUnifiedDiff(o.patch); if (parsed.length) { out.push(...parsed.map((p) => ({ ...p, newPath: p.newPath === '?' ? path : p.newPath }))); continue; } }
    const status = STATUS.has(o.status as string) ? (o.status as DiffFile['status']) : 'modified'; const num = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) && v >= 0 ? Math.floor(v) : 0);
    out.push({ ...(str(o.old_path) ? { oldPath: str(o.old_path) } : {}), newPath: path, status, hunks: [], adds: num(o.adds ?? o.additions), dels: num(o.dels ?? o.deletions) });
  }
  return out;
}
/** An edit tool result: old and new text of one file. */
export const fromEdit = (path: string, oldText: string, newText: string): DiffFile => diffStrings(oldText, newText, { path });
