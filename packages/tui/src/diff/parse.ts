/** `git diff` text to structured files. Hostile or huge input is bounded: only the first 2,000 lines of a file and 200 files are kept, the rest is counted. */
import { MAX_FILES, MAX_LINES, type DiffFile, type Hunk, type Limits } from './model.js';

const unq = (p: string) => p.replace(/^"|"$/g, '').replace(/^[ab]\//, '');
export function parseUnifiedDiff(text: string, limits: Limits = {}): DiffFile[] {
  const maxFiles = limits.maxFiles ?? MAX_FILES; const maxLines = limits.maxLinesPerFile ?? MAX_LINES; const files: DiffFile[] = []; let f: DiffFile | undefined; let h: Hunk | undefined; let o = 0; let n = 0; let kept = 0; let tooMany = 0; let skip = false;
  const start = (oldP: string | undefined, newP: string): DiffFile | undefined => { if (files.length >= maxFiles) { tooMany++; skip = true; f = undefined; return undefined; } skip = false; f = { ...(oldP ? { oldPath: oldP } : {}), newPath: newP, status: 'modified', hunks: [], adds: 0, dels: 0 }; files.push(f); h = undefined; kept = 0; return f; };
  let i = 0; const len = text.length;
  while (i < len) {
    let e = text.indexOf('\n', i); if (e < 0) e = len; const l = text.charCodeAt(e - 1) === 13 ? text.slice(i, e - 1) : text.slice(i, e); i = e + 1; const c = l.charCodeAt(0);
    if (h && f && (c === 43 || c === 45 || c === 32 || l === '' || c === 92)) {
      if (c === 92) continue; /* "\ No newline at end of file" */
      const kind = c === 43 ? 'add' : c === 45 ? 'del' : 'ctx'; const body = c === 43 || c === 45 || c === 32 ? l.slice(1) : l;
      if (kind === 'add') f.adds++; else if (kind === 'del') f.dels++;
      if (kept < maxLines) { kept++; h.lines.push(kind === 'add' ? { kind, newNo: n, text: body } : kind === 'del' ? { kind, oldNo: o, text: body } : { kind, oldNo: o, newNo: n, text: body }); } else f.moreLines = (f.moreLines ?? 0) + 1;
      if (kind !== 'del') n++; if (kind !== 'add') o++; continue;
    }
    if (l.startsWith('diff --git ')) { const m = /^diff --git (.+?) (.+)$/.exec(l); start(m ? unq(m[1]!) : undefined, m ? unq(m[2]!) : '?'); continue; }
    if (!f) { if (skip) continue; if (l.startsWith('--- ') || l.startsWith('+++ ')) { /* a plain unified diff without the git header */ if (l.startsWith('--- ')) { const nx = text.slice(i, text.indexOf('\n', i) < 0 ? len : text.indexOf('\n', i)); if (nx.startsWith('+++ ')) { const op = l.slice(4).split('\t')[0]!; const np = nx.slice(4).split('\t')[0]!; start(op === '/dev/null' ? undefined : unq(op), unq(np)); if (f) { if (op === '/dev/null') (f as DiffFile).status = 'added'; if (np === '/dev/null') (f as DiffFile).status = 'deleted'; } i = text.indexOf('\n', i) + 1 || len; } } } continue; }
    if (l.startsWith('new file mode')) f.status = 'added'; else if (l.startsWith('deleted file mode')) f.status = 'deleted';
    else if (l.startsWith('rename from ')) { f.status = 'renamed'; f.oldPath = l.slice(12); } else if (l.startsWith('rename to ')) { f.status = 'renamed'; f.newPath = l.slice(10); }
    else if (l.startsWith('Binary files ') || l.startsWith('GIT binary patch')) f.status = 'binary';
    else if (l.startsWith('--- ')) { if (l === '--- /dev/null') f.status = 'added'; else if (!f.oldPath) f.oldPath = unq(l.slice(4).split('\t')[0]!); }
    else if (l.startsWith('+++ ')) { if (l === '+++ /dev/null') f.status = 'deleted'; else f.newPath = unq(l.slice(4).split('\t')[0]!); }
    else if (l.startsWith('@@')) { const m = /^@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@ ?(.*)$/.exec(l); if (m) { o = +m[1]!; n = +m[2]!; h = { oldStart: o, newStart: n, header: m[3] ?? '', lines: [] }; f.hunks.push(h); } }
  }
  Object.defineProperty(files, 'moreFiles', { value: tooMany, enumerable: false }); return files;
}
export const moreFiles = (files: DiffFile[]): number => (files as DiffFile[] & { moreFiles?: number }).moreFiles ?? 0;
