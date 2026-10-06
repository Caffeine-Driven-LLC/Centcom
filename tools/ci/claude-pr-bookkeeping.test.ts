// @ts-check
/** Progress bookkeeping: STATUS.json merges, README progress blocks, and real stopped merges. */
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import {
  markMerged,
  mergeStatus,
  mergeText,
  resolve,
  stripProgress,
  writeStatus,
} from './claude-pr-bookkeeping.mjs';

const status = (/** @type {Record<string, { pct: number, note: string }>} */ lanes) =>
  writeStatus({ updated: '2026-10-01', lanes, next: [] });

describe('writeStatus', () => {
  it('writes ASCII with one-space indent, like json.dump(indent=1)', () => {
    expect(writeStatus({ a: 'x·y' })).toBe('{\n "a": "x\\u00b7y"\n}\n');
  });
});

describe('markMerged', () => {
  it('records each lane as merged by the PR and stamps the date', () => {
    const out = JSON.parse(
      markMerged(status({ X001: { pct: 0.5, note: 'wip' } }), ['X001', 'X002'], 12, '2026-10-07'),
    );
    expect(out.updated).toBe('2026-10-07');
    expect(out.lanes).toEqual({
      X001: { pct: 1, note: 'merged in #12' },
      X002: { pct: 1, note: 'merged in #12' },
    });
  });
});

describe('mergeStatus', () => {
  const base = status({ X001: { pct: 0.5, note: 'wip' } });
  it('keeps both sides when each added its own lane', () => {
    const ours = status({ X001: { pct: 0.5, note: 'wip' }, X002: { pct: 1, note: 'mine' } });
    const theirs = status({ X001: { pct: 0.5, note: 'wip' }, X003: { pct: 1, note: 'main' } });
    expect(Object.keys(JSON.parse(mergeStatus(base, ours, theirs)).lanes)).toEqual([
      'X001',
      'X003',
      'X002',
    ]);
  });
  it('keeps the higher pct when both changed the same lane', () => {
    const ours = status({ X001: { pct: 0.8, note: 'more' } });
    const theirs = status({ X001: { pct: 1, note: 'merged in #3' } });
    expect(JSON.parse(mergeStatus(base, ours, theirs)).lanes.X001.pct).toBe(1);
    expect(JSON.parse(mergeStatus(base, theirs, ours)).lanes.X001.pct).toBe(1);
  });
});

describe('README progress block', () => {
  /** @param {string} block @param {string} tail */
  const readme = (block, tail) =>
    `# Title\n\n<!-- progress:start -->\n${block}\n<!-- progress:end -->\n\n## Usage\n${tail}\n`;
  it('merges the rest of the file once both blocks are emptied', () => {
    const merged = mergeText(
      stripProgress(readme('**3% built**', 'old')),
      stripProgress(readme('**4% built**', 'old')),
      stripProgress(readme('**5% built**', 'new on main')),
    );
    expect(merged).toBe(stripProgress(readme('anything', 'new on main')));
  });
  it('still reports a real conflict outside the block', () => {
    expect(mergeText('a\n', 'b\n', 'c\n')).toBeNull();
  });
});

describe('resolve (a real stopped merge)', () => {
  const dir = mkdtempSync(join(tmpdir(), 'claude-pr-bookkeeping-'));
  afterAll(() => rmSync(dir, { recursive: true, force: true }));
  /** @param {...string} args */
  const git = (...args) => execFileSync('git', args, { cwd: dir, encoding: 'utf8' }).trim();
  /** @param {Record<string, string>} contents */
  const commit = (contents) => {
    for (const [path, text] of Object.entries(contents)) writeFileSync(join(dir, path), text);
    git('add', '-A');
    git('commit', '-q', '-m', 'edit');
  };
  const readme = (/** @type {string} */ pct, /** @type {string} */ tail) =>
    `# T\n\n<!-- progress:start -->\n${pct}\n<!-- progress:end -->\n\n${tail}\n`;
  mkdirSync(join(dir, 'plan'));
  mkdirSync(join(dir, 'docs'));
  git('init', '-q', '-b', 'main');
  git('config', 'user.email', 't@example.com');
  git('config', 'user.name', 't');
  git('config', 'commit.gpgsign', 'false');
  commit({
    'plan/STATUS.json': status({}),
    'README.md': readme('0%', 'intro'),
    'docs/progress.svg': '<svg>0</svg>\n',
    'code.txt': 'base\n',
  });

  it('resolves conflicts confined to the progress files and commits the merge', () => {
    git('checkout', '-q', '-b', 'lane');
    commit({
      'plan/STATUS.json': status({ X002: { pct: 1, note: 'lane' } }),
      'README.md': readme('4%', 'intro'),
      'docs/progress.svg': '<svg>4</svg>\n',
      'code.txt': 'base\nlane\n',
    });
    git('checkout', '-q', 'main');
    commit({
      'plan/STATUS.json': status({ X001: { pct: 1, note: 'merged in #1' } }),
      'README.md': readme('5%', 'intro edited on main'),
      'docs/progress.svg': '<svg>5</svg>\n',
    });
    git('checkout', '-q', 'lane');
    expect(() => git('merge', '--no-ff', '--no-edit', 'main')).toThrow();

    expect(resolve(dir)).toEqual({
      resolved: ['README.md', 'docs/progress.svg', 'plan/STATUS.json'],
      remaining: [],
      committed: true,
    });
    const lanes = JSON.parse(readFileSync(join(dir, 'plan/STATUS.json'), 'utf8')).lanes;
    expect(Object.keys(lanes)).toEqual(['X001', 'X002']);
    expect(readFileSync(join(dir, 'README.md'), 'utf8')).toContain('intro edited on main');
    expect(git('log', '-1', '--format=%P').split(' ')).toHaveLength(2);
  });
});
