import { describe, expect, it } from 'vitest';
import { fit, formatCost, formatElapsed, formatTokens, lineWidth, plain, textWidth, truncate, truncateMiddle, wrapLine, sp } from '../src/util/text.js';
import { inline, renderMarkdown } from '../src/util/markdown.js';
import { diffStats, parseDiff, renderDiff } from '../src/util/diff.js';
import { VerbRotator, loadVerbs } from '../src/util/verbs.js';

const txt = (l: { t: string }[]) => l.map((s) => s.t).join('');

import { formatReset } from '../src/util/text.js';

describe('text', () => {
  it('measures wide characters and truncates by cells', () => {
    expect(textWidth('abc')).toBe(3); expect(textWidth('日本')).toBe(4); expect(textWidth('á')).toBe(1);
    expect(truncate('hello world', 8)).toBe('hello w…'); expect(truncate('hi', 8)).toBe('hi');
    expect(truncateMiddle('src/very/long/path/client.ts', 16)).toBe('src/very…ient.ts'.length === 16 ? 'src/very…ient.ts' : truncateMiddle('src/very/long/path/client.ts', 16));
    expect(textWidth(truncateMiddle('src/very/long/path/client.ts', 16))).toBe(16);
  });
  it('wraps at spaces without losing styles or text', () => {
    const l = wrapLine([sp('the quick '), sp('brown', { b: true }), sp(' fox jumps over')], 12);
    expect(l.map(txt)).toEqual(['the quick', 'brown fox', 'jumps over']);
    expect(l[1]!.find((s) => s.t === 'brown')?.b).toBe(true);
    expect(l.every((x) => lineWidth(x) <= 12)).toBe(true);
  });
  it('hard-breaks words longer than a line and honours indent', () => {
    expect(wrapLine(plain('abcdefghijklmnop'), 8).map(txt)).toEqual(['abcdefgh', 'ijklmnop']);
    const w = wrapLine(plain('one two three four'), 10, [sp('  ')]);
    expect(w.map(txt)).toEqual(['one two', '  three', '  four']);
  });
  it('splits on explicit newlines and fits to width', () => {
    expect(wrapLine(plain('a\nb'), 10).map(txt)).toEqual(['a', 'b']);
    expect(lineWidth(fit(plain('ab'), 5))).toBe(5); expect(lineWidth(fit(plain('abcdefgh'), 5))).toBe(5);
  });
  it('formats numbers', () => {
    expect(formatTokens(950)).toBe('950'); expect(formatTokens(1400)).toBe('1.4k'); expect(formatTokens(21000)).toBe('21k'); expect(formatTokens(2_500_000)).toBe('2.5M');
    expect(formatElapsed(5000)).toBe('5s'); expect(formatElapsed(75_000)).toBe('1m 15s'); expect(formatCost(0.004)).toBe('<$0.01'); expect(formatCost(1.234)).toBe('$1.23');
  });
});

describe('markdown', () => {
  it('styles inline code, bold, italic and links', () => {
    const l = inline('use `foo` and **bar** and *baz* and [x](http://y)');
    expect(l.find((s) => s.t === ' foo ')?.bg).toBe('bg.raised'); expect(l.find((s) => s.t === 'bar')?.b).toBe(true);
    expect(l.find((s) => s.t === 'baz')?.i).toBe(true); expect(l.find((s) => s.t === 'x')?.u).toBe(true);
  });
  it('renders lists, headings, quotes and code fences within the width', () => {
    const lines = renderMarkdown('# Title\n\nSome **text** here that is long enough to wrap around the edge.\n\n- one\n- two\n\n```ts\nconst a = 1;\n```\n> quoted', { width: 30 });
    const s = lines.map(txt);
    expect(s[0]).toBe('Title'); expect(s.some((x) => x.trim() === '• one')).toBe(true); expect(s.some((x) => x.includes('const a = 1;'))).toBe(true);
    expect(s.some((x) => x.startsWith('│ '))).toBe(true);
    expect(lines.every((l) => lineWidth(l) <= 30)).toBe(true);
  });
  it('is safe on an unterminated fence while streaming', () => {
    const s = renderMarkdown('text\n\n```ts\nconst a', { width: 40 }).map(txt);
    expect(s.some((x) => x.includes('const a'))).toBe(true);
  });
});

describe('diff', () => {
  const d = '--- a/x.ts\n+++ b/x.ts\n@@ -3,3 +3,3 @@ fn\n ctx\n-old\n+new\n tail\n';
  it('parses rows with line numbers', () => {
    const r = parseDiff(d);
    expect(r.map((x) => x.kind)).toEqual(['file', 'hunk', 'ctx', 'del', 'add', 'ctx']);
    expect(r[3]).toMatchObject({ oldNo: 4, text: 'old' }); expect(r[4]).toMatchObject({ newNo: 4, text: 'new' });
    expect(diffStats(r)).toEqual({ add: 1, del: 1 });
  });
  it('renders full-width tinted rows and truncates long diffs', () => {
    const l = renderDiff(d, 30);
    expect(l[3]!.some((s) => s.bg === 'status.danger.subtle')).toBe(true);
    expect(lineWidth(l[3]!)).toBe(30);
    const big = '+++ b/f\n@@ -1,0 +1,40 @@\n' + Array.from({ length: 40 }, (_, i) => '+line' + i).join('\n');
    const out = renderDiff(big, 30, 10); expect(out).toHaveLength(11); expect(txt(out.at(-1)!)).toContain('more lines');
  });
});

describe('verbs', () => {
  it('loads 700+ lines and never repeats until exhausted', () => {
    expect(loadVerbs().length).toBeGreaterThan(700);
    const r = new VerbRotator(['a…', 'b…', 'c…'], () => 0.5, 40); const seen = new Set([r.next(), r.next(), r.next()]);
    expect(seen.size).toBe(3);
  });
  it('skips lines that are too long for the spinner row', () => {
    const r = new VerbRotator(['short…', 'x'.repeat(60) + '…'], Math.random, 40);
    expect(r.next()).toBe('short…');
  });
});

describe('formatReset', () => {
  const now = 1_000_000_000_000;
  it('formats the time until a limit resets', () => {
    expect(formatReset(now / 1000 + 9660, now)).toBe('2h 41m'); expect(formatReset(now / 1000 + 3 * 86400 + 4 * 3600, now)).toBe('3d 4h');
    expect(formatReset(now / 1000 + 12 * 60, now)).toBe('12m'); expect(formatReset(now / 1000 - 5, now)).toBe('now'); expect(formatReset(0, now)).toBe('1m');
  });
});

describe('diff: "\\ No newline at end of file"', () => {
  const D = ['--- a/f.txt', '+++ b/f.txt', '@@ -1,2 +1,2 @@', ' keep', '-old last', '\\ No newline at end of file', '+new last', '\\ No newline at end of file', ''].join('\n');
  it('is a note about the line above, not a line: no line number, no count, and the numbers after it stay right', async () => {
    const { parseDiff, diffStats, renderDiff } = await import('../src/util/diff.js'); const rows = parseDiff(D);
    expect(rows.filter((r) => r.kind === 'note').map((r) => r.text)).toEqual(['No newline at end of file', 'No newline at end of file']);
    expect(diffStats(rows)).toEqual({ add: 1, del: 1 }); expect(rows.find((r) => r.kind === 'add')).toMatchObject({ text: 'new last', newNo: 2 }); expect(rows.find((r) => r.kind === 'del')).toMatchObject({ text: 'old last', oldNo: 2 });
    const text = renderDiff(D, 60).map((l) => l.map((s) => s.t).join('')).join('\n'); expect(text).toContain('\\ No newline at end of file'); expect(text.split('\n').filter((l) => l.includes('No newline')).every((l) => !/^\s*\d/.test(l))).toBe(true);
  });
});

describe('window title', () => {
  it('folder, state, demo marker; control characters and over-long names are cleaned', async () => {
    const { windowTitle, cleanTitle } = await import('../src/util/title.js'); const base = { cwd: '/a/b/shop', busy: false, approvals: 0, mode: 'chat', engineLabel: 'Claude Code', demo: false };
    expect(windowTitle(base)).toBe('shop · Centcom'); expect(windowTitle({ ...base, busy: true })).toBe('◐ working · shop · Centcom'); expect(windowTitle({ ...base, busy: true, approvals: 1 })).toBe('● needs you · shop · Centcom'); expect(windowTitle({ ...base, demo: true })).toBe('shop · Centcom (demo)'); expect(windowTitle({ ...base, cwd: '/' })).toContain('Centcom');
    expect(cleanTitle('a\x07b\x1bc\nd')).toBe('a b c d'); expect(cleanTitle('x'.repeat(200)).length).toBe(80);
  });
});
