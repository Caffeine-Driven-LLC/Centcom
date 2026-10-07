import { readFileSync } from 'node:fs';
import React from 'react';
import { renderToString } from 'ink';
import { describe, expect, it } from 'vitest';
import { DiffView, diffStrings, fromDiffShare, moreFiles, parseUnifiedDiff, renderDiffRows, wordRanges, type DiffFile } from '../../src/diff/index.js';
import { textWidth, type Line } from '../../src/util/text.js';

const golden = readFileSync(new URL('../fixtures/diffs/three-files.diff', import.meta.url), 'utf8');
const strip = (s: string) => s.replace(/\u001b\[[0-9;]*m/g, '');
const text = (l: Line) => l.map((s) => s.t).join('');

describe('parser', () => {
  it('reads the golden diff: deleted, binary, added, renamed, modified with two hunks', () => {
    const f = parseUnifiedDiff(golden); expect(f.map((x) => [x.newPath, x.status])).toEqual([['a.js', 'deleted'], ['bin.dat', 'binary'], ['new-file.md', 'added'], ['new-name.txt', 'renamed'], ['retry.ts', 'modified']]);
    expect(f[3]).toMatchObject({ oldPath: 'old-name.txt', hunks: [] }); expect(f[4]!.hunks).toHaveLength(2); expect(f[4]!).toMatchObject({ adds: 3, dels: 3 }); expect(f[2]!.hunks[0]!.lines[0]).toEqual({ kind: 'add', newNo: 1, text: '# hello' });
    expect(f[4]!.hunks[0]!.lines.find((l) => l.kind === 'del')).toMatchObject({ oldNo: 1, text: 'export const retryCount = 3;' });
  });
  it('a plain unified diff without the git header works too, and nonsense gives nothing', () => {
    const f = parseUnifiedDiff('--- a/x.txt\t2020\n+++ b/x.txt\t2020\n@@ -1,2 +1,2 @@\n a\n-b\n+c\n'); expect(f).toHaveLength(1); expect(f[0]).toMatchObject({ newPath: 'x.txt', adds: 1, dels: 1 }); expect(parseUnifiedDiff('hello\nworld')).toEqual([]); expect(parseUnifiedDiff('')).toEqual([]);
  });
  it('50,000 lines parse in under 300 ms, keep 2,000 and count the rest', () => {
    const body = Array.from({ length: 50_000 }, (_, i) => `+line ${i}`).join('\n'); const t = '--- /dev/null\n+++ b/big.txt\n@@ -0,0 +1,50000 @@\n' + body + '\n'; const t0 = performance.now(); const f = parseUnifiedDiff(t); const ms = performance.now() - t0;
    expect(ms).toBeLessThan(300); expect(f[0]!.hunks[0]!.lines).toHaveLength(2000); expect(f[0]!.moreLines).toBe(48_000); expect(f[0]!.adds).toBe(50_000); const rows = renderDiffRows(f, { width: 80 }); expect(rows.filter((r) => r.meta.kind === 'line')).toHaveLength(2000); expect(text(rows.at(-1)!.line)).toContain('⋯ 48,000 more lines');
  });
  it('more than 200 files: the first 200 and a "more files" row', () => {
    const t = Array.from({ length: 205 }, (_, i) => `diff --git a/f${i} b/f${i}\n--- a/f${i}\n+++ b/f${i}\n@@ -1 +1 @@\n-a\n+b\n`).join(''); const f = parseUnifiedDiff(t); expect(f).toHaveLength(200); expect(moreFiles(f)).toBe(5); expect(text(renderDiffRows(f, { width: 80 }).at(-1)!.line)).toBe('⋯ 5 more files');
  });
});

describe('differ', () => {
  it('finds the changed lines and numbers both sides; context of 3', () => {
    const f = diffStrings('a\nb\nc\nd\ne\nf\ng\nh\ni\nj', 'a\nb\nc\nd\nE\nf\ng\nh\ni\nj', { path: 'x' }); expect(f).toMatchObject({ adds: 1, dels: 1, status: 'modified' }); expect(f.hunks).toHaveLength(1); expect(f.hunks[0]!.lines.map((l) => `${l.kind[0]}${l.oldNo ?? ''}/${l.newNo ?? ''}`)).toEqual(['c2/2'.replace('2/2', '3/3'), 'c4/4', 'd5/', 'a/5', 'c6/6', 'c7/7', 'c8/8'].map((x) => x.replace('c2', 'c')).slice(0, 0).concat(['c2/2', 'c3/3', 'c4/4', 'd5/', 'a/5', 'c6/6', 'c7/7', 'c8/8']));
    expect(diffStrings('', 'x\ny').status).toBe('added'); expect(diffStrings('x', '').status).toBe('deleted'); expect(diffStrings('same', 'same').hunks).toEqual([]);
  });
});

describe('word highlights', () => {
  it('retryCount to retryLimit marks only Count and Limit', () => {
    const r = wordRanges('const retryCount = 3;', 'const retryLimit = 3;')!; expect(r.old).toEqual([[11, 16]]); expect(r.new).toEqual([[11, 16]]); expect('const retryCount = 3;'.slice(...r.old[0]!)).toBe('Count'); expect('const retryLimit = 3;'.slice(...r.new[0]!)).toBe('Limit');
    expect(wordRanges('x'.repeat(2001), 'y')).toBeNull();
  });
  it('the rendered spans carry the change as bold reverse video, the rest does not', () => {
    const rows = renderDiffRows(parseUnifiedDiff(golden), { width: 80 }); const del = rows.find((r) => text(r.line).includes('-export const retryCount'))!; const hot = del.line.filter((s) => s.r); expect(hot.map((s) => s.t)).toEqual(['Count']); expect(hot[0]!.b).toBe(true);
    const add = rows.find((r) => text(r.line).includes('+export const retryLimit'))!; expect(add.line.filter((s) => s.r).map((s) => s.t)).toEqual(['Limit']);
  });
});

describe('rendering', () => {
  it('no row is wider than 80 columns, numbers are 5 wide, long lines wrap with a 7-column indent', () => {
    const f: DiffFile[] = [...parseUnifiedDiff(golden), diffStrings('', 'x'.repeat(200) + '\nshort', { path: 'long.txt' })]; const rows = renderDiffRows(f, { width: 80 });
    for (const r of rows) expect(textWidth(text(r.line)), text(r.line)).toBeLessThanOrEqual(80); const lines = rows.filter((r) => r.meta.kind === 'line').map((r) => text(r.line));
    expect(lines.some((l) => /^ {4}1 \+# hello$/.test(l))).toBe(true); const wrapped = rows.map((r) => text(r.line)).filter((l) => /^ {7}x+$/.test(l)); expect(wrapped.length).toBeGreaterThanOrEqual(2); expect(text(rows.find((r) => text(r.line).startsWith('+x') || /^ +1 \+x/.test(text(r.line)))!.line).slice(0, 8)).toMatch(/^ {4}1 \+x/);
  });
  it('binary and rename rows say so; added/removed carry + and - without colour', () => {
    const rows = renderDiffRows(parseUnifiedDiff(golden), { width: 80 }).map((r) => text(r.line)); expect(rows).toContain('bin.dat  Binary file changed'); expect(rows.some((r) => r === 'old-name.txt → new-name.txt  +0 −0')).toBe(true); expect(rows.some((r) => r.includes('-same') || r.includes('+# hello'))).toBe(true);
    const out = strip(renderToString(<DiffView files={parseUnifiedDiff(golden)} width={80} />, { columns: 80 })); expect(out).toContain('+export const retryLimit = 3;'); expect(out).toContain('-export const retryCount = 3;');
  });
  it('60 unchanged lines between changes fold to "⋯ 54 unchanged lines"; expanding shows them', () => {
    const a = ['top', ...Array.from({ length: 60 }, (_, i) => `mid ${i}`), 'bottom'].join('\n'); const b = ['TOP', ...Array.from({ length: 60 }, (_, i) => `mid ${i}`), 'BOTTOM'].join('\n'); const f = [diffStrings(a, b, { context: 100, path: 'x' })];
    const folded = renderDiffRows(f, { width: 80 }); const gap = folded.find((r) => r.meta.kind === 'gap')!; expect(text(gap.line).trim()).toBe('⋯ 54 unchanged lines'); expect(folded.filter((r) => r.meta.kind === 'line' && text(r.line).includes('mid '))).toHaveLength(6);
    const open = renderDiffRows(f, { width: 80, expanded: new Set([gap.meta.gapId!]) }); expect(open.some((r) => r.meta.kind === 'gap')).toBe(false); expect(open.filter((r) => text(r.line).includes('mid '))).toHaveLength(60);
  });
  it('maxRows cuts a view and says how many rows are left', () => { const out = strip(renderToString(<DiffView files={parseUnifiedDiff(golden)} width={80} maxRows={3} />, { columns: 80 })); expect(out).toMatch(/⋯ \d+ more rows/); });
});

describe('diff.share', () => {
  it('reads known shapes and survives unknown ones', () => {
    const f = fromDiffShare([{ path: 'a.ts', status: 'added', adds: 4 }, { new_path: 'b.ts', old_path: 'c.ts', status: 'renamed' }, { path: 'p.ts', patch: '--- a/p.ts\n+++ b/p.ts\n@@ -1 +1 @@\n-x\n+y\n' }, 42, null, { nothing: true }, { path: 'weird', status: 'sideways', adds: -5 }]);
    expect(f.map((x) => [x.newPath, x.status])).toEqual([['a.ts', 'added'], ['b.ts', 'renamed'], ['p.ts', 'modified'], ['weird', 'modified']]); expect(f[0]!.adds).toBe(4); expect(f[2]!.hunks).toHaveLength(1); expect(f[3]!.adds).toBe(0); expect(fromDiffShare('nope' as never)).toEqual([]);
  });
});
